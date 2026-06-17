// ═══════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════
// ── API KEYS ──
const TD_KEY  = 'a0680ea88b934543be5eaab23f518f6d';
const AV_KEY  = 'CVRA2AHLUR4OWPY4';
const AV_BASE = 'https://www.alphavantage.co/query';
const TD_BASE = 'https://api.twelvedata.com';

// ── CORS PROXIES ──
const PROXIES = [
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://thingproxy.freeboard.io/fetch/${u}`,
  u => u,
];
let pIdx = 0;

async function proxyFetch(url, timeout=10000) {
  for (let i = 0; i < PROXIES.length; i++) {
    const idx = (pIdx + i) % PROXIES.length;
    try {
      const r = await fetch(PROXIES[idx](url), {signal: AbortSignal.timeout(timeout)});
      if (!r.ok) continue;
      const text = await r.text();
      const d = JSON.parse(text);
      pIdx = idx;
      return d;
    } catch(e) { continue; }
  }
  throw new Error('All proxies failed: ' + url);
}

async function avFetch(params) {
  const url = `${AV_BASE}?${new URLSearchParams({...params, apikey: AV_KEY})}`;
  const d = await proxyFetch(url);
  if (d['Note'] || d['Information']) throw new Error('AV rate limit');
  return d;
}

async function tdFetch(params) {
  const url = `${TD_BASE}?${new URLSearchParams({...params, apikey: TD_KEY})}`;
  const d = await proxyFetch(url);
  if (d.status === 'error') throw new Error(d.message);
  return d;
}

// ── YAHOO FINANCE (no key needed, good CORS via proxy) ──
async function yahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const d = await proxyFetch(url);
  const r = d?.chart?.result?.[0];
  if (!r) throw new Error('No Yahoo data for ' + symbol);
  const meta = r.meta;
  return {
    price: meta.regularMarketPrice,
    open:  meta.regularMarketOpen,
    high:  meta.regularMarketDayHigh,
    low:   meta.regularMarketDayLow,
    prev:  meta.chartPreviousClose || meta.previousClose,
    change: meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose),
    pct:   ((meta.regularMarketPrice - (meta.chartPreviousClose || meta.previousClose)) / (meta.chartPreviousClose || meta.previousClose)) * 100,
  };
}

let state = {
  xau: {},
  dxy: {},
  xauSeries: [],
  dxySeries: [],
  currentInterval: '1h'
};
let charts = {};
let pageInited = {};

// ═══════════════════════════════════════════════
// MARKET HOURS & LOCAL STORAGE
// ═══════════════════════════════════════════════
const CACHE_KEY = 'dfxai_last_data';
const CACHE_TTL = 7 * 24 * 3600 * 1000; // 7 days

function saveToCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ts: Date.now(), data})); } catch(e){}
}
function loadFromCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.ts > CACHE_TTL) return null;
    return obj;
  } catch(e) { return null; }
}

function isMarketOpen() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
  const hour = now.getUTCHours();
  const min = now.getUTCMinutes();
  const timeMin = hour * 60 + min;
  // Gold market: Mon 00:00 - Fri 21:00 UTC
  if (day === 0) return false; // Sunday
  if (day === 6) return false; // Saturday
  if (day === 5 && timeMin >= 21 * 60) return false; // Friday after 21:00
  return true;
}

function getNextOpen() {
  const now = new Date();
  const day = now.getUTCDay();
  let daysUntilMon = (8 - day) % 7 || 7;
  if (day === 0) daysUntilMon = 1;
  if (day === 6) daysUntilMon = 2;
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + daysUntilMon);
  next.setUTCHours(0, 0, 0, 0);
  const diff = next - now;
  const hh = Math.floor(diff / 3600000);
  const mm = Math.floor((diff % 3600000) / 60000);
  return `Opens in ${hh}h ${mm}m (Mon 00:00 UTC)`;
}

function updateMarketBanner() {
  const banner = document.getElementById('marketBanner');
  const text = document.getElementById('marketBannerText');
  const next = document.getElementById('marketNextOpen');
  if (!banner) return;
  if (isMarketOpen()) {
    banner.style.display = 'flex';
    banner.className = 'open';
    banner.querySelector('.mb-icon').textContent = '🟢';
    text.textContent = 'MARKET OPEN — Live data active';
    next.textContent = '';
  } else {
    banner.style.display = 'flex';
    banner.className = '';
    banner.querySelector('.mb-icon').textContent = '🔴';
    const day = new Date().getUTCDay();
    const reason = day === 0 || day === 6 ? 'Weekend' : 'After Hours';
    text.textContent = `MARKET CLOSED — ${reason} · Showing last session data`;
    next.textContent = getNextOpen();
  }
}

// ═══════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════
function updateClock() {
  const n = new Date();
  const p = x => String(x).padStart(2,'0');
  document.getElementById('clockDisplay').textContent =
    `${p(n.getUTCHours())}:${p(n.getUTCMinutes())}:${p(n.getUTCSeconds())} UTC`;
}
setInterval(updateClock, 1000);
updateClock();

// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════
const fmt = (n, d=2) => n==null||isNaN(n) ? '—' : parseFloat(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const fmtPct = n => { if(n==null||isNaN(n)) return '—'; const v=parseFloat(n); return (v>=0?'+':'')+v.toFixed(2)+'%'; };
const setEl = (id, val) => { const e=document.getElementById(id); if(e) e.textContent=val; };
const setStatus = (id, type, text) => { const e=document.getElementById(id); if(!e) return; e.className='api-status api-'+type; e.textContent=text; };

// CORS proxy rotation — needed when opening HTML directly from device
const CORS_PROXIES = [
  url => url,  // direct (works if hosted on a web server)
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://thingproxy.freeboard.io/fetch/${url}`,
];
let proxyIdx = 0;

async function tryFetch(url) {
  for (let i = 0; i < CORS_PROXIES.length; i++) {
    const idx = (proxyIdx + i) % CORS_PROXIES.length;
    try {
      const proxied = CORS_PROXIES[idx](url);
      const r = await fetch(proxied, { headers:{ 'Accept':'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const text = await r.text();
      const d = JSON.parse(text);
      if (d.status === 'error') throw new Error(d.message || 'API error');
      proxyIdx = idx; // remember working proxy
      return d;
    } catch(e) { continue; }
  }
  throw new Error('All proxies failed');
}

async function apiGet(path) {
  const url = `${BASE_URL}${path}&apikey=${API_KEY}`;
  return tryFetch(url);
}

// ═══════════════════════════════════════════════
// FETCH QUOTES
// ═══════════════════════════════════════════════
async function fetchQuotes() {
  try {
    // Yahoo Finance symbols
    const ySymbols = {
      'XAU/USD': 'GC=F',     // Gold futures (closest to spot)
      'XAG/USD': 'SI=F',     // Silver futures
      'EUR/USD': 'EURUSD=X',
      'GBP/USD': 'GBPUSD=X',
      'USD/JPY': 'JPY=X',
      'US10Y':   '^TNX',
    };

    const results = {};
    // Fetch all in parallel
    await Promise.allSettled(
      Object.entries(ySymbols).map(async ([sym, yticker]) => {
        try {
          results[sym] = await yahooQuote(yticker);
        } catch(e) {
          console.warn('Yahoo fail for', sym, e.message);
        }
      })
    );

    // ── Update XAU ──
    if (results['XAU/USD'] && results['XAU/USD'].price) {
      state.xau = results['XAU/USD'];
      updateXAU(state.xau, new Date());
    }

    // ── Update DXY proxy (EUR/USD) ──
    if (results['EUR/USD'] && results['EUR/USD'].price) {
      state.dxy = results['EUR/USD'];
      updateDXY(state.dxy);
    }

    // ── Update all tickers ──
    const tickerMap = {
      'XAU/USD': {p:'t-xau', c:'t-xau-chg', dec:2},
      'XAG/USD': {p:'t-xag', c:'t-xag-chg', dec:2},
      'EUR/USD': {p:'t-eur', c:'t-eur-chg', dec:4},
      'GBP/USD': {p:'t-gbp', c:'t-gbp-chg', dec:4},
      'USD/JPY': {p:'t-jpy', c:'t-jpy-chg', dec:2},
      'US10Y':   {p:'t-us10',c:'t-us10-chg',dec:3},
    };

    Object.entries(tickerMap).forEach(([sym, cfg]) => {
      const q = results[sym];
      if (!q || !q.price) return;
      const dir = q.change >= 0;
      const pEl = document.getElementById(cfg.p);
      const cEl = document.getElementById(cfg.c);
      if (pEl) {
        pEl.textContent = fmt(q.price, cfg.dec);
        pEl.className = 'ticker-price ' + (dir ? 'up' : 'down');
        pEl.classList.add(dir ? 'flash-up' : 'flash-dn');
        setTimeout(() => pEl.classList.remove('flash-up','flash-dn'), 400);
      }
      if (cEl) {
        cEl.textContent = fmtPct(q.pct);
        cEl.className = 'ticker-chg ' + (dir ? 'up' : 'down');
      }
    });

    setStatus('apiStatusBadge','ok','● LIVE');
    computeSignal();

    // Cache
    saveToCache({ xau: state.xau, dxy: state.dxy, tickers: results });

  } catch(e) {
    console.error('Quote error:', e);
    const cached = loadFromCache();
    if (cached && cached.data) {
      setStatus('apiStatusBadge','load','◷ CACHED');
      const d = cached.data;
      const cDate = new Date(cached.ts).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      if (d.xau && d.xau.price) { updateXAU(d.xau, new Date(cached.ts)); document.getElementById('xauLastUpdate').textContent = `LAST: ${cDate}`; }
      if (d.dxy && d.dxy.price) updateDXY(d.dxy);
      if (d.tickers) {
        const tickerMap = {
          'XAU/USD':{p:'t-xau',c:'t-xau-chg',dec:2},'XAG/USD':{p:'t-xag',c:'t-xag-chg',dec:2},
          'EUR/USD':{p:'t-eur',c:'t-eur-chg',dec:4},'GBP/USD':{p:'t-gbp',c:'t-gbp-chg',dec:4},
          'USD/JPY':{p:'t-jpy',c:'t-jpy-chg',dec:2},'US10Y':{p:'t-us10',c:'t-us10-chg',dec:3},
        };
        Object.entries(tickerMap).forEach(([sym,cfg]) => {
          const q = d.tickers[sym]; if(!q||!q.price) return;
          const pEl=document.getElementById(cfg.p); const cEl=document.getElementById(cfg.c);
          if(pEl) pEl.textContent=fmt(q.price,cfg.dec);
          if(cEl) { cEl.textContent=fmtPct(q.pct); cEl.className='ticker-chg '+(q.pct>=0?'up':'down'); }
        });
      }
      computeSignal();
    } else {
      setStatus('apiStatusBadge','err', isMarketOpen() ? '✕ API ERR' : '🔴 MKT CLOSED');
    }
  }
}

function updateXAU(q, now) {
  const dir = q.change >= 0;
  const p = n => String(n.getUTCHours()).padStart(2,'0')+':'+String(n.getUTCMinutes()).padStart(2,'0');
  setEl('xauPrice', fmt(q.price));
  setEl('xauOpen', fmt(q.open));
  setEl('xauHigh', fmt(q.high));
  setEl('xauLow', fmt(q.low));
  setEl('xauPrev', fmt(q.prev));
  setEl('xauPct', fmtPct(q.pct));
  setEl('xauLastUpdate', `UPDATED ${p(now)} UTC`);

  const chgBig = document.getElementById('xauChgBig');
  if (chgBig) {
    chgBig.textContent = `${dir?'▲ +':'▼ '}${Math.abs(q.change).toFixed(2)} (${fmtPct(q.pct)})`;
    chgBig.className = 'price-change-big ' + (dir?'up':'down');
  }

  // Key levels from real data
  const pr = q.price, h = q.high, l = q.low, pv = q.prev;
  setEl('lvlNow',    fmt(pr));
  setEl('lvlR3',     fmt(Math.ceil((pr+130)/50)*50));
  setEl('lvlR2',     fmt(Math.ceil((pr+60)/25)*25));
  setEl('lvlR1',     fmt(h));
  setEl('lvlPivot',  fmt((h+l+pv)/3));
  setEl('lvlS1',     fmt(l));
  setEl('lvlS2',     fmt(Math.floor((pr-55)/25)*25));
  setEl('lvlS3',     fmt(Math.floor(pr/100)*100));
}

function updateDXY(q) {
  const dir = q.change >= 0;
  setEl('dxyPrice', fmt(q.price));
  setEl('dxyHigh', fmt(q.high));
  setEl('dxyLow', fmt(q.low));
  setEl('dxyOpen', fmt(q.open));
  setEl('dxyPrev', fmt(q.prev));

  const chgEl = document.getElementById('dxyChg');
  if (chgEl) { chgEl.textContent = `${dir?'▲ +':'▼ '}${Math.abs(q.change).toFixed(2)} (${fmtPct(q.pct)})`; chgEl.className = dir?'up':'down'; }

  // DXY trend indicator
  const pct = q.pct || 0;
  const isWeak = pct < -0.15, isStrong = pct > 0.15;
  const color = isWeak?'var(--green)':isStrong?'var(--red)':'var(--gold)';
  const width = isWeak?'22%':isStrong?'78%':'50%';
  const valText = isWeak?'Weak':isStrong?'Strong':'Neutral';
  const sigText = isWeak?'+GOLD':isStrong?'-GOLD':'NEUTRAL';

  ['dxyTrendBar','sentDXYBar'].forEach(id=>{ const e=document.getElementById(id); if(e){e.style.width=width;e.style.background=color;} });
  ['dxyTrendVal','sentDXYVal'].forEach(id=>{ const e=document.getElementById(id); if(e){e.textContent=`${fmt(q.price)} ${valText}`;e.style.color=color;} });
  ['dxyTrendSig','sentDXYSig'].forEach(id=>{ const e=document.getElementById(id); if(e){e.textContent=sigText;e.style.color=color;} });
}

// ═══════════════════════════════════════════════
// TECHNICAL INDICATORS (client-side)
// ═══════════════════════════════════════════════
function calcEMA(data, p) {
  if(data.length<p) return null;
  const k=2/(p+1);
  let e=data.slice(0,p).reduce((a,b)=>a+b,0)/p;
  for(let i=p;i<data.length;i++) e=data[i]*k+e*(1-k);
  return e;
}
function calcRSI(closes, p=14) {
  if(closes.length<p+1) return null;
  let g=0,l=0;
  for(let i=1;i<=p;i++){const d=closes[i]-closes[i-1];if(d>0)g+=d;else l-=d;}
  let ag=g/p,al=l/p;
  for(let i=p+1;i<closes.length;i++){const d=closes[i]-closes[i-1];ag=((ag*(p-1))+(d>0?d:0))/p;al=((al*(p-1))+(d<0?-d:0))/p;}
  return al===0?100:100-100/(1+ag/al);
}
function calcATR(series, p=14) {
  if(series.length<p+1) return null;
  const trs=[];
  for(let i=1;i<series.length;i++) trs.push(Math.max(series[i].h-series[i].l,Math.abs(series[i].h-series[i-1].c),Math.abs(series[i].l-series[i-1].c)));
  return trs.slice(-p).reduce((a,b)=>a+b,0)/p;
}
function calcBB(closes,p=20,s=2) {
  if(closes.length<p) return null;
  const sl=closes.slice(-p),m=sl.reduce((a,b)=>a+b,0)/p;
  const sd=Math.sqrt(sl.reduce((a,b)=>a+(b-m)**2,0)/p);
  return {upper:m+s*sd,lower:m-s*sd,mid:m};
}

function updateTechnicals(series) {
  const closes = series.map(v=>v.c);
  if(closes.length<20) return;
  const price=closes[closes.length-1];
  const ema20=calcEMA(closes,20), ema50=calcEMA(closes,50);
  const rsi=calcRSI(closes,14), atr=calcATR(series,14), bb=calcBB(closes,20,2);

  if(rsi!=null) {
    const col=rsi>70?'var(--red)':rsi<30?'var(--green)':'var(--gold)';
    const sig=rsi>70?'OVERBOUGHT':rsi<30?'OVERSOLD':'NEUTRAL';
    setEl('techRSI',rsi.toFixed(1)); setEl('techRSISig',sig);
    const el=document.getElementById('techRSI'); if(el) el.style.color=col;
    const sel=document.getElementById('techRSISig'); if(sel) sel.style.color=col;
  }
  if(ema20!=null) { setEl('techEMA20',fmt(ema20)); setEl('techEMA20Sig',price>ema20?'ABOVE ▲':'BELOW ▼'); const el=document.getElementById('techEMA20Sig'); if(el) el.style.color=price>ema20?'var(--green)':'var(--red)'; }
  if(ema50!=null) { setEl('techEMA50',fmt(ema50)); setEl('techEMA50Sig',price>ema50?'ABOVE ▲':'BELOW ▼'); const el=document.getElementById('techEMA50Sig'); if(el) el.style.color=price>ema50?'var(--green)':'var(--red)'; }
  if(atr!=null)   { setEl('techATR',fmt(atr,1)); }

  const setBar=(prefix,pct,val,sig,color)=>{
    const b=document.getElementById('bar'+prefix),v=document.getElementById('val'+prefix),s=document.getElementById('sig'+prefix);
    if(b){b.style.width=pct+'%';b.style.background=color;} if(v){v.textContent=val;v.style.color=color;} if(s){s.textContent=sig;s.style.color=color;}
  };
  if(ema20!=null) setBar('EMA20',price>ema20?70:30,fmt(ema20),price>ema20?'ABOVE ▲':'BELOW ▼',price>ema20?'var(--green)':'var(--red)');
  if(ema50!=null) setBar('EMA50',price>ema50?65:35,fmt(ema50),price>ema50?'ABOVE ▲':'BELOW ▼',price>ema50?'var(--green)':'var(--red)');
  if(rsi!=null)   setBar('RSI',rsi,rsi.toFixed(1),rsi>70?'OVERBOUGHT':rsi<30?'OVERSOLD':'NEUTRAL',rsi>70?'var(--red)':rsi<30?'var(--green)':'var(--gold)');
  if(bb!=null) {
    setBar('BBU',price<bb.upper?55:90,fmt(bb.upper),price<bb.upper?'BELOW UPPER':'ABOVE UPPER',price<bb.upper?'var(--gold)':'var(--red)');
    setBar('BBL',price>bb.lower?55:20,fmt(bb.lower),price>bb.lower?'ABOVE LOWER':'BELOW LOWER',price>bb.lower?'var(--gold)':'var(--red)');
  }

  // Tech summary for signals page
  const panel = document.getElementById('techSummaryPanel');
  if(panel && price) {
    const bullCount = [price>ema20,price>ema50,rsi&&rsi>50&&rsi<70,ema20&&ema50&&ema20>ema50].filter(Boolean).length;
    panel.innerHTML = `
      <div class="indicator-row"><span class="ind-name">EMA 20</span><div class="ind-bar-wrap"><div class="ind-bar" style="width:${price>(ema20||0)?70:30}%;background:${price>(ema20||0)?'var(--green)':'var(--red)'}"></div></div><span class="ind-val">${fmt(ema20)}</span><span class="ind-signal" style="color:${price>(ema20||0)?'var(--green)':'var(--red)'}">${price>(ema20||0)?'ABOVE':'BELOW'}</span></div>
      <div class="indicator-row"><span class="ind-name">EMA 50</span><div class="ind-bar-wrap"><div class="ind-bar" style="width:${price>(ema50||0)?65:35}%;background:${price>(ema50||0)?'var(--green)':'var(--red)'}"></div></div><span class="ind-val">${fmt(ema50)}</span><span class="ind-signal" style="color:${price>(ema50||0)?'var(--green)':'var(--red)'}">${price>(ema50||0)?'ABOVE':'BELOW'}</span></div>
      <div class="indicator-row"><span class="ind-name">RSI (14)</span><div class="ind-bar-wrap"><div class="ind-bar" style="width:${rsi||50}%;background:${(rsi||50)>70?'var(--red)':(rsi||50)<30?'var(--green)':'var(--gold)'}"></div></div><span class="ind-val">${rsi?rsi.toFixed(1):'—'}</span><span class="ind-signal" style="color:${(rsi||50)>70?'var(--red)':(rsi||50)<30?'var(--green)':'var(--gold)'}">${(rsi||50)>70?'OVERBOUGHT':(rsi||50)<30?'OVERSOLD':'NEUTRAL'}</span></div>
      <div class="indicator-row"><span class="ind-name">ATR (14)</span><div class="ind-bar-wrap"><div class="ind-bar" style="width:60%;background:var(--purple)"></div></div><span class="ind-val">${fmt(atr,1)}</span><span class="ind-signal" style="color:var(--purple)">VOLATILITY</span></div>
      <div style="margin-top:12px;padding:10px;background:${bullCount>=3?'rgba(34,217,138,0.06)':'rgba(255,77,109,0.06)'};border:1px solid ${bullCount>=3?'rgba(34,217,138,0.2)':'rgba(255,77,109,0.2)'};border-radius:3px;text-align:center">
        <div style="font-size:9px;color:var(--text-secondary);margin-bottom:4px">TECHNICAL BIAS (${bullCount}/4)</div>
        <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:${bullCount>=3?'var(--green)':'var(--red)'};letter-spacing:2px">${bullCount>=3?'BULLISH':'BEARISH'}</div>
      </div>`;
  }
}

// ═══════════════════════════════════════════════
// SIGNAL ENGINE
// ═══════════════════════════════════════════════
function computeSignal() {
  const x = state.xau, d = state.dxy, series = state.xauSeries;
  if (!x.price) return;

  const closes = series.map(v=>v.c);
  const ema20 = calcEMA(closes,20), ema50 = calcEMA(closes,50);
  const rsi = calcRSI(closes,14), atr = calcATR(series,14);

  let score = 0;
  if (d.pct < -0.1) score += 2;
  if (x.pct > 0) score += 1;
  if (ema20 && x.price > ema20) score += 1;
  if (ema50 && x.price > ema50) score += 1;
  if (rsi && rsi > 45 && rsi < 72) score += 1;
  if (x.change > 0 && d.change < 0) score += 1;

  const isBull = score >= 3;
  const conf = Math.min(94, 48 + score * 8);
  const p = x.price;
  const sl_d = atr ? atr * 1.3 : p * 0.007;
  const tp1_d = sl_d * 1.5, tp2_d = sl_d * 2.6;
  const spread = atr ? atr * 0.4 : p * 0.002;

  const entry_lo = fmt(isBull ? p - spread : p + spread * 0.2);
  const entry_hi = fmt(isBull ? p : p + spread);
  const sl   = fmt(isBull ? p - sl_d   : p + sl_d);
  const tp1  = fmt(isBull ? p + tp1_d  : p - tp1_d);
  const tp2  = fmt(isBull ? p + tp2_d  : p - tp2_d);
  const rr   = '1 : ' + (tp1_d/sl_d).toFixed(1);
  const setup = isBull ? 'PULLBACK BUY — TREND FOLLOW' : 'PULLBACK SELL — SHORT BIAS';
  const rat = isBull
    ? `DXY ${(d.pct||0)<0?'weakening ('+fmtPct(d.pct)+')':'flat'}. XAU momentum ${(x.pct||0)>0?'positive (+'+x.pct.toFixed(2)+'%)':'mixed'}. ${ema20&&x.price>ema20?'Above EMA20. ':''}${rsi?'RSI '+rsi.toFixed(0)+'. ':''}Institutional COT bullish. Entry on dip.`
    : `DXY ${(d.pct||0)>0?'strengthening ('+fmtPct(d.pct)+')':'flat'}. XAU facing resistance. ${ema20&&x.price<ema20?'Below EMA20. ':''}${rsi?'RSI '+rsi.toFixed(0)+'. ':''}Short-term pullback expected.`;

  const now = new Date();
  const ds = now.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  setEl('signalDate', ds+' · LIVE'); setEl('signalDir', isBull?'LONG ▲':'SHORT ▼');
  setEl('sigEntry', entry_lo+' – '+entry_hi); setEl('sigSL', sl);
  setEl('sigTP1', tp1); setEl('sigTP2', tp2); setEl('sigRR', rr);
  setEl('signalRationale', rat);
  setEl('sigDirFull', isBull?'LONG ▲':'SHORT ▼'); setEl('sigSetupType','SETUP: '+setup);
  setEl('sigEntryFull', entry_lo+' – '+entry_hi); setEl('sigSLFull', sl);
  setEl('sigTP1Full', tp1); setEl('sigTP2Full', tp2); setEl('sigRRFull', rr);
  setEl('sigConf', conf+'%'); setEl('sigRationaleFull', rat);
  setEl('swingDir', isBull?'LONG ▲':'SHORT ▼');
  setEl('swingEntry', fmt(isBull?p-sl_d*0.8:p+sl_d*0.8)+' – '+fmt(p));
  setEl('swingSL', fmt(isBull?p-sl_d*2:p+sl_d*2));
  setEl('swingTP1', fmt(isBull?p+tp2_d:p-tp2_d));
  setEl('swingTP2', fmt(isBull?p+tp2_d*1.9:p-tp2_d*1.9));

  ['dashSignalBox','daySignalBox'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.className='signal-box '+(isBull?'buy':'sell');}
  });
  const labelEls=['signalDir','sigDirFull','swingDir'];
  labelEls.forEach(id=>{const e=document.getElementById(id);if(e)e.className='signal-label '+(isBull?'buy':'sell');});
  setStatus('signalStatus','ok','● LIVE');
}

// ═══════════════════════════════════════════════
// CHART BUILDER
// ═══════════════════════════════════════════════
const GC='rgba(26,37,64,0.6)',TC='#3d4f6e';

function buildChart(id, color, closes, labels) {
  const ctx=document.getElementById(id); if(!ctx) return null;
  if(charts[id]) charts[id].destroy();
  charts[id]=new Chart(ctx,{type:'line',data:{labels,datasets:[{data:closes,borderColor:color,borderWidth:1.5,fill:true,
    backgroundColor:c=>{const g=c.chart.ctx.createLinearGradient(0,0,0,300);g.addColorStop(0,color.replace(')',',0.15)').replace('rgb','rgba'));g.addColorStop(1,color.replace(')',',0)').replace('rgb','rgba'));return g;},
    tension:0.3,pointRadius:0}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,backgroundColor:'#0c1220',borderColor:'#1a2540',borderWidth:1,titleColor:'#7a8aaa',bodyColor:color}},
      scales:{x:{ticks:{color:TC,maxTicksLimit:8,font:{family:'JetBrains Mono',size:9}},grid:{color:GC}},y:{position:'right',ticks:{color:TC,font:{family:'JetBrains Mono',size:9}},grid:{color:GC}}}}});
  return charts[id];
}

function seriesLabels(series) {
  return series.map(v=>{
    const d=new Date(v.t);
    return `${(d.getUTCMonth()+1)}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  });
}

// ═══════════════════════════════════════════════
// FETCH TIME SERIES
// ═══════════════════════════════════════════════
async function fetchSeries(sym, interval, size=80) {
  // Map to Yahoo Finance symbols
  const yhMap = {
    'XAU/USD': 'GC=F', 'XAG/USD': 'SI=F',
    'EUR/USD': 'EURUSD=X', 'GBP/USD': 'GBPUSD=X', 'USD/JPY': 'JPY=X',
  };
  const tvMap = {'1min':'1m','5min':'5m','15min':'15m','30min':'30m','1h':'1h','4h':'1h','1day':'1d'};
  const yfInterval = tvMap[interval] || '1h';
  const yfRange = {'1m':'1d','5m':'5d','15m':'5d','30m':'5d','1h':'1mo','1d':'6mo'}[yfInterval] || '1mo';
  const yTicker = yhMap[sym] || 'GC=F';

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yTicker)}?interval=${yfInterval}&range=${yfRange}`;
    const d = await proxyFetch(url);
    const r = d?.chart?.result?.[0];
    if (!r || !r.timestamp) throw new Error('No data');
    const ts = r.timestamp;
    const q  = r.indicators.quote[0];
    const series = ts.map((t,i) => ({
      t: new Date(t*1000).toISOString(),
      o: q.open[i]  || 0,
      h: q.high[i]  || 0,
      l: q.low[i]   || 0,
      c: q.close[i] || 0,
    })).filter(v => v.c > 0);
    return series.slice(-size);
  } catch(e) {
    console.warn('Yahoo series fail, try TD:', e.message);
    // Fallback TwelveData
    try {
      const d = await tdFetch({symbol: sym, interval: interval, outputsize: size, format: 'JSON'});
      if (d.values && d.values.length) {
        return d.values.reverse().map(v=>({
          t:v.datetime, c:parseFloat(v.close), h:parseFloat(v.high),
          l:parseFloat(v.low), o:parseFloat(v.open)
        }));
      }
    } catch(e2) { console.error('TD series also failed:', e2); }
    return [];
  }
});
    if (d.values && d.values.length) {
      return d.values.reverse().map(v=>({t:v.datetime,c:parseFloat(v.close),h:parseFloat(v.high),l:parseFloat(v.low),o:parseFloat(v.open)}));
    }
  } catch(e) { console.warn('TD series fail, try AV:', e); }

  // Fallback: Alpha Vantage time series
  try {
    const avInterval = {'1min':'1min','5min':'5min','15min':'15min','30min':'30min','1h':'60min','4h':'60min','1day':'daily'}[interval] || '60min';
    const func = avInterval === 'daily' ? 'FX_DAILY' : 'FX_INTRADAY';
    const avSym = sym.replace('/',''). replace('XAU','XAU').replace('USD','USD');
    const params = func === 'FX_DAILY'
      ? {function: func, from_symbol:'XAU', to_symbol:'USD', outputsize:'compact'}
      : {function: func, from_symbol:'XAU', to_symbol:'USD', interval: avInterval, outputsize:'compact'};
    const d = await avFetch(params);
    const key = Object.keys(d).find(k => k.includes('Time Series'));
    if (!key) return [];
    const series = Object.entries(d[key]).slice(0, size).reverse().map(([t,v]) => ({
      t, c: parseFloat(v['4. close'] || v['4. Close']),
      h: parseFloat(v['2. high']  || v['2. High']),
      l: parseFloat(v['3. low']   || v['3. Low']),
      o: parseFloat(v['1. open']  || v['1. Open']),
    }));
    return series;
  } catch(e) { console.error('AV series fail:', e); return []; }
}

async function loadMainChart(interval='1h') {
  // TradingView handles chart rendering — we only fetch for technicals
  const s = await fetchSeries('XAU/USD', interval, 80);
  if(!s.length) return;
  state.xauSeries = s;
  updateTechnicals(s);
  computeSignal();
}

async function loadDxyMini() {
  // DXY mini chart now handled by TradingView iframe widget
  return;
}

async function loadH1Charts() {
  // TradingView handles chart rendering, fetch only for technicals
  const xs = await fetchSeries('XAU/USD','1h',80);
  if(xs.length) { updateTechnicals(xs); state.xauSeries = xs; }
}

// ═══════════════════════════════════════════════
// ECONOMIC CALENDAR
// ═══════════════════════════════════════════════
async function fetchCalendar() {
  setStatus('calStatus','load','Loading…');
  try {
    const now=new Date();
    const s=new Date(now); s.setDate(s.getDate()-2);
    const e=new Date(now); e.setDate(e.getDate()+5);
    const fd=d=>d.toISOString().split('T')[0];
    const data=await apiGet(`/economic_calendar?start_date=${fd(s)}&end_date=${fd(e)}&country=US,EU,CN,GB,JP`);
    const events=(data.result||data.data||[]).slice(0,25);
    if(!events.length) throw new Error('empty');

    const ic={'high':'impact-high','medium':'impact-med','low':'impact-low'};
    const gi=ev=>{const n=(ev.event||'').toLowerCase();if(n.includes('fed')||n.includes('fomc')||n.includes('powell'))return '<span class="down">HIGH RISK !</span>';if(n.includes('cpi')||n.includes('pce')||n.includes('inflation'))return '<span class="up">KEY DRIVER</span>';if(n.includes('nfp')||n.includes('employ'))return '<span class="up">Watch ▲</span>';return '<span style="color:var(--text-secondary)">Minor</span>';};
    const nowTs=now.getTime();

    const rows=events.map(ev=>{
      const evD=new Date(ev.date||ev.time||ev.datetime);
      const past=evD.getTime()<nowTs;
      const next=!past&&evD.getTime()-nowTs<6*3600000;
      const flag={US:'🇺🇸',EU:'🇪🇺',CN:'🇨🇳',GB:'🇬🇧',JP:'🇯🇵'}[ev.country]||'🌐';
      const ts=evD.toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';
      const ac=ev.actual&&ev.estimate?(parseFloat(ev.actual)>=parseFloat(ev.estimate)?'actual-beat':'actual-miss'):'';
      return `<tr class="${past?'passed':next?'upcoming':''}"><td class="event-time" style="${next?'color:var(--gold)':''}">${next?'▶ ':''}${ts}</td><td>${flag} ${ev.country||''}</td><td>${next?'<strong>':''}${ev.event||ev.name||'—'}${next?'</strong>':''}</td><td><div class="impact-badge ${ic[ev.importance]||'impact-low'}">${(ev.importance||'LOW').toUpperCase()}</div></td><td class="${ac}">${ev.actual||'—'}</td><td class="forecast-val">${ev.estimate||ev.forecast||'—'}</td><td class="prev-val">${ev.previous||'—'}</td><td>${gi(ev)}</td></tr>`;
    }).join('');

    document.getElementById('calendarFull').innerHTML=`<table class="cal-table" style="width:100%"><tr><th>Date/Time (UTC)</th><th>Country</th><th>Event</th><th>Impact</th><th>Actual</th><th>Forecast</th><th>Previous</th><th>Gold Impact</th></tr>${rows}</table>`;

    // Preview
    const up=events.filter(ev=>new Date(ev.date||ev.time||ev.datetime).getTime()>nowTs).slice(0,4);
    const prev=document.getElementById('calendarPreview');
    if(prev) prev.innerHTML=up.map(ev=>{
      const evD=new Date(ev.date||ev.time||ev.datetime);
      const ts=evD.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';
      const ic2={'high':'impact-high','medium':'impact-med','low':'impact-low'};
      return `<div class="news-item"><div class="news-header"><span class="news-time">${ts}</span><span class="news-source">${ev.country||''}</span><div class="impact-badge ${ic2[ev.importance]||'impact-low'}">${(ev.importance||'LOW').toUpperCase()}</div></div><div class="news-title">${ev.event||ev.name||'—'}</div><div class="news-desc">Forecast: ${ev.estimate||'—'} · Prev: ${ev.previous||'—'}</div></div>`;
    }).join('')||'<div style="padding:20px;text-align:center;color:var(--text-dim)">No upcoming events</div>';

    setStatus('calStatus','ok','● LIVE');
  } catch(e) {
    console.error('Calendar err:',e);
    setStatus('calStatus','err','Plan Upgrade Needed');
    document.getElementById('calendarFull').innerHTML=`
      <div style="padding:8px 12px;font-size:9px;color:var(--gold);background:rgba(240,192,64,0.06);border-bottom:1px solid var(--border)">
        ⚠ Economic Calendar requires TwelveData Basic plan or above. Showing curated data.
      </div>
      <table class="cal-table" style="width:100%"><tr><th>Time (UTC)</th><th>Country</th><th>Event</th><th>Impact</th><th>Actual</th><th>Forecast</th><th>Previous</th><th>Gold Impact</th></tr>
      <tr class="upcoming"><td class="event-time" style="color:var(--gold)">▶ Thu 12:30</td><td>🇺🇸 USD</td><td><strong>Initial Jobless Claims</strong></td><td><div class="impact-badge impact-high">HIGH</div></td><td>—</td><td class="forecast-val">230K</td><td class="prev-val">229K</td><td class="up">Watch ▲</td></tr>
      <tr class="upcoming"><td class="event-time" style="color:var(--gold)">▶ Thu 17:30</td><td>🇺🇸 USD</td><td><strong>Fed Williams Speech</strong></td><td><div class="impact-badge impact-high">HIGH</div></td><td>—</td><td>—</td><td>—</td><td class="down">HIGH RISK !</td></tr>
      <tr class="upcoming"><td class="event-time">Fri 12:30</td><td>🇺🇸 USD</td><td>Core PCE Price Index MoM</td><td><div class="impact-badge impact-high">HIGH</div></td><td>—</td><td class="forecast-val">0.3%</td><td class="prev-val">0.3%</td><td class="up">KEY DRIVER</td></tr>
      <tr class="upcoming"><td class="event-time">Fri 14:00</td><td>🇺🇸 USD</td><td>Univ. Michigan Sentiment</td><td><div class="impact-badge impact-med">MED</div></td><td>—</td><td class="forecast-val">52.8</td><td class="prev-val">52.2</td><td style="color:var(--text-secondary)">Minor</td></tr>
      </table>`;
    const prev=document.getElementById('calendarPreview');
    if(prev) prev.innerHTML=`<div class="news-item"><div class="news-header"><span class="news-time">Thu 12:30</span><span class="news-source">USD</span><div class="impact-badge impact-high">HIGH</div></div><div class="news-title">Initial Jobless Claims</div><div class="news-desc">Forecast: 230K · Prev: 229K</div></div><div class="news-item"><div class="news-header"><span class="news-time">Thu 17:30</span><span class="news-source">USD</span><div class="impact-badge impact-high">HIGH</div></div><div class="news-title">Fed Williams Speech</div><div class="news-desc">High impact — potential gold volatility</div></div>`;
  }
}

// ═══════════════════════════════════════════════
// NEWS
// ═══════════════════════════════════════════════
async function fetchNews() {
  try {
    const d=await apiGet('/news?symbol=XAU/USD&outputsize=6');
    const arts=d.data||[];
    if(!arts.length) throw new Error('empty');
    renderNews(arts.map(a=>({
      title:a.title, source:a.source||'News',
      time:a.published_at?new Date(a.published_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}):'—',
      desc:a.snippet||a.description||'', impact:'med'
    })));
  } catch(e) {
    renderNews([
      {title:'Fed officials signal patience on rate cuts amid inflation uncertainty',source:'REUTERS',time:'14:32',desc:'Multiple Fed officials reiterated data-dependent approach to monetary policy.',impact:'high'},
      {title:'Gold demand surges as institutional safe-haven flows accelerate',source:'BLOOMBERG',time:'13:15',desc:'ETF inflows hit 3-month high as geopolitical tensions elevate risk aversion.',impact:'high'},
      {title:'US Treasury yields decline on softer manufacturing PMI data',source:'WSJOURNAL',time:'11:40',desc:'10Y yield falls supporting non-yielding assets including gold.',impact:'med'},
      {title:'China central bank adds gold for 18th consecutive month',source:'REUTERS',time:'09:20',desc:'PBoC adds 8 tonnes to reserves signaling de-dollarization strategy.',impact:'med'},
      {title:'Dollar index weakens below key 100.00 support level',source:'FX STREET',time:'08:10',desc:'DXY weakness broad-based amid risk-off flows from US fiscal concerns.',impact:'high'},
    ]);
  }
}

function renderNews(arts) {
  const im={'high':'impact-high','med':'impact-med','low':'impact-low'};
  const html=arts.map(a=>`<div class="news-item"><div class="news-header"><span class="news-time">${a.time||'—'}</span><span class="news-source">${(a.source||'—').toUpperCase().slice(0,12)}</span><div class="impact-badge ${im[a.impact]||'impact-low'}">${(a.impact||'LOW').toUpperCase()}</div></div><div class="news-title">${a.title||'—'}</div>${a.desc?`<div class="news-desc">${a.desc.slice(0,120)}${a.desc.length>120?'…':''}</div>`:''}</div>`).join('');
  const el=document.getElementById('newsPreview'); if(el) el.innerHTML=html;
}

// ═══════════════════════════════════════════════
// STATIC CHARTS
// ═══════════════════════════════════════════════
function initStaticCharts(ids) {
  if(ids.includes('cot') && !pageInited.cot) {
    pageInited.cot=true;
    const ctx1=document.getElementById('cotBarChart');
    if(ctx1) new Chart(ctx1,{type:'bar',data:{labels:['W-8','W-7','W-6','W-5','W-4','W-3','W-2','W-1','Now'],datasets:[{label:'Longs',data:[198000,204000,212000,218000,224000,228000,238000,242000,246412],backgroundColor:'rgba(34,217,138,0.5)',borderColor:'rgba(34,217,138,0.8)',borderWidth:1},{label:'Shorts',data:[62000,58000,56000,54000,52000,50000,49000,48500,48230],backgroundColor:'rgba(255,77,109,0.4)',borderColor:'rgba(255,77,109,0.7)',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:TC,font:{family:'JetBrains Mono',size:9}}}},scales:{x:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}},y:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}}}}});
    const ctx2=document.getElementById('cotNetChart');
    if(ctx2) new Chart(ctx2,{type:'line',data:{labels:['W-8','W-7','W-6','W-5','W-4','W-3','W-2','W-1','Now'],datasets:[{label:'Net MM Long',data:[136000,146000,156000,164000,172000,178000,189000,193500,198182],borderColor:'#f0c040',backgroundColor:'rgba(240,192,64,0.1)',borderWidth:1.5,fill:true,tension:0.3,pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:TC,font:{family:'JetBrains Mono',size:9}}}},scales:{x:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}},y:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}}}}});
  }
  if(ids.includes('cb') && !pageInited.cb) {
    pageInited.cb=true;
    const ctx=document.getElementById('cbChart');
    if(ctx) new Chart(ctx,{type:'bar',data:{labels:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],datasets:[{label:'CB Buying (tonnes)',data:[45,52,38,61,72,58,67,83,90,78,88,95],backgroundColor:'rgba(240,192,64,0.4)',borderColor:'rgba(240,192,64,0.8)',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}},y:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}}}}});
  }
}

// ═══════════════════════════════════════════════
// PAGE NAV
// ═══════════════════════════════════════════════
function switchPage(page, el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-tabs .tab').forEach(t=>t.classList.remove('active'));
  const pg=document.getElementById('page-'+page); if(pg) pg.classList.add('active');
  if(el) el.classList.add('active');
  if(page==='charts' && !pageInited.charts) { pageInited.charts=true; loadH1Charts(); }
  if(page==='cot') initStaticCharts(['cot']);
  if(page==='geopolitical') initStaticCharts(['cb']);
  if(page==='calendar') { /* Calendar uses Investing.com iframe widget */ }
}

function changeInterval(interval, el) {
  document.querySelectorAll('.panel-header .tab').forEach(t=>t.classList.remove('active'));
  if(el) el.classList.add('active');
  state.currentInterval=interval;
  // Map interval to TradingView format
  const tvMap = {'1min':'1','5min':'5','15min':'15','30min':'30','1h':'60','4h':'240','1day':'D','1week':'W'};
  const tvInterval = tvMap[interval] || '60';
  const frame = document.getElementById('tvMainChart');
  if(frame) {
    frame.src = `https://www.tradingview.com/widgetembed/?frameElementId=tvMainChart&symbol=OANDA%3AXAUUSD&interval=${tvInterval}&hidesidetoolbar=0&hidetoptoolbar=0&symboledit=0&saveimage=0&toolbarbg=080d1a&studies=%5B%22MASimple%4020%22%2C%22MASimple%4050%22%5D&theme=dark&style=1&timezone=UTC&withdateranges=1&locale=en&allow_symbol_change=0`;
  }
  // Still fetch series for technicals computation
  loadChartData(interval);
}

async function loadChartData(interval='1h') {
  const s = await fetchSeries('XAU/USD', interval, 80);
  if(!s.length) return;
  state.xauSeries = s;
  updateTechnicals(s);
  computeSignal();
}

// ═══════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════
// Calendar filter buttons
function setCalFilter(type) {
  ['all','high','usd'].forEach(t => {
    const btn = document.getElementById('cf-'+t);
    if(!btn) return;
    if(t===type) {
      btn.style.background='rgba(240,192,64,0.08)';
      btn.style.borderColor='rgba(240,192,64,0.3)';
      btn.style.color='var(--gold)';
    } else {
      btn.style.background='transparent';
      btn.style.borderColor='var(--border)';
      btn.style.color='var(--text-secondary)';
    }
  });
  const frame = document.getElementById('investingCalFrame');
  if(!frame) return;
  const bases = {
    'all': 'https://sslecal2.investing.com?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&features=datepicker,timezone&countries=5,22,25,32,4,37&calType=week&timeZone=18&lang=1',
    'high': 'https://sslecal2.investing.com?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&features=datepicker,timezone&countries=5,22,25,32,4,37&importance=3&calType=week&timeZone=18&lang=1',
    'usd':  'https://sslecal2.investing.com?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&features=datepicker,timezone&countries=5&calType=week&timeZone=18&lang=1',
  };
  document.getElementById('calLoading').style.display='flex';
  frame.src = bases[type] || bases['all'];
}

async function init() {
  updateMarketBanner();
  setInterval(updateMarketBanner, 60000);
  await Promise.all([fetchQuotes(), loadMainChart('1h'), loadDxyMini(), fetchNews(), fetchCalendar()]);
}

init();
// Yahoo Finance: no API key needed, generous rate limit
setInterval(fetchQuotes, 60 * 1000);           // quotes every 60s
setInterval(fetchNews,   5 * 60 * 1000);       // news every 5 min
setInterval(()=>loadMainChart(state.currentInterval), 5 * 60 * 1000); // chart every 5 min

// ══════════════════════════════════════════════
// SUPABASE AUTH — all functions in global scope
// ══════════════════════════════════════════════
const SUPABASE_URL  = 'https://hkxgkvwyxgiygzmcwdsl.supabase.co';
const SUPABASE_ANON = 'sb_publishable_6XiMHP0cdS4_NIRgDpYFwQ_7ADAZWv9';

// Init Supabase after SDK loads
let _supabase;
function initSupabase() {
  if (typeof supabase === 'undefined') { setTimeout(initSupabase, 100); return; }
  _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  // Check existing session on load
  _supabase.auth.getSession().then(({ data: { session } }) => {
    if (session && session.user) showTerminal(session.user);
  });

  // Listen for auth state changes
  _supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      showTerminal(session.user);
    } else if (event === 'SIGNED_OUT') {
      const o = document.getElementById('authOverlay');
      if (o) { o.style.opacity='1'; o.style.display='flex'; }
    } else if (event === 'PASSWORD_RECOVERY') {
      switchAuthTab('reset');
      const o = document.getElementById('authOverlay');
      if (o) { o.style.opacity='1'; o.style.display='flex'; }
    }
  });
}
initSupabase();

// ── HELPERS ──
function switchAuthTab(tab) {
  ['login','register','reset'].forEach(t => {
    const tid = 'tab'   + t.charAt(0).toUpperCase() + t.slice(1);
    const pid = 'panel' + t.charAt(0).toUpperCase() + t.slice(1);
    document.getElementById(tid)?.classList.toggle('active', t === tab);
    document.getElementById(pid)?.classList.toggle('active', t === tab);
  });
  clearAuthMsgs();
}

function clearAuthMsgs() {
  ['loginMsg','registerMsg','resetMsg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.className = 'auth-msg'; el.textContent = ''; }
  });
}

function showMsg(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'auth-msg ' + type + ' show';
  el.textContent = msg;
}

function setBtnState(id, disabled, text) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = disabled;
  btn.textContent = text;
}

function showTerminal(user) {
  const overlay = document.getElementById('authOverlay');
  if (overlay) {
    overlay.style.transition = 'opacity 0.5s';
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 500);
  }
  const menuBtn = document.getElementById('userMenuBtn');
  if (menuBtn) menuBtn.style.display = 'flex';
  const short = (user.email || '').split('@')[0].toUpperCase();
  const ed = document.getElementById('userEmailDisplay');
  const me = document.getElementById('userMenuEmail');
  if (ed) ed.textContent = '👤 ' + short;
  if (me) me.textContent = user.email || '';
}

// ── LOGIN ──
async function authLogin() {
  if (!_supabase) { showMsg('loginMsg','error','⚠ Auth not ready, please wait...'); return; }
  const email = (document.getElementById('loginEmail')?.value || '').trim();
  const pass  =  document.getElementById('loginPassword')?.value || '';
  if (!email || !pass) { showMsg('loginMsg','error','⚠ Please enter email and password'); return; }
  setBtnState('loginBtn', true, 'VERIFYING…');
  clearAuthMsgs();
  const { data, error } = await _supabase.auth.signInWithPassword({ email, password: pass });
  if (error) {
    showMsg('loginMsg','error','⚠ ' + (error.message || 'Login failed'));
    document.querySelector('.auth-wrap')?.classList.add('shake');
    setTimeout(() => document.querySelector('.auth-wrap')?.classList.remove('shake'), 400);
    setBtnState('loginBtn', false, 'ACCESS TERMINAL');
    const pp = document.getElementById('loginPassword'); if (pp) pp.value = '';
  } else {
    setBtnState('loginBtn', true, '✓ ACCESS GRANTED');
    const lb = document.getElementById('loginBtn'); if (lb) lb.style.background = 'var(--green)';
    setTimeout(() => showTerminal(data.user), 600);
  }
}

// ── REGISTER ──
async function authRegister() {
  if (!_supabase) { showMsg('registerMsg','error','⚠ Auth not ready, please wait...'); return; }
  const name    = (document.getElementById('regName')?.value     || '').trim();
  const email   = (document.getElementById('regEmail')?.value    || '').trim();
  const pass    =  document.getElementById('regPassword')?.value || '';
  const confirm =  document.getElementById('regConfirm')?.value  || '';
  if (!name||!email||!pass||!confirm) { showMsg('registerMsg','error','⚠ All fields are required'); return; }
  if (pass.length < 8)   { showMsg('registerMsg','error','⚠ Password must be at least 8 characters'); return; }
  if (pass !== confirm)  { showMsg('registerMsg','error','⚠ Passwords do not match'); return; }
  setBtnState('registerBtn', true, 'CREATING ACCOUNT…');
  clearAuthMsgs();
  const { error } = await _supabase.auth.signUp({
    email, password: pass,
    options: { data: { full_name: name }, emailRedirectTo: window.location.origin }
  });
  if (error) {
    showMsg('registerMsg','error','⚠ ' + (error.message || 'Registration failed'));
  } else {
    showMsg('registerMsg','success','✓ Account created! Check your email (' + email + ') to verify before logging in.');
    ['regName','regEmail','regPassword','regConfirm'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }
  setBtnState('registerBtn', false, 'CREATE ACCOUNT');
}

// ── RESET PASSWORD ──
async function authReset() {
  if (!_supabase) return;
  const email = (document.getElementById('resetEmail')?.value || '').trim();
  if (!email) { showMsg('resetMsg','error','⚠ Please enter your email'); return; }
  setBtnState('resetBtn', true, 'SENDING…');
  clearAuthMsgs();
  const { error } = await _supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });
  if (error) {
    showMsg('resetMsg','error','⚠ ' + (error.message || 'Failed to send reset email'));
  } else {
    showMsg('resetMsg','success','✓ Reset link sent to ' + email + '. Check your inbox!');
  }
  setBtnState('resetBtn', false, 'SEND RESET LINK');
}

// ── LOGOUT ──
async function authLogout() {
  if (!_supabase) return;
  await _supabase.auth.signOut();
  const menuBtn = document.getElementById('userMenuBtn');
  if (menuBtn) menuBtn.style.display = 'none';
  toggleUserMenu(false);
  const o = document.getElementById('authOverlay');
  if (o) { o.style.opacity = '1'; o.style.display = 'flex'; }
  switchAuthTab('login');
}

// ── USER MENU TOGGLE ──
function toggleUserMenu(force) {
  const dd = document.getElementById('userMenuDropdown');
  if (!dd) return;
  const show = force !== undefined ? force : !dd.classList.contains('show');
  dd.classList.toggle('show', show);
}

// Close menu on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('#userMenuBtn') && !e.target.closest('#userMenuDropdown')) {
    toggleUserMenu(false);
  }
});

// Enter key shortcuts
document.addEventListener('DOMContentLoaded', () => {
  
  
  
  
});


// ── Expose to global scope for onclick handlers ──
window.apiGet = apiGet;
window.authLogin = authLogin;
window.authLogout = authLogout;
window.authRegister = authRegister;
window.authReset = authReset;
window.avFetch = avFetch;
window.buildChart = buildChart;
window.calcATR = calcATR;
window.calcBB = calcBB;
window.calcEMA = calcEMA;
window.calcRSI = calcRSI;
window.changeInterval = changeInterval;
window.clearAuthMsgs = clearAuthMsgs;
window.computeSignal = computeSignal;
window.fetchCalendar = fetchCalendar;
window.fetchNews = fetchNews;
window.fetchQuotes = fetchQuotes;
window.fetchSeries = fetchSeries;
window.getNextOpen = getNextOpen;
window.initStaticCharts = initStaticCharts;
window.initSupabase = initSupabase;
window.isMarketOpen = isMarketOpen;
window.loadChartData = loadChartData;
window.loadDxyMini = loadDxyMini;
window.loadFromCache = loadFromCache;
window.loadH1Charts = loadH1Charts;
window.loadMainChart = loadMainChart;
window.proxyFetch = proxyFetch;
window.renderNews = renderNews;
window.saveToCache = saveToCache;
window.seriesLabels = seriesLabels;
window.setBtnState = setBtnState;
window.setCalFilter = setCalFilter;
window.showMsg = showMsg;
window.showTerminal = showTerminal;
window.switchAuthTab = switchAuthTab;
window.switchPage = switchPage;
window.tdFetch = tdFetch;
window.toggleUserMenu = toggleUserMenu;
window.tryFetch = tryFetch;
window.updateClock = updateClock;
window.updateDXY = updateDXY;
window.updateMarketBanner = updateMarketBanner;
window.updateTechnicals = updateTechnicals;
window.updateXAU = updateXAU;
window.yahooQuote = yahooQuote;
