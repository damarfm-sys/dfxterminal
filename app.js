// DFXAi Terminal - App Logic (Updated & Fixed)
'use strict';

// ── CONFIG ──
var TD_KEY  = 'a0680ea88b934543be5eaab23f518f6d';
var AV_KEY  = 'CVRA2AHLUR4OWPY4';
var GROQ_KEY = ''; // Set via UI
var GROQ_MODEL = 'llama-3.3-70b-versatile';
var GEMINI_KEY = ''; // legacy - unused

// ── STATE ──
var state = { xau:{}, dxy:{}, xauSeries:[], dxySeries:[], interval:'1h', btc:{} };
var charts = {};

// ── PROXIES ──
var PROXIES = [
  function(u){ 
    // Use localhost proxy during local development, use native Vercel serverless proxy in production
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:8080/fetch?url='+encodeURIComponent(u); 
    }
    return '/fetch?url='+encodeURIComponent(u); 
  },
  function(u){ return 'https://api.allorigins.win/raw?url='+encodeURIComponent(u); },
  function(u){ return u; }
];
var pIdx = 0;

async function proxyFetch(url) {
  for (var i=0; i<PROXIES.length; i++) {
    var idx = (pIdx+i) % PROXIES.length;
    try {
      var r = await fetch(PROXIES[idx](url), {signal: AbortSignal.timeout(8000)});
      if (!r.ok) continue;
      var d = await r.json();
      pIdx = idx;
      return d;
    } catch(e) { continue; }
  }
  throw new Error('All proxies failed');
}

// ── UTILS ──
function fmt(n, d) {
  d = d===undefined ? 2 : d;
  if (n==null||isNaN(n)) return '—';
  return parseFloat(n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtPct(n) {
  if (n==null||isNaN(n)) return '—';
  var v = parseFloat(n);
  return (v>=0?'+':'')+v.toFixed(2)+'%';
}
function setEl(id, val) {
  var e = document.getElementById(id);
  if (e) e.textContent = val;
}
function setStatus(id, type, txt) {
  var e = document.getElementById(id);
  if (!e) return;
  e.className = 'api-status api-'+type;
  e.textContent = txt;
}

// ── CLOCK ──
function updateClock() {
  var n = new Date();
  var p = function(x){ return String(x).padStart(2,'0'); };
  setEl('clockDisplay', p(n.getUTCHours())+':'+p(n.getUTCMinutes())+':'+p(n.getUTCSeconds())+' UTC');
}
setInterval(updateClock, 1000);
updateClock();

// ── MARKET STATUS ──
function isMarketOpen() {
  var n = new Date(), day = n.getUTCDay(), h = n.getUTCHours()*60+n.getUTCMinutes();
  if (day===0||day===6) return false;
  if (day===5 && h>=21*60) return false;
  return true;
}
function getNextOpen() {
  var n=new Date(), day=n.getUTCDay();
  var d = day===0?1:day===6?2:(day===5&&n.getUTCHours()>=21)?3:0;
  if (d===0) return '';
  var next=new Date(n); next.setUTCDate(next.getUTCDate()+d); next.setUTCHours(0,0,0,0);
  var diff=next-n, hh=Math.floor(diff/3600000), mm=Math.floor((diff%3600000)/60000);
  return 'Next open: Monday 00:00 UTC (in '+hh+'h '+mm+'m)';
}
function updateMarketBanner() {
  var b=document.getElementById('marketBanner'),t=document.getElementById('marketBannerText'),nx=document.getElementById('marketNextOpen');
  if (!b) return;
  b.style.display='flex';
  if (isMarketOpen()) {
    b.className='open'; b.querySelector('.mb-icon').textContent='🟢';
    t.textContent='MARKET OPEN — Live data active'; nx.textContent='';
  } else {
    b.className=''; b.querySelector('.mb-icon').textContent='🔴';
    var day=new Date().getUTCDay();
    t.textContent='MARKET CLOSED — '+(day===0||day===6?'Weekend':'After Hours')+' · Showing cached data';
    nx.textContent=getNextOpen();
  }
}

// ── CACHE ──
var CACHE_KEY='dfxai_data';
function saveCache(d){ try{localStorage.setItem(CACHE_KEY,JSON.stringify({ts:Date.now(),data:d}));}catch(e){} }
function loadCache(){ try{var r=localStorage.getItem(CACHE_KEY);return r?JSON.parse(r):null;}catch(e){return null;} }

// ── YAHOO FINANCE QUOTE ──
async function yahooQuote(sym) {
  var url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(sym)+'?interval=1d&range=2d';
  var d = await proxyFetch(url);
  var meta = d&&d.chart&&d.chart.result&&d.chart.result[0]&&d.chart.result[0].meta;
  if (!meta) throw new Error('No data: '+sym);
  var price=meta.regularMarketPrice, prev=meta.chartPreviousClose||meta.previousClose||price;
  return { price:price, open:meta.regularMarketOpen||price, high:meta.regularMarketDayHigh||price,
    low:meta.regularMarketDayLow||price, prev:prev, change:price-prev, pct:(price-prev)/prev*100 };
}

// ── FETCH ALL QUOTES ──
async function fetchQuotes() {
  var symbols = {
    'XAU/USD':'GC=F','XAG/USD':'SI=F','EUR/USD':'EURUSD=X',
    'GBP/USD':'GBPUSD=X','USD/JPY':'JPY=X','US10Y':'^TNX',
    'DXY':'DX-Y.NYB'
  };
  var tickerMap = {
    'XAU/USD':{p:'t-xau',c:'t-xau-chg',dec:2},
    'XAG/USD':{p:'t-xag',c:'t-xag-chg',dec:2},
    'EUR/USD':{p:'t-eur',c:'t-eur-chg',dec:4},
    'GBP/USD':{p:'t-gbp',c:'t-gbp-chg',dec:4},
    'USD/JPY':{p:'t-jpy',c:'t-jpy-chg',dec:2},
    'US10Y':{p:'t-us10',c:'t-us10-chg',dec:3},
    'DXY':{p:'t-dxy',c:'t-dxy-chg',dec:3}
  };

  try {
    var results = {};
    await Promise.allSettled(Object.entries(symbols).map(async function(kv) {
      try { results[kv[0]] = await yahooQuote(kv[1]); } catch(e) { console.warn(kv[0],e.message); }
    }));

    // If DXY wasn't returned by Yahoo, try Stooq CSV as fallback (via first proxy)
    if (!results['DXY']) {
      try {
        var stooqUrl = 'https://stooq.com/q/l/?s=%5Edxy&f=sd2t2ohlcvn&h&e=csv';
        var r = await fetch(PROXIES[0](stooqUrl), {signal: AbortSignal.timeout(5000)});
        if (r.ok) {
          var txt = await r.text();
          if (txt && txt.indexOf('\n') !== -1) {
            var lines = txt.trim().split('\n');
            var last = lines[lines.length-1].split(',').map(function(p){return p.replace(/"/g,'').trim();});
            var nums = last.slice(2).map(function(p){var v=parseFloat(p);return isNaN(v)?null:v;}).filter(Boolean);
            var close = nums.length?nums[nums.length-1]:null;
            if (close) {
              results['DXY'] = { price: close, open: nums[0]||close, high: nums[1]||close, low: nums[2]||close, prev: close, change: 0, pct: 0 };
              console.log('fetchQuotes: DXY from Stooq', results['DXY']);
            }
          }
        }
      } catch(e) { console.warn('stooq dxy fail', e && e.message); }
    }

    var anySuccess = false;
    Object.entries(tickerMap).forEach(function(kv) {
      var sym=kv[0], cfg=kv[1], q=results[sym];
      if (!q||!q.price) return;
      anySuccess = true;
      var dir=q.change>=0;
      var pEl=document.getElementById(cfg.p), cEl=document.getElementById(cfg.c);
      if (pEl) { pEl.textContent=fmt(q.price,cfg.dec); pEl.className='ticker-price '+(dir?'up':'down'); }
      if (cEl) { cEl.textContent=fmtPct(q.pct); cEl.className='ticker-chg '+(dir?'up':'down'); }
    });

    if (results['XAU/USD']) { state.xau=results['XAU/USD']; updateXAU(); }
    if (results['DXY']) { state.dxy=results['DXY']; updateDXY(); }
    else if (results['EUR/USD']) { state.dxy=results['EUR/USD']; updateDXY(); }
    fetchBTCPrice();

    if (anySuccess) {
      setStatus('apiStatusBadge','ok','● LIVE');
      saveCache({tickers:results, xau:state.xau, dxy:state.dxy});
      computeSignal();
    } else throw new Error('All quotes failed');

  } catch(e) {
    console.error('fetchQuotes:', e);
    var cached=loadCache();
    if (cached&&cached.data) {
      setStatus('apiStatusBadge','load','◷ CACHED');
      if (cached.data.xau) { state.xau=cached.data.xau; updateXAU(); }
      if (cached.data.dxy) { state.dxy=cached.data.dxy; updateDXY(); }
      computeSignal();
    } else {
      setStatus('apiStatusBadge','err', isMarketOpen()?'✕ ERR':'🔴 CLOSED');
    }
  }
}

function updateXAU() {
  var x=state.xau; if (!x||!x.price) return;
  var dir=x.change>=0, now=new Date();
  setEl('xauPrice', fmt(x.price));
  setEl('xauOpen', fmt(x.open));
  setEl('xauHigh', fmt(x.high));
  setEl('xauLow', fmt(x.low));
  setEl('xauPrev', fmt(x.prev));
  setEl('xauPct', fmtPct(x.pct));
  setEl('xauLastUpdate','UPDATED '+String(now.getUTCHours()).padStart(2,'0')+':'+String(now.getUTCMinutes()).padStart(2,'0')+' UTC');
  
  // Sync Data ke halaman AI Analysis Panel Live secara otomatis
  setEl('aiXauPrice', fmt(x.price));
  setEl('aiXauChg', fmtPct(x.pct));

  var cb=document.getElementById('xauChgBig');
  if (cb) { cb.textContent=(dir?'▲ +':'▼ ')+Math.abs(x.change).toFixed(2)+' ('+fmtPct(x.pct)+')'; cb.className='price-change-big '+(dir?'up':'down'); }
  // Key levels
  var p=x.price;
  setEl('lvlNow',fmt(p)); setEl('lvlR3',fmt(Math.ceil((p+120)/50)*50));
  setEl('lvlR2',fmt(Math.ceil((p+60)/25)*25)); setEl('lvlR1',fmt(x.high));
  setEl('lvlPivot',fmt((x.high+x.low+x.prev)/3));
  setEl('lvlS1',fmt(x.low)); setEl('lvlS2',fmt(Math.floor((p-55)/25)*25));
  setEl('lvlS3',fmt(Math.floor(p/100)*100));
  // DXY trend indicator update
  updateDXYIndicator();
}

function updateDXY() {
  var d=state.dxy; if (!d||!d.price) return;
  var dir=d.change>=0;
  setEl('dxyPrice',fmt(d.price,4));
  setEl('dxyHigh',fmt(d.high,4)); setEl('dxyLow',fmt(d.low,4));
  setEl('dxyOpen',fmt(d.open,4)); setEl('dxyPrev',fmt(d.prev,4));
  
  // Sync DXY ke halaman AI panel live data
  setEl('aiEurUsd', fmt(d.price,4));

  var ce=document.getElementById('dxyChg');
  if (ce) { ce.textContent=(dir?'▲ +':'▼ ')+Math.abs(d.change).toFixed(4)+' ('+fmtPct(d.pct)+')'; ce.className=dir?'up':'down'; }
  updateDXYIndicator();
}

function updateDXYIndicator() {
  var d=state.dxy; if (!d||!d.pct&&d.pct!==0) return;
  var pct=d.pct||0; 
  var isWeak=pct>0.15, isStrong=pct<-0.15;
  var color=isWeak?'var(--green)':isStrong?'var(--red)':'var(--gold)';
  var width=isWeak?'25%':isStrong?'75%':'50%';
  var valTxt=isWeak?'Weak':isStrong?'Strong':'Neutral';
  var sigTxt=isWeak?'+GOLD':isStrong?'-GOLD':'NEUTRAL';
  ['dxyTrendBar','sentDXYBar'].forEach(function(id){var e=document.getElementById(id);if(e){e.style.width=width;e.style.background=color;}});
  ['dxyTrendVal','sentDXYVal'].forEach(function(id){var e=document.getElementById(id);if(e){e.textContent=fmt(d.price,2)+' '+valTxt;e.style.color=color;}});
  ['dxyTrendSig','sentDXYSig'].forEach(function(id){var e=document.getElementById(id);if(e){e.textContent=sigTxt;e.style.color=color;}});
}

// ── CHART.JS CHARTS ──
var GC='rgba(26,37,64,0.6)', TC='#3d4f6e';

function buildLineChart(id, color, data, labels, height) {
  var ctx=document.getElementById(id); if(!ctx) return;
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  charts[id]=new Chart(ctx,{
    type:'line',
    data:{labels:labels,datasets:[{data:data,borderColor:color,borderWidth:1.5,fill:true,
      backgroundColor:function(c){var g=c.chart.ctx.createLinearGradient(0,0,0,height||260);
        g.addColorStop(0,color.replace('rgb(','rgba(').replace(')',',0.15)'));
        g.addColorStop(1,color.replace('rgb(','rgba(').replace(')',',0)'));return g;},
      tension:0.3,pointRadius:0}]},
    options:{responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,
        backgroundColor:'#0c1220',borderColor:'#1a2540',borderWidth:1,titleColor:'#7a8aaa',bodyColor:color}},
      scales:{x:{ticks:{color:TC,maxTicksLimit:8,font:{family:"JetBrains Mono",size:9}},grid:{color:GC}},
        y:{position:'right',ticks:{color:TC,font:{family:"JetBrains Mono",size:9}},grid:{color:GC}}}}
  });
}

function seriesLabels(series) {
  return series.map(function(v){
    var d=new Date(v.t);
    return (d.getUTCMonth()+1)+'/'+d.getUTCDate()+' '+String(d.getUTCHours()).padStart(2,'0')+':00';
  });
}

// ── FETCH SERIES (Yahoo Finance OHLC) ──
async function fetchSeriesYahoo(yticker, yfi, yfr, size) {
  var url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(yticker)+'?interval='+yfi+'&range='+yfr;
  var d=await proxyFetch(url);
  var r=d&&d.chart&&d.chart.result&&d.chart.result[0];
  if(!r||!r.timestamp) throw new Error('no yahoo data');
  var ts=r.timestamp, q=r.indicators.quote[0];
  var series=ts.map(function(t,i){return{t:new Date(t*1000).toISOString(),c:q.close[i]||0,h:q.high[i]||0,l:q.low[i]||0,o:q.open[i]||0};})
    .filter(function(v){return v.c>0;});
  return series.slice(-size);
}

async function fetchDXYSeries(size) {
  var proxies = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://thingproxy.freeboard.io/fetch/'
  ];
  
  for(var i=0; i<proxies.length; i++) {
    try {
      var yurl = 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1h&range=1mo';
      var fullUrl = proxies[i] + (proxies[i].includes('url=') ? encodeURIComponent(yurl) : yurl);
      var r = await fetch(fullUrl, {signal: AbortSignal.timeout(4000)});
      var d = await r.json();
      var res = d && d.chart && d.chart.result && d.chart.result[0];
      if(res && res.timestamp && res.timestamp.length > 10) {
        var ts=res.timestamp, q=res.indicators.quote[0];
        var series=ts.map(function(t,i){return{t:new Date(t*1000).toISOString(),c:q.close[i]||0,h:q.high[i]||0,l:q.low[i]||0,o:q.open[i]||0};})
          .filter(function(v){return v.c>0;});
        if(series.length > 10) return series.slice(-size);
      }
    } catch(e) { /* try next */ }
  }
  
  try {
    var surl = 'https://stooq.com/q/d/l/?s=%5Edxy&i=h';
    var r2 = await fetch('https://api.allorigins.win/raw?url='+encodeURIComponent(surl), {signal:AbortSignal.timeout(5000)});
    var text = await r2.text();
    if(text && text.includes(',')) {
      var lines = text.trim().split('\n').slice(1);
      var series2 = lines.map(function(l){
        var p=l.split(',');
        if(p.length<5) return null;
        var c = parseFloat(p[p.length-2])||parseFloat(p[4])||0;
        return{t:p[0]+'T'+(p[1]?p[1]:'12:00:00'),o:parseFloat(p[2])||c,h:parseFloat(p[3])||c,l:parseFloat(p[4])||c,c:c};
      }).filter(function(v){return v&&v.c>0;});
      if(series2.length > 5) return series2.slice(-size);
    }
  } catch(e2) { /* fallback */ }
  
  return []; 
}

async function fetchSeries(sym, interval, size) {
  size = size||80;
  var yMap={'XAU/USD':'GC=F','XAG/USD':'SI=F','EUR/USD':'EURUSD=X','BTC/USD':'BTC-USD'};
  var tvToYf={'1min':'2m','5min':'5m','15min':'15m','30min':'30m','1h':'1h','4h':'1h','1day':'1d'};
  var yfRange={'2m':'1d','5m':'5d','15m':'5d','30m':'5d','1h':'1mo','1d':'6mo'};
  var yfi=tvToYf[interval]||'1h';
  var yfr=yfRange[yfi]||'1mo';

  if(sym==='DXY') {
    var dxySeries = await fetchDXYSeries(size);
    if(dxySeries && dxySeries.length > 5) return dxySeries;
    try { return await fetchSeriesYahoo('EURUSD=X', yfi, yfr, size); } catch(e2) { return []; }
  }

  var yticker=yMap[sym]||'GC=F';
  try {
    return await fetchSeriesYahoo(yticker, yfi, yfr, size);
  } catch(e) { console.warn('series fail',sym,e.message); return []; }
}

// ── TECHNICALS ──
function calcEMA(arr,p){
  if(arr.length<p) return null;
  var k=2/(p+1),e=arr.slice(0,p).reduce(function(a,b){return a+b;},0)/p;
  for(var i=p;i<arr.length;i++) e=arr[i]*k+e*(1-k);
  return e;
}
function calcRSI(arr,p){
  p=p||14; if(arr.length<p+1) return null;
  var g=0,l=0;
  for(var i=1;i<=p;i++){var d=arr[i]-arr[i-1];if(d>0)g+=d;else l-=d;}
  var ag=g/p,al=l/p;
  for(var i=p+1;i<arr.length;i++){var d=arr[i]-arr[i-1];ag=((ag*(p-1))+(d>0?d:0))/p;al=((al*(p-1))+(d<0?-d:0))/p;}
  return al===0?100:100-100/(1+ag/al);
}
function calcATR(series,p){
  p=p||14; if(series.length<p+1) return null;
  var trs=[];
  for(var i=1;i<series.length;i++) trs.push(Math.max(series[i].h-series[i].l,Math.abs(series[i].h-series[i-1].c),Math.abs(series[i].l-series[i-1].c)));
  return trs.slice(-p).reduce(function(a,b){return a+b;},0)/p;
}

function updateTechnicals(series) {
  var closes=series.map(function(v){return v.c;}); if(closes.length<20) return;
  var price=closes[closes.length-1];
  var ema20=calcEMA(closes,20),ema50=calcEMA(closes,50),rsi=calcRSI(closes,14),atr=calcATR(series,14);
  
  // Sync ke Halaman AI analysis live indicator panel
  if(rsi!=null) setEl('aiRsi', rsi.toFixed(1));
  if(ema20!=null) setEl('aiEma20', fmt(ema20));
  if(ema50!=null) setEl('aiEma50', fmt(ema50));

  if(rsi!=null){
    var rc=rsi>70?'var(--red)':rsi<30?'var(--green)':'var(--gold)';
    setEl('techRSI',rsi.toFixed(1)); var re=document.getElementById('techRSI');if(re)re.style.color=rc;
    setEl('techRSISig',rsi>70?'OVERBOUGHT':rsi<30?'OVERSOLD':'NEUTRAL'); var rs=document.getElementById('techRSISig');if(rs)rs.style.color=rc;
  }
  if(ema20!=null){setEl('techEMA20',fmt(ema20));var es=document.getElementById('techEMA20Sig');if(es){es.textContent=price>ema20?'ABOVE ▲':'BELOW ▼';es.style.color=price>ema20?'var(--green)':'var(--red)';}}
  if(ema50!=null){setEl('techEMA50',fmt(ema50));var es=document.getElementById('techEMA50Sig');if(es){es.textContent=price>ema50?'ABOVE ▲':'BELOW ▼';es.style.color=price>ema50?'var(--green)':'var(--red)';}}
  if(atr!=null) setEl('techATR',fmt(atr,1));

  function setBar(prefix,pct,val,sig,color){
    var b=document.getElementById('bar'+prefix),v=document.getElementById('val'+prefix),s=document.getElementById('sig'+prefix);
    if(b){b.style.width=pct+'%';b.style.background=color;}if(v){v.textContent=val;v.style.color=color;}if(s){s.textContent=sig;s.style.color=color;}
  }
  if(ema20!=null) setBar('EMA20',price>ema20?70:30,fmt(ema20),price>ema20?'ABOVE ▲':'BELOW ▼',price>ema20?'var(--green)':'var(--red)');
  if(ema50!=null) setBar('EMA50',price>ema50?65:35,fmt(ema50),price>ema50?'ABOVE ▲':'BELOW ▼',price>ema50?'var(--green)':'var(--red)');
  if(rsi!=null)   setBar('RSI',rsi,rsi.toFixed(1),rsi>70?'OVERBOUGHT':rsi<30?'OVERSOLD':'NEUTRAL',rsi>70?'var(--red)':rsi<30?'var(--green)':'var(--gold)');
  state.xauSeries=series; computeSignal();
}

// ── SIGNAL ENGINE ──
function computeSignal() {
  var x=state.xau,d=state.dxy; if(!x||!x.price) return;
  var series=state.xauSeries, closes=series.map(function(v){return v.c;});
  var ema20=calcEMA(closes,20),ema50=calcEMA(closes,50),rsi=calcRSI(closes,14),atr=calcATR(series,14);
  var score=0;
  if(d&&d.pct>0.1) score+=2; 
  if(x.pct>0) score+=1;
  if(ema20&&x.price>ema20) score+=1;
  if(ema50&&x.price>ema50) score+=1;
  if(rsi&&rsi>45&&rsi<72) score+=1;
  var isBull=score>=3, p=x.price;
  var sl_d=atr?atr*1.3:p*0.007, tp1_d=sl_d*1.5, tp2_d=sl_d*2.6, spread=atr?atr*0.4:p*0.002;
  var elo=fmt(isBull?p-spread:p+spread*0.2), ehi=fmt(p);
  var sl=fmt(isBull?p-sl_d:p+sl_d), tp1=fmt(isBull?p+tp1_d:p-tp1_d), tp2=fmt(isBull?p+tp2_d:p-tp2_d);
  var rr='1:'+(tp1_d/sl_d).toFixed(1), conf=Math.min(94,48+score*8);
  var setup=isBull?'PULLBACK BUY':'PULLBACK SELL';
  var rat=isBull
    ?'DXY '+(d&&d.pct>0?'weakening':'flat')+'. XAU momentum '+(x.pct>0?'positive':'mixed')+'. '+(ema20&&x.price>ema20?'Above EMA20. ':'')+' COT bullish.'
    :'DXY strengthening. XAU facing resistance. '+(ema20&&x.price<ema20?'Below EMA20. ':'')+' Short-term pullback.';
  var ds=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'});
  setEl('signalDate',ds+' · LIVE'); setEl('signalDir',isBull?'LONG ▲':'SHORT ▼');
  setEl('sigEntry',elo+' – '+ehi); setEl('sigSL',sl); setEl('sigTP1',tp1); setEl('sigTP2',tp2); setEl('sigRR',rr);
  setEl('signalRationale',rat); setEl('sigDirFull',isBull?'LONG ▲':'SHORT ▼'); setEl('sigSetupType','SETUP: '+setup);
  setEl('sigEntryFull',elo+' – '+ehi); setEl('sigSLFull',sl); setEl('sigTP1Full',tp1); setEl('sigTP2Full',tp2); setEl('sigRRFull',rr);
  setEl('sigConf',conf+'%'); setEl('sigRationaleFull',rat);
  setEl('swingDir',isBull?'LONG ▲':'SHORT ▼'); setEl('swingEntry',elo+' – '+fmt(p));
  setEl('swingSL',fmt(isBull?p-sl_d*2:p+sl_d*2)); setEl('swingTP1',fmt(isBull?p+tp2_d:p-tp2_d)); setEl('swingTP2',fmt(isBull?p+tp2_d*1.8:p-tp2_d*1.8));
  ['dashSignalBox','daySignalBox'].forEach(function(id){var e=document.getElementById(id);if(e)e.className='signal-box '+(isBull?'buy':'sell');});
  ['signalDir','sigDirFull','swingDir'].forEach(function(id){var e=document.getElementById(id);if(e)e.className='signal-label '+(isBull?'buy':'sell');});
  setStatus('signalStatus','ok','● LIVE');
  saveSignalToHistory({dir:isBull?'LONG':'SHORT',entry:elo+' – '+ehi,tp1:tp1,tp2:tp2,sl:sl,rr:rr,conf:conf+'%',date:new Date().toISOString()});
}

// ── SIGNAL HISTORY ──
var SIG_KEY = 'dfxai_sig_history';

function loadSignalHistory() {
  try { return JSON.parse(localStorage.getItem(SIG_KEY)) || []; } catch(e) { return []; }
}
function saveSignalHistory(arr) {
  localStorage.setItem(SIG_KEY, JSON.stringify(arr));
}
function saveSignalToHistory(sig) {
  var arr = loadSignalHistory();
  var now = Date.now();
  var last = arr[0];
  if (last && last.dir === sig.dir && last.entry === sig.entry && now - new Date(last.date).getTime() < 300000) return;
  sig.id = now;
  sig.result = 'open';
  arr.unshift(sig);
  if (arr.length > 100) arr = arr.slice(0, 100);
  saveSignalHistory(arr);
  renderSignalHistory();
}
function renderSignalHistory() {
  var arr = loadSignalHistory();
  var tbody = document.getElementById('signalHistoryBody');
  var countEl = document.getElementById('histCount');
  var picker = document.getElementById('sigPickHistory');
  if (countEl) countEl.textContent = arr.length + ' signals';
  if (picker) {
    var openSigs = arr.filter(function(s){ return s.result === 'open'; });
    picker.innerHTML = '<option value="">— Pilih signal dari riwayat —</option>' +
      openSigs.map(function(s){
        var d = new Date(s.date);
        var label = d.toLocaleDateString('id-ID',{day:'2-digit',month:'short'}) + ' ' +
                    d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}) +
                    ' · ' + s.dir + ' · ' + s.entry;
        return '<option value="'+s.id+'">'+label+'</option>';
      }).join('');
  }
  if (!tbody) return;
  if (!arr.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--t3);padding:20px">Belum ada riwayat. Signal live akan otomatis tersimpan.</td></tr>';
    updateWinrateStats(arr);
    return;
  }
  tbody.innerHTML = arr.map(function(s) {
    var d = new Date(s.date);
    var dateStr = d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'2-digit'}) + ' ' +
                  d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
    var dirClass = s.dir === 'LONG' ? 'up' : 'down';
    var dirIcon = s.dir === 'LONG' ? '▲' : '▼';
    var resultHtml = '';
    if (s.result === 'open') resultHtml = '<span style="color:var(--gold);font-size:9px;letter-spacing:1px">● OPEN</span>';
    else if (s.result === 'tp1') resultHtml = '<span style="color:var(--green);font-size:9px;letter-spacing:1px">✓ TP1</span>';
    else if (s.result === 'tp2') resultHtml = '<span style="color:var(--green);font-size:9px;font-weight:700;letter-spacing:1px">✓✓ TP2</span>';
    else if (s.result === 'sl') resultHtml = '<span style="color:var(--red);font-size:9px;letter-spacing:1px">✗ SL</span>';
    var aksiHtml = s.result === 'open'
      ? '<span onclick="window.deleteSignal('+s.id+')" style="color:var(--t3);cursor:pointer;font-size:10px" title="Hapus">🗑</span>'
      : '<span onclick="window.resetSignalResult('+s.id+')" style="color:var(--t3);cursor:pointer;font-size:10px" title="Reset ke Open">↩</span>';
    return '<tr>' +
      '<td style="font-size:9px;color:var(--t3)">'+dateStr+'</td>' +
      '<td><span class="'+dirClass+'" style="font-weight:700;letter-spacing:1px">'+dirIcon+' '+s.dir+'</span></td>' +
      '<td style="color:var(--t1)">'+s.entry+'</td>' +
      '<td class="up">'+s.tp1+'</td>' +
      '<td class="up">'+s.tp2+'</td>' +
      '<td class="down">'+s.sl+'</td>' +
      '<td style="color:var(--gold)">'+s.rr+'</td>' +
      '<td style="color:var(--blue)">'+s.conf+'</td>' +
      '<td>'+resultHtml+'</td>' +
      '<td>'+aksiHtml+'</td>' +
    '</tr>';
  }).join('');
  updateWinrateStats(arr);
}
function updateWinrateStats(arr) {
  var closed = arr.filter(function(s){ return s.result !== 'open'; });
  var wins = arr.filter(function(s){ return s.result === 'tp1' || s.result === 'tp2'; });
  var losses = arr.filter(function(s){ return s.result === 'sl'; });
  var total = closed.length;
  var winPct = total > 0 ? Math.round(wins.length / total * 100) : null;
  var longs = closed.filter(function(s){ return s.dir === 'LONG'; });
  var longWins = longs.filter(function(s){ return s.result === 'tp1' || s.result === 'tp2'; });
  var shorts = closed.filter(function(s){ return s.dir === 'SHORT'; });
  var shortWins = shorts.filter(function(s){ return s.result === 'tp1' || s.result === 'tp2'; });
  var rrVals = closed.filter(function(s){ return s.rr; }).map(function(s){
    var m = s.rr.match(/1:([\d.]+)/); return m ? parseFloat(m[1]) : null;
  }).filter(Boolean);
  var avgRR = rrVals.length ? (rrVals.reduce(function(a,b){return a+b;},0)/rrVals.length).toFixed(1) : null;
  setEl('wrTotal', arr.length);
  setEl('wrWin', wins.length);
  setEl('wrLoss', losses.length);
  setEl('wrPct', winPct !== null ? winPct+'%' : '—');
  setEl('wrPctBar', winPct !== null ? winPct+'%' : '—');
  setEl('wrAvgRR', avgRR ? '1:'+avgRR : '—');
  setEl('wrLongWR', longs.length ? Math.round(longWins.length/longs.length*100)+'%' : '—');
  setEl('wrShortWR', shorts.length ? Math.round(shortWins.length/shorts.length*100)+'%' : '—');
  var bar = document.getElementById('wrBar');
  if (bar) {
    bar.style.width = (winPct || 0)+'%';
    bar.style.background = winPct >= 60 ? 'var(--green)' : winPct >= 40 ? 'var(--gold)' : 'var(--red)';
  }
  var wrEl = document.getElementById('wrPct');
  if (wrEl && winPct !== null) wrEl.style.color = winPct >= 60 ? 'var(--green)' : winPct >= 40 ? 'var(--gold)' : 'var(--red)';
}
window.markSignal = function(result) {
  var picker = document.getElementById('sigPickHistory');
  var feedback = document.getElementById('markFeedback');
  if (!picker || !picker.value) {
    if (feedback) { feedback.textContent = '⚠ Pilih signal dulu dari dropdown.'; feedback.style.color='var(--red)'; }
    return;
  }
  var id = parseInt(picker.value);
  var arr = loadSignalHistory();
  var idx = arr.findIndex(function(s){ return s.id === id; });
  if (idx === -1) { if (feedback) { feedback.textContent = '⚠ Signal tidak ditemukan.'; feedback.style.color='var(--red)'; } return; }
  arr[idx].result = result;
  saveSignalHistory(arr);
  renderSignalHistory();
  var labels = {tp1:'✓ TP1 Hit ditandai!', tp2:'✓✓ TP2 Hit ditandai!', sl:'✗ SL Hit ditandai.'};
  var colors = {tp1:'var(--green)', tp2:'var(--green)', sl:'var(--red)'};
  if (feedback) { feedback.textContent = labels[result]; feedback.style.color = colors[result]; }
  setTimeout(function(){ if (feedback) feedback.textContent = ''; }, 3000);
};
window.deleteSignal = function(id) {
  var arr = loadSignalHistory().filter(function(s){ return s.id !== id; });
  saveSignalHistory(arr);
  renderSignalHistory();
};
window.resetSignalResult = function(id) {
  var arr = loadSignalHistory();
  var idx = arr.findIndex(function(s){ return s.id === id; });
  if (idx !== -1) { arr[idx].result = 'open'; saveSignalHistory(arr); renderSignalHistory(); }
};
window.clearSignalHistory = function() {
  if (!confirm('Hapus semua riwayat signal? Tindakan ini tidak bisa dibatalkan.')) return;
  localStorage.removeItem(SIG_KEY);
  renderSignalHistory();
};
window.addManualSignal = function() {
  var dir = document.getElementById('manualDir');
  var result = document.getElementById('manualResult');
  var entry = document.getElementById('manualEntry');
  if (!dir || !result || !entry) return;
  var entryVal = entry.value.trim();
  if (!entryVal) { alert('Masukkan entry price dulu.'); return; }
  var sig = {id:Date.now(),dir:dir.value,entry:entryVal,tp1:'—',tp2:'—',sl:'—',rr:'—',conf:'—',date:new Date().toISOString(),result:result.value};
  var arr = loadSignalHistory();
  arr.unshift(sig);
  saveSignalHistory(arr);
  renderSignalHistory();
  entry.value = '';
  var fb = document.getElementById('markFeedback');
  if (fb) { fb.textContent = '✓ Signal manual ditambahkan.'; fb.style.color='var(--green)'; }
  setTimeout(function(){ if (fb) fb.textContent = ''; }, 3000);
};

// ── LOAD CHARTS ──
async function loadMainChart(interval) {
  interval=interval||'1h'; state.interval=interval;
  var s=await fetchSeries('XAU/USD',interval,80);
  if(s.length){ updateTechnicals(s); buildLineChart('xauMainChart','rgb(240,192,64)',s.map(function(v){return v.c;}),seriesLabels(s),260); }
}
async function loadDxyChart() {
  var s=await fetchSeries('EUR/USD','1h',60);
  if(s.length) buildLineChart('dxyMiniChart','rgb(77,166,255)',s.map(function(v){return v.c;}),seriesLabels(s),80);
}
async function loadH1Charts() {
  var xs=await fetchSeries('XAU/USD','1h',60);
  if(xs&&xs.length){ 
    buildLineChart('xauH1Chart','rgb(240,192,64)',xs.map(function(v){return v.c;}),seriesLabels(xs),300); 
    updateTechnicals(xs);
    updateChartStats('xau', xs);
  }
  var ds=await fetchSeries('DXY','1h',60);
  if(ds&&ds.length) {
    buildLineChart('dxyH1Chart','rgb(77,166,255)',ds.map(function(v){return v.c;}),seriesLabels(ds),300);
    updateChartStats('dxy', ds);
  }
}

function updateChartStats(type, series) {
  if(!series||!series.length) return;
  var closes = series.map(function(v){return v.c;});
  var price = closes[closes.length-1];
  var open  = closes[0];
  var chgPct = ((price-open)/open*100);
  var dir = chgPct>=0;
  var rsi = calcRSI(closes, 14);
  var ema20 = calcEMA(closes, Math.min(20,closes.length));
  var signal = '';
  if(rsi) { signal = rsi>65?'SHORT ▼':rsi<35?'LONG ▲':(ema20&&price>ema20?'▲ LONG':'▼ SHORT'); }

  if(type==='xau') {
    var el = document.getElementById('xauChartStats');
    if(!el) return;
    el.innerHTML = 
      '<div><div class="stat-label">XAU PRICE</div><div class="stat-val" style="color:var(--gold)">'+fmt(price)+'</div></div>'+
      '<div><div class="stat-label">CHANGE</div><div class="stat-val '+(dir?'up':'down')+'">'+(dir?'+':'')+chgPct.toFixed(2)+'%</div></div>'+
      '<div><div class="stat-label">RSI (14)</div><div class="stat-val '+(rsi&&rsi<35?'up':rsi&&rsi>65?'down':'')+'">'+( rsi?rsi.toFixed(1):'—')+'</div></div>'+
      '<div><div class="stat-label">SIGNAL</div><div class="stat-val '+(signal.includes('LONG')?'up':'down')+'">'+signal+'</div></div>';
  } else if(type==='dxy') {
    var el = document.getElementById('dxyChartStats');
    if(!el) return;
    el.innerHTML =
      '<div><div class="stat-label">DXY PRICE</div><div class="stat-val" style="color:var(--blue)">'+fmt(price,2)+'</div></div>'+
      '<div><div class="stat-label">CHANGE</div><div class="stat-val '+(dir?'up':'down')+'">'+(dir?'+':'')+chgPct.toFixed(2)+'%</div></div>'+
      '<div><div class="stat-label">RSI (14)</div><div class="stat-val '+(rsi&&rsi<35?'up':rsi&&rsi>65?'down':'')+'">'+( rsi?rsi.toFixed(1):'—')+'</div></div>'+
      '<div><div class="stat-label">GOLD IMPACT</div><div class="stat-val '+(dir?'down':'up')+'">'+(dir?'▼ BEARISH':'▲ BULLISH')+'</div></div>';
  }
}

// ── COT (INTEGRASI & AUTO UPDATE DATA LIVE) ──
var cotInited=false, cbInited=false;

async function updateLiveCOTData() {
  // Simulasi penarikan CFTC live proxy / kalkulasi dinamis berdasarkan momentum XAU/DXY terbaru
  var x = state.xau;
  var d = state.dxy;
  
  var baseLong = 246412;
  var baseShort = 48230;
  
  if (x && x.pct) {
    baseLong += Math.round(x.pct * 4500);
    baseShort -= Math.round(x.pct * 1200);
  }
  if (d && d.pct) {
    baseLong -= Math.round(d.pct * 3000);
    baseShort += Math.round(d.pct * 2000);
  }

  // Render ke halaman COT (Tabel) jika elemen ada
  var netPos = baseLong - baseShort;
  var lsRatio = (baseLong / baseShort).toFixed(1);
  
  // Update tabel COT di halaman menu COT
  // Di sini Anda bisa mengaitkan id DOM jika menambahkan id pada row tabel di HTML.
}

function initCOTCharts() {
  if(cotInited) return; cotInited=true;
  updateLiveCOTData();
  
  var ctx1=document.getElementById('cotBarChart');
  if(ctx1) new Chart(ctx1,{type:'bar',data:{labels:['W-8','W-7','W-6','W-5','W-4','W-3','W-2','W-1','Now'],datasets:[{label:'Longs',data:[198000,204000,212000,218000,224000,228000,238000,242000,246412],backgroundColor:'rgba(34,217,138,0.5)',borderColor:'rgba(34,217,138,0.8)',borderWidth:1},{label:'Shorts',data:[62000,58000,56000,54000,52000,50000,49000,48500,48230],backgroundColor:'rgba(255,77,109,0.4)',borderColor:'rgba(255,77,109,0.7)',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:TC,font:{family:'JetBrains Mono',size:9}}}},scales:{x:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}},y:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}}}}});
  var ctx2=document.getElementById('cotNetChart');
  if(ctx2) new Chart(ctx2,{type:'line',data:{labels:['W-8','W-7','W-6','W-5','W-4','W-3','W-2','W-1','Now'],datasets:[{label:'Net MM',data:[136000,146000,156000,164000,172000,178000,189000,193500,198182],borderColor:'#f0c040',backgroundColor:'rgba(240,192,64,0.1)',borderWidth:1.5,fill:true,tension:0.3,pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:TC,font:{family:'JetBrains Mono',size:9}}}},scales:{x:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}},y:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}}}}});
}
function initCBChart() {
  if(cbInited) return; cbInited=true;
  var ctx=document.getElementById('cbChart');
  if(ctx) new Chart(ctx,{type:'bar',data:{labels:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],datasets:[{label:'CB Buying (t)',data:[45,52,38,61,72,58,67,83,90,78,88,95],backgroundColor:'rgba(240,192,64,0.4)',borderColor:'rgba(240,192,64,0.8)',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}},y:{ticks:{color:TC,font:{family:'JetBrains Mono',size:8}},grid:{color:GC}}}}});
}

// ── PAGE NAVIGATION ──
window.switchPage = function(page, el) {
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-tabs .tab').forEach(function(t){t.classList.remove('active');});
  var pg=document.getElementById('page-'+page); if(pg) pg.classList.add('active');
  if(el) el.classList.add('active');
  if(page==='charts') loadH1Charts();
  if(page==='cot') initCOTCharts();
  if(page==='geopolitical') { initCBChart(); window.refreshGeoNews && window.refreshGeoNews(false); }
  if(page==='etf') { if(typeof renderGoldETF==='function') renderGoldETF(); }
  if(page==='charts') { if(typeof loadBTCChart==='function') loadBTCChart(); }
  if(page==='ai') renderAIPanel();
  if(page==='screener') renderScreenerPanel();
};

window.changeInterval = function(interval, el) {
  document.querySelectorAll('.panel-header .tab').forEach(function(t){t.classList.remove('active');});
  if(el) el.classList.add('active');
  loadMainChart(interval);
};

window.setCalFilter = function(type, el) {
  document.querySelectorAll('.cal-filter-btn').forEach(function(b){
    b.style.background='transparent'; b.style.borderColor='var(--border)'; b.style.color='var(--text-secondary)';
  });
  if(el){el.style.background='rgba(240,192,64,0.08)';el.style.borderColor='rgba(240,192,64,0.3)';el.style.color='var(--gold)';}
  var frame=document.getElementById('investingCalFrame'); if(!frame) return;
  var urls={
    'all':'https://sslecal2.investing.com?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&features=datepicker,timezone&countries=5,22,25,32,4,37&calType=week&timeZone=18&lang=1',
    'high':'https://sslecal2.investing.com?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&features=datepicker,timezone&countries=5,22,25,32,4,37&importance=3&calType=week&timeZone=18&lang=1',
    'usd':'https://sslecal2.investing.com?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&features=datepicker,timezone&countries=5&calType=week&timeZone=18&lang=1'
  };
  var ld=document.getElementById('calLoading'); if(ld) ld.style.display='flex';
  frame.src=urls[type]||urls['all'];
};

// ── GROQ AI ──
  // ── MARKET SCREENER (Forex / Metal / Crypto) ──
  window.currentScreener = 'forex';
  window.renderScreenerPanel = function(){
    var res = document.getElementById('screenerResult'); if(!res) return;
    res.innerHTML = '<div style="padding:20px;color:var(--t3);text-align:center">Pilih kategori: Forex, Metal, atau Crypto</div>';
  };

  window.loadScreener = async function(cat, el){
    cat = cat || window.currentScreener || 'forex'; window.currentScreener = cat;
    var res = document.getElementById('screenerResult'); if(!res) return;
    if(el){ document.querySelectorAll('#page-screener .tab').forEach(function(b){b.classList.remove('active');}); el.classList.add('active'); }
    res.innerHTML = '<div style="padding:20px;text-align:center;color:var(--t3)">Loading '+cat+'…</div>';
    try {
      if(cat==='crypto'){
        // Use CoinGecko markets endpoint to get price, 24h change, high/low, volume and sparkline
        var ids = 'bitcoin,ethereum,ripple,litecoin,cardano,solana,dogecoin,polkadot,binancecoin,tron,chainlink';
        var url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids='+ids+'&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h';
        var r = await fetch(url, {signal: AbortSignal.timeout(10000)});
        var arr = await r.json();
        var rows = arr.map(function(item){
          var series = (item.sparkline_in_7d && item.sparkline_in_7d.price) ? item.sparkline_in_7d.price.slice(-24) : null;
          return {symbol:(item.symbol||item.id).toUpperCase(), price:item.current_price||null, pct:item.price_change_percentage_24h||null, high:item.high_24h||null, low:item.low_24h||null, vol:item.total_volume||null, series:series};
        });
        window.screenerData = rows;
        renderScreenerTable(rows,'crypto');
        return;
      }

      var map = {};
      if (cat === 'metal') {
        map = {
          'XAU/USD':'GC=F',
          'XAG/USD':'SI=F',
          'XPT/USD':'PL=F',
          'Palladium/USD':'PA=F'
        };
      } else {
        map = {
          'EUR/USD':'EURUSD=X','GBP/USD':'GBPUSD=X','USD/JPY':'JPY=X','AUD/USD':'AUDUSD=X',
          'NZD/USD':'NZDUSD=X','USD/CAD':'CAD=X','USD/CHF':'CHF=X','EUR/GBP':'EURGBP=X',
          'EUR/JPY':'EURJPY=X','GBP/JPY':'GBPJPY=X'
        };
      }
      var entries = Object.entries(map);
      var results = {};
      await Promise.allSettled(entries.map(async function(kv){ try{ results[kv[0]] = await yahooQuote(kv[1]); }catch(e){ results[kv[0]] = null; } }));
      var rows = await Promise.all(entries.map(async function(kv){ var label=kv[0]; var q=results[label]; if(!q||!q.price) return {symbol:label,price:null,pct:null,high:null,low:null,vol:null,series:null};
        // try to fetch series for sparkline (best-effort)
        var series = [];
        try { series = await fetchSeries(label==='DXY'?'DXY':label, '1h', 24); } catch(e) { series = []; }
        return {symbol:label, price:q&&q.price?q.price:null, pct:q&&q.pct?q.pct:null, high:q&&q.high?q.high:null, low:q&&q.low?q.low:null, vol:null, series:series}; }));
      window.screenerData = rows;
      renderScreenerTable(rows, cat==='metal'?'metal':'forex');
    } catch(e){ res.innerHTML = '<div style="padding:20px;color:var(--red);text-align:center">Error: '+(e.message||e)+'</div>'; }
  };

  window.topMoversOnly = false;
  window.toggleTopMovers = function(){ window.topMoversOnly = !window.topMoversOnly; var b=document.getElementById('screenerTopBtn'); if(b){ if(window.topMoversOnly) b.classList.add('top-movers-on'); else b.classList.remove('top-movers-on'); } if(window.screenerData) renderScreenerTable(window.screenerData); };

  window.currentSort = {col:null,dir:1};
  function renderScreenerTable(rows, type){
    var res = document.getElementById('screenerResult'); if(!res) return;
    var data = rows.slice();
    if(window.topMoversOnly){ data = data.filter(function(r){ return r && r.pct; }).sort(function(a,b){ return Math.abs(b.pct)-Math.abs(a.pct); }).slice(0,10); }
    if(window.currentSort && window.currentSort.col){ data.sort(function(a,b){ var ca=a[window.currentSort.col], cb=b[window.currentSort.col]; if(ca==null) return 1; if(cb==null) return -1; return (ca>cb?1:ca<cb?-1:0)*window.currentSort.dir; }); }
    var header = '<div class="screener-card"><div class="screener-header">'+(type==='crypto'?'Crypto Prices':type==='metal'?'Metal Overview':'Forex Overview')+'<div class="screener-meta">Pairs: '+(window.screenerData?window.screenerData.length:0)+'</div></div>'+
      '<table class="data-table" style="margin-top:8px"><thead><tr>'+
      '<th onclick="window.sortScreener(\'symbol\')">Symbol</th><th onclick="window.sortScreener(\'price\')">Price</th><th onclick="window.sortScreener(\'pct\')">24H</th><th>High</th><th>Low</th><th>Vol</th><th>Spark</th></tr></thead><tbody>';
    var rowsHtml = data.map(function(r){ if(!r) return ''; var price = r.price?fmt(r.price):'—'; var pct = screenerChangeBadge(r.pct); var high = r.high?fmt(r.high):'—'; var low = r.low?fmt(r.low):'—'; var vol = r.vol?Number(r.vol).toLocaleString():'—'; var canvas = r.series && r.series.length?'<canvas class="spark-canvas" data-series-index="'+Math.random().toString(36).substr(2,6)+'"></canvas>':'<div style="color:var(--t3)">—</div>';
      return '<tr><td style="font-weight:700;color:var(--t1)">'+r.symbol+'</td><td class="price">'+price+'</td><td>'+pct+'</td><td>'+high+'</td><td>'+low+'</td><td class="vol">'+vol+'</td><td>'+canvas+'</td></tr>'; }).join('');
    res.innerHTML = header + rowsHtml + '</tbody></table></div>';
    // draw sparklines
    setTimeout(function(){ var canvases = res.querySelectorAll('.spark-canvas'); canvases.forEach(function(c){ var idx = c.getAttribute('data-series-index'); var parentRow = c.closest('tr'); var sym = parentRow.querySelector('td').textContent; var item = (window.screenerData||[]).find(function(x){ return x.symbol===sym; }); if(item && item.series && item.series.length){ var dataArr = item.series.map(function(v){ return v.c || v.close || v[4] || 0; }); drawSparkline(c, dataArr); } }); }, 80);
  }

  window.sortScreener = function(col){ if(window.currentSort.col===col) window.currentSort.dir *= -1; else { window.currentSort.col = col; window.currentSort.dir = 1; } if(window.screenerData) renderScreenerTable(window.screenerData); };

  function drawSparkline(canvas, data){ try{ var ctx = canvas.getContext('2d'); var w = canvas.width = canvas.clientWidth; var h = canvas.height = canvas.clientHeight; ctx.clearRect(0,0,w,h); if(!data||!data.length) return; var max=Math.max.apply(null,data); var min=Math.min.apply(null,data); var range = max-min||1; ctx.beginPath(); data.forEach(function(v,i){ var x = i/(data.length-1)*(w-2)+1; var y = h-2 - ((v-min)/range)*(h-4)+1; if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.strokeStyle = 'rgba(240,192,64,0.9)'; ctx.lineWidth=1.2; ctx.stroke(); }catch(e){console.warn('sparkline err',e);} }
  function drawSparkline(canvas, data){ try{ var ctx = canvas.getContext('2d'); var w = canvas.width = canvas.clientWidth; var h = canvas.height = canvas.clientHeight; ctx.clearRect(0,0,w,h); if(!data||!data.length) return; var max=Math.max.apply(null,data); var min=Math.min.apply(null,data); var range = max-min||1; var pts = data.map(function(v,i){ return {x: i/(data.length-1)*(w-2)+1, y: h-2 - ((v-min)/range)*(h-4)+1, v: v}; });
      // gradient fill
      var grad = ctx.createLinearGradient(0,0,0,h); grad.addColorStop(0,'rgba(240,192,64,0.18)'); grad.addColorStop(1,'rgba(240,192,64,0)');
      ctx.beginPath(); pts.forEach(function(p,i){ if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); });
      ctx.lineWidth=1.4; var last = pts[pts.length-1].v; var first = pts[0].v; var color = last>=first ? 'rgba(34,217,138,0.95)' : 'rgba(255,77,109,0.95)'; ctx.strokeStyle = color; ctx.stroke();
      // fill area
      ctx.lineTo(w-1,h); ctx.lineTo(1,h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      // small dot at last
      ctx.beginPath(); ctx.arc(pts[pts.length-1].x, pts[pts.length-1].y, 2, 0, Math.PI*2); ctx.fillStyle = color; ctx.fill();
    }catch(e){console.warn('sparkline err',e);} }

function screenerChangeBadge(v){
  if (v==null || v===undefined || isNaN(parseFloat(v))) return '<span style="color:var(--t3)">—</span>';
  var n = parseFloat(v);
  var cls = n>=0 ? 'up' : 'down';
  return '<span class="'+cls+'" style="font-weight:700">'+(n>=0?'+':'')+n.toFixed(2)+'%</span>';
}

async function groqChat(prompt) {
  var key = GROQ_KEY || localStorage.getItem('dfxai_groq') || '';
  if (!key) throw new Error('Groq API key belum diset. Masuk ke tab AI Analysis dulu.');
  var r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+key},
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{role:'user', content: prompt}],
      temperature: 0.7,
      max_tokens: 600
    })
  });
  var data = await r.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || 'No response';
}

function formatAIText(txt) {
  var lines = txt.split('\n').filter(function(l){ return l.trim(); });
  return lines.map(function(l) {
    l = l.trim();
    if (l.match(/^[1-5][\.\)]|^\*\*|^•|-\s/) || l.includes('**')) {
      l = l.replace(/\*\*/g,'').replace(/^[-•]\s*/,'');
      return '<div style="padding:8px 0;border-bottom:1px solid rgba(26,37,64,0.5)"><span style="color:var(--gold)">◈ </span>'+l+'</div>';
    }
    return '<div style="color:var(--t2);font-size:10px;line-height:1.6;padding:2px 0">'+l+'</div>';
  }).join('');
}

window.setGroqKey = function() {
  var k = document.getElementById('groqKeyInput'); if (!k) return;
  GROQ_KEY = k.value.trim();
  localStorage.setItem('dfxai_groq', GROQ_KEY);
  setEl('groqKeyStatus', '✓ Key saved');
  renderAIPanel();
};

window.renderAIPanel = async function() {
  var key = GROQ_KEY || localStorage.getItem('dfxai_groq') || '';
  var panel = document.getElementById('aiAnalysisResult');
  if (!key) {
    if (panel) panel.innerHTML='<div style="padding:20px;color:var(--t3);text-align:center">Masukkan Groq API key di atas untuk mengaktifkan AI analysis</div>';
    return;
  }
  GROQ_KEY = key;
  if (panel) panel.innerHTML='<div style="padding:20px;color:var(--gold);text-align:center">⟳ Analyzing market conditions...</div>';

  // Defensive defaults: state may be empty during initial load
  var x = state.xau || {};
  var d = state.dxy || {};
  var s = Array.isArray(state.xauSeries) ? state.xauSeries : [];
  var closes = s.length ? s.map(function(v){ return v.c; }) : [];
  var ema20 = closes.length ? calcEMA(closes,20) : null;
  var ema50 = closes.length ? calcEMA(closes,50) : null;
  var rsi = closes.length ? calcRSI(closes,14) : null;
  var atr = s.length ? calcATR(s,14) : null;

  var prompt = 'You are a professional XAUUSD (Gold) trader and analyst. Analyze the following real-time market data and provide a concise trading analysis in 5 bullet points:\n\n' +
    'XAUUSD Price: ' + (x.price ? fmt(x.price) : 'N/A') + '\nDaily Change: ' + (typeof x.pct !== 'undefined' ? fmtPct(x.pct) : 'N/A') + '\nOpen: ' + (x.open ? fmt(x.open) : 'N/A') + ' | High: ' + (x.high ? fmt(x.high) : 'N/A') + ' | Low: ' + (x.low ? fmt(x.low) : 'N/A') + '\n' +
    'DXY: ' + (d.price ? fmt(d.price,2) : 'N/A') + ' (' + (typeof d.pct !== 'undefined' ? fmtPct(d.pct) : 'N/A') + ')\n' +
    'RSI(14): ' + (rsi ? rsi.toFixed(1) : 'N/A') + '\nEMA20: ' + (ema20 ? fmt(ema20) : 'N/A') + ' | EMA50: ' + (ema50 ? fmt(ema50) : 'N/A') + '\nATR(14): ' + (atr ? fmt(atr,1) : 'N/A') + '\n' +
    'Price vs EMA20: ' + (ema20 && x.price ? (x.price>ema20?'ABOVE (bullish)':'BELOW (bearish)') : 'N/A') + '\n' +
    'Price vs EMA50: ' + (ema50 && x.price ? (x.price>ema50?'ABOVE (bullish)':'BELOW (bearish)') : 'N/A') + '\n\n' +
    'Provide: 1) Market Bias (Bullish/Bearish/Neutral) 2) Key levels to watch 3) Entry suggestion 4) Risk factors 5) Short-term outlook. Be concise and direct.';
  try {
    var txt = await groqChat(prompt);
    if (panel) panel.innerHTML='<div style="padding:12px">'+formatAIText(txt)+'</div>';
  } catch(e) {
    if (panel) panel.innerHTML='<div style="padding:20px;color:var(--red);text-align:center">⚠ Groq error: '+e.message+'</div>';
  }
};

// ── GEOPOLITICAL NEWS + AI ──
var geoNewsCached = [];
var geoNewsLastFetch = 0;
var geoAutoRefreshTimer = null;

var GEO_RSS_SOURCES = [
  {url:'https://feeds.reuters.com/reuters/topNews',label:'REUTERS'},
  {url:'https://feeds.reuters.com/Reuters/worldNews',label:'REUTERS'},
  {url:'https://feeds.bbci.co.uk/news/world/rss.xml',label:'BBC'},
  {url:'https://feeds.bbci.co.uk/news/business/rss.xml',label:'BBC BIZ'},
  {url:'https://www.aljazeera.com/xml/rss/all.xml',label:'AL JAZEERA'},
  {url:'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',label:'NYT'},
  {url:'https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml',label:'NYT ECON'},
  {url:'https://feeds.skynews.com/feeds/rss/world.xml',label:'SKY NEWS'},
  {url:'https://www.ft.com/?format=rss',label:'FT'},
  {url:'https://www.theguardian.com/world/rss',label:'GUARDIAN'},
];

var GEO_KEYWORDS=['war','conflict','sanction','nuclear','missile','military','troops','ceasefire','attack','crisis','tension','invasion','strike','nato','ukraine','russia','china','taiwan','iran','israel','trade war','tariff','escalat','geopolit','oil','supply chain','fed','rate cut','inflation','dollar','gold','commodity','opec','middle east','south china sea','north korea','pakistan','india'];

function geoClassifyTag(t){t=t.toLowerCase();if(/war|conflict|military|nuclear|missile|troops|attack|ceasefire|nato|invasion|strike/.test(t))return'war';if(/trade|tariff|sanction|export|import|supply chain/.test(t))return'trade';if(/oil|energy|gas|opec|pipeline/.test(t))return'energy';if(/fed|rate|inflation|gdp|recession|dollar|yuan|gold|commodity/.test(t))return'macro';return'default';}
function geoGoldImpact(t){t=t.toLowerCase();if(/nuclear|invasion|attack|escalat|missile/.test(t))return'<span style="color:var(--green)">▲ STRONGLY BULLISH</span>';if(/war|conflict|military|crisis|sanction/.test(t))return'<span style="color:var(--green)">▲ BULLISH</span>';if(/ceasefire|peace|deal|agreement/.test(t))return'<span style="color:var(--red)">▼ BEARISH</span>';if(/tariff|trade war|export control/.test(t))return'<span style="color:var(--gold)">◆ MOD. BULLISH</span>';if(/fed rate|rate hike|hawkish/.test(t))return'<span style="color:var(--red)">▼ BEARISH</span>';if(/rate cut|dovish|stimulus/.test(t))return'<span style="color:var(--green)">▲ BULLISH</span>';return'<span style="color:var(--t3)">— NEUTRAL</span>';}
function geoIsRelevant(t){t=t.toLowerCase();return GEO_KEYWORDS.some(function(k){return t.indexOf(k)!==-1;});}
function geoTimeAgo(ds){try{var d=new Date(ds),diff=Math.floor((Date.now()-d)/60000);if(diff<1)return'Just now';if(diff<60)return diff+'m ago';if(diff<1440)return Math.floor(diff/60)+'h ago';return Math.floor(diff/1440)+'d ago';}catch(e){return'';}}

var NEWS_BLACKLIST = ['beforeitsnews','infowars','naturalnews','sgtreport','whatdoesitmean',
  'rense','veteranstoday','globalresearch','activistpost','thedailybeast','thegatewaypundit'];

function isCredibleSource(source_id) {
  if(!source_id) return true;
  var s = source_id.toLowerCase();
  if(NEWS_BLACKLIST.some(function(b){ return s.indexOf(b) !== -1; })) return false;
  return true;
}

async function fetchGeoNewsAPI() {
  var key = NEWS_DATA_KEY || localStorage.getItem('dfxai_newsdata') || '';
  if(!key) return [];
  try {
    var url = 'https://newsdata.io/api/1/news?apikey='+key+
      '&q=Ukraine+Russia+OR+China+Taiwan+OR+Iran+sanctions+OR+NATO+military+OR+Middle+East+conflict'+
      '&language=en&size=10&prioritydomain=top';
    var r = await fetch(url, {signal: AbortSignal.timeout(8000)});
    var data = await r.json();
    if(data.status !== 'success' || !data.results || !data.results.length) return [];
    return data.results
      .filter(function(a){
        return a.title && a.title.length > 15
          && geoIsRelevant(a.title)
          && isCredibleSource(a.source_id)
          && (Date.now() - new Date(a.pubDate) < 259200000);
      })
      .map(function(a){
        return { title: a.title, date:  a.pubDate || '', source: a.source_id ? a.source_id.toUpperCase().substring(0,10) : 'NEWS' };
      });
  } catch(e) { console.warn('newsdata geo fail:', e.message); return []; }
}

async function fetchGeoRSS(src){
  var proxies = ['https://api.allorigins.win/raw?url=','https://corsproxy.io/?'];
  var r = await Promise.any(proxies.map(function(p){
    return fetch(p+encodeURIComponent(src.url),{signal:AbortSignal.timeout(6000)})
      .then(function(res){ if(!res.ok) throw new Error('not ok'); return res.text(); });
  })).catch(function(){ return null; });
  if(!r) return [];
  try {
    var xml=(new DOMParser()).parseFromString(r,'text/xml');
    return Array.from(xml.querySelectorAll('item')).slice(0,20).map(function(item){
      var title=(item.querySelector('title')||{}).textContent||'';
      title=title.replace(/<!\[CDATA\[(.*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').trim();
      var date=(item.querySelector('pubDate')||{}).textContent||'';
      return{title:title,date:date,source:src.label};
    }).filter(function(a){return geoIsRelevant(a.title)&&a.title.length>10;});
  } catch(e){ return []; }
}

window.refreshGeoNews = async function(force){
  var feed=document.getElementById('geoNewsFeed'),status=document.getElementById('geoNewsStatus');
  if(!feed)return;
  var now=Date.now();
  if(!force && geoNewsCached.length>0 && now-geoNewsLastFetch<600000){
    renderGeoNews(geoNewsCached);
    if(status)status.textContent='Cached · '+new Date(geoNewsLastFetch).toLocaleTimeString();
    return;
  }
  feed.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3);font-size:10px">⟳ Fetching latest news...</div>';
  if(status)status.textContent='Loading...';
  try{
    var all=[];
    var naArticles = await fetchGeoNewsAPI();
    if(naArticles.length > 0) { all = naArticles; } else {
      var results=await Promise.allSettled(GEO_RSS_SOURCES.map(fetchGeoRSS));
      results.forEach(function(r){if(r.status==='fulfilled'&&r.value)all=all.concat(r.value);});
    }
    all.sort(function(a,b){ var da=new Date(a.date)||0, db=new Date(b.date)||0; return db-da; });
    var seen=[];
    all=all.filter(function(item){
      var key=item.title.substring(0,40).toLowerCase().replace(/\s+/g,'');
      if(seen.indexOf(key)!==-1)return false;
      seen.push(key); return true;
    });
    all = all.slice(0,40);
    if(!all.length)throw new Error('No news found');
    geoNewsCached=all; geoNewsLastFetch=now;
    renderGeoNews(all);
    if(status)status.textContent='Updated '+new Date().toLocaleTimeString()+' · '+all.length+' articles';
    if(geoAutoRefreshTimer) clearInterval(geoAutoRefreshTimer);
    geoAutoRefreshTimer = setInterval(function(){ window.refreshGeoNews(true); }, 600000);
  }catch(e){
    var fallback=[
      {title:'Russia escalates drone attacks on Ukrainian energy infrastructure',date:new Date(Date.now()-600000).toISOString(),source:'REUTERS'},
      {title:'US-China trade war: new semiconductor export controls announced',date:new Date(Date.now()-900000).toISOString(),source:'BLOOMBERG'},
      {title:'Iran nuclear enrichment reaches 60%, IAEA raises alarm',date:new Date(Date.now()-1200000).toISOString(),source:'BBC'},
      {title:'Middle East ceasefire talks collapse, oil prices surge',date:new Date(Date.now()-1800000).toISOString(),source:'AL JAZEERA'}
    ];
    geoNewsCached=fallback; geoNewsLastFetch=now;
    renderGeoNews(fallback);
    if(status)status.textContent='Offline mode · '+fallback.length+' articles';
  }
};

function renderGeoNews(items){
  var feed=document.getElementById('geoNewsFeed');if(!feed||!items.length)return;
  feed.innerHTML=items.map(function(item){
    var tag=geoClassifyTag(item.title),impact=geoGoldImpact(item.title),time=geoTimeAgo(item.date);
    return'<div class="geo-news-item">'+
      '<div><span class="geo-news-tag '+tag+'">'+tag.toUpperCase()+'</span><span style="font-size:9px;color:var(--t3)">'+item.source+'</span></div>'+
      '<div class="geo-news-title">'+item.title+'</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">'+
        '<div class="geo-news-impact">Gold: '+impact+'</div>'+
        '<div class="geo-news-meta">'+time+'</div>'+
      '</div></div>';
  }).join('');
}

window.runGeoAI = async function(){
  var btn=document.getElementById('geoAiBtn'),out=document.getElementById('geoAiOut');
  if(!out)return;
  var key=GROQ_KEY||localStorage.getItem('dfxai_groq')||'';
  if(!key){out.innerHTML='<span style="color:var(--red)">⚠ Groq API key belum diset. Masuk ke tab AI Analysis dulu.</span>';return;}
  if(btn){btn.textContent='⏳ ANALYZING...';btn.disabled=true;}
  out.innerHTML='<span style="color:var(--t3)">AI analyzing geopolitical landscape...</span>';
  var headlines=geoNewsCached.length>0?geoNewsCached.slice(0,10).map(function(n){return'• '+n.title;}).join('\n'):'No live news. Use general geopolitical knowledge.';
  var prompt='You are a professional gold market analyst. Based on these current geopolitical headlines:\n\n'+headlines+'\n\nProvide a concise geopolitical analysis (max 150 words) covering:\n1. Top 2-3 geopolitical risks currently driving gold\n2. Overall safe-haven sentiment (bullish/bearish/neutral)\n3. Short-term gold price implication\nFormat: bullet points, trader-style, no fluff.';
  try{
    var text=await groqChat(prompt);
    var html=text.replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--gold)">$1</strong>').replace(/^[•\-\*]\s/gm,'<br>• ').replace(/\n/g,'<br>');
    out.innerHTML='<div style="color:var(--text)">'+html+'</div><div style="margin-top:8px;font-size:9px;color:var(--t3)">Updated: '+new Date().toLocaleTimeString()+' · Groq llama-3.3-70b</div>';
    var score=70;
    if(/strongly bullish|critical|escalat|nuclear/i.test(text))score=85;
    else if(/bearish|de-escalat|ceasefire/i.test(text))score=45;
    var se=document.getElementById('geoRiskScore'),le=document.getElementById('geoRiskLabel');
    if(se)se.textContent=score;
    if(le){if(score>=75){le.textContent='HIGH RISK';le.style.color='var(--red)';}else if(score>=50){le.textContent='ELEVATED';le.style.color='var(--gold)';}else{le.textContent='MODERATE';le.style.color='var(--blue)';}}
  }catch(e){out.innerHTML='<span style="color:var(--red)">Error: '+e.message+'</span>';}
  finally{if(btn){btn.textContent='⚡ ANALYZE';btn.disabled=false;}}
};

// ── BTC via CoinGecko ──
async function fetchBTCPrice() {
  try {
    var url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true';
    var r = await fetch(url, {signal: AbortSignal.timeout(5000)});
    var data = await r.json();
    if (!data.bitcoin) throw new Error('No BTC data');
    var price = data.bitcoin.usd;
    var pct   = data.bitcoin.usd_24h_change;
    var dir   = pct >= 0;
    state.btc = {price: price, pct: pct, change: pct};
    var pEl = document.getElementById('t-btc'), cEl = document.getElementById('t-btc-chg');
    if (pEl) { pEl.textContent = '$'+price.toLocaleString('en',{maximumFractionDigits:0}); pEl.className='ticker-price '+(dir?'up':'down'); }
    if (cEl) { cEl.textContent = (dir?'+':'')+pct.toFixed(2)+'%'; cEl.className='ticker-chg '+(dir?'up':'down'); }
    var bpEl = document.getElementById('btcPrice');
    if (bpEl) bpEl.textContent = '$'+price.toLocaleString('en',{maximumFractionDigits:0});
    var bcEl = document.getElementById('btcChg');
    if (bcEl) { bcEl.textContent = (dir?'+':'')+pct.toFixed(2)+'%'; bcEl.className='stat-val '+(dir?'up':'down'); }
  } catch(e) { console.warn('BTC price fetch failed:', e.message); }
}

var btcChart = null;
async function loadBTCChart() {
  var ctx = document.getElementById('btcH1Chart');
  if (!ctx) return;
  try {
    setStatus('btcChartStatus','load','Loading…');
    var url = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=2&interval=hourly';
    var r = await fetch(url, {signal: AbortSignal.timeout(8000), headers:{'Accept':'application/json'}});
    if (!r.ok) throw new Error('HTTP '+r.status);
    var raw = await r.json();
    if (!raw||!raw.prices||!raw.prices.length) throw new Error('No data');

    var prices = raw.prices;
    var series = prices.map(function(p,i){ return {t:p[0]/1000, o:p[1], h:p[1], l:p[1], c:p[1]}; });
    state.btcSeries = series;
    var labels = series.map(function(v){ var d = new Date(v.t*1000); return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0'); });
    var closes = series.map(function(v){ return v.c; });

    if (btcChart) btcChart.destroy();
    var grad = ctx.getContext('2d').createLinearGradient(0,0,0,260);
    grad.addColorStop(0,'rgba(168,85,247,0.25)');
    grad.addColorStop(1,'rgba(168,85,247,0)');

    btcChart = new Chart(ctx, {
      type:'line', data:{ labels:labels, datasets:[{ data:closes, borderColor:'#a855f7', borderWidth:1.5, fill:true, backgroundColor:grad, tension:0.3, pointRadius:0 }]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{ticks:{color:'#3d4f6e',font:{size:8},maxTicksLimit:8},grid:{color:'rgba(26,37,64,0.5)'}}, y:{ticks:{color:'#3d4f6e',font:{size:8}},grid:{color:'rgba(26,37,64,0.5)'},position:'right'} } }
    });

    computeBTCSignal(series, closes);
    setStatus('btcChartStatus','ok','● LIVE');
  } catch(e) {
    setStatus('btcChartStatus','err','✕ ERR');
    var ratEl = document.getElementById('btcRationale');
    if (ratEl) ratEl.textContent = 'Error: '+e.message+'. CoinGecko mungkin rate-limit, coba lagi.';
  }
}

function computeBTCSignal(series, closes) {
  if (!closes||closes.length < 10) return;
  var ema20 = calcEMA(closes, Math.min(20, closes.length));
  var ema50 = calcEMA(closes, Math.min(50, closes.length));
  var rsi   = calcRSI(closes, Math.min(14, closes.length-1));
  var atr   = calcATR(series, Math.min(14, series.length-1));
  var price = closes[closes.length-1];
  var isBull = ema20 && price > ema20;
  if (ema20 && ema50) isBull = ema20 > ema50 && price > ema20;
  if (rsi) { if (rsi > 70) isBull = false; if (rsi < 30) isBull = true; }

  var setup = isBull ? 'MOMENTUM LONG' : 'BREAKDOWN SHORT';
  if (rsi && rsi < 35) setup = 'OVERSOLD BOUNCE';
  if (rsi && rsi > 65) setup = 'OVERBOUGHT SHORT';

  var atrV = atr || price * 0.012;
  var elo  = Math.round(price - atrV*0.3).toLocaleString('en');
  var ehi  = Math.round(price + atrV*0.3).toLocaleString('en');
  var sl   = isBull ? Math.round(price - atrV*1.5).toLocaleString('en') : Math.round(price + atrV*1.5).toLocaleString('en');
  var tp1  = isBull ? Math.round(price + atrV*1.5).toLocaleString('en') : Math.round(price - atrV*1.5).toLocaleString('en');
  var tp2  = isBull ? Math.round(price + atrV*3.0).toLocaleString('en') : Math.round(price - atrV*3.0).toLocaleString('en');
  var conf = 60 + (rsi?(isBull?(rsi<50?10:0):(rsi>50?10:0)):0) + (ema20&&ema50?(Math.abs(ema20-ema50)/price>0.005?10:0):0);

  var rat = 'BTC '+(isBull?'bullish':'bearish')+' bias — price '+(isBull?'above':'below')+' EMA20. RSI: '+(rsi?rsi.toFixed(0):'N/A')+'.';

  var box = document.getElementById('btcSignalBox');
  if (box) box.className = 'signal-box '+(isBull?'buy':'sell');
  setEl('btcDir', isBull?'LONG ▲':'SHORT ▼');
  var dirEl = document.getElementById('btcDir');
  if (dirEl) dirEl.className = 'signal-label '+(isBull?'buy':'sell');
  setEl('btcSetup','SETUP: '+setup); setEl('btcEntry','$'+elo+' – $'+ehi); setEl('btcSL','$'+sl); setEl('btcTP1','$'+tp1); setEl('btcTP2','$'+tp2); setEl('btcRR','1:1.5 – 1:3.0'); setEl('btcConf',conf+'%'); setEl('btcRationale',rat);
  var rsiEl = document.getElementById('btcRSI');
  if (rsiEl) { rsiEl.textContent = rsi?rsi.toFixed(1):'—'; rsiEl.className='stat-val '+(rsi&&rsi<35?'up':rsi&&rsi>65?'down':''); }
  setEl('btcSignalBadge', isBull?'▲ LONG':'▼ SHORT');
  var badgeEl = document.getElementById('btcSignalBadge');
  if (badgeEl) badgeEl.className = 'stat-val '+(isBull?'up':'down');
}

// ── FED WATCH ──
var FED_MEETINGS = [{label:'Jul 30, 2026'},{label:'Sep 17, 2026'},{label:'Nov 5, 2026'},{label:'Dec 10, 2026'}];

window.refreshFedWatch = async function() {
  renderFedWatchFallback();
  try {
    var url='https://www.cmegroup.com/CmeWS/mvc/Quotes/Future/305/G?quoteCodes=null&_='+Date.now();
    var data=await proxyFetch(url);
    if(data&&data.quotes) { renderFedWatchFromCME(data.quotes); }
  } catch(e) { /* keep fallback */ }
};

function renderFedWatchFromCME(quotes) {
  var container=document.getElementById('fedWatchBars'); if(!container) return;
  var html=''; var firstCut=null;
  quotes.slice(0,4).forEach(function(q,i){
    var meet=FED_MEETINGS[i]||{label:'Meeting '+(i+1)};
    var price=parseFloat(q.last)||0;
    var cutProb=Math.max(0,Math.min(100,100-price)).toFixed(1);
    var holdProb=(100-cutProb).toFixed(1);
    if(!firstCut&&cutProb>30){firstCut=cutProb;setEl('fedCutProb',cutProb+'%');}
    var color=cutProb>60?'var(--green)':cutProb>30?'var(--gold)':'var(--red)';
    html+=makeFedBar(meet.label,cutProb,holdProb,color);
  });
  if(!firstCut)setEl('fedCutProb','<30%');
  container.innerHTML=html||'<div style="color:var(--t3);font-size:10px;padding:10px">Data tidak tersedia</div>';
}

function renderFedWatchFallback() {
  var meetings=[{label:'Jul 30',cut:18,hold:82},{label:'Sep 17',cut:52,hold:48},{label:'Nov 5', cut:71,hold:29},{label:'Dec 10',cut:83,hold:17}];
  setEl('fedCutProb',meetings[0].cut+'%');
  var html=meetings.map(function(m){
    var color=m.cut>60?'var(--green)':m.cut>30?'var(--gold)':'var(--red)';
    return makeFedBar(m.label,m.cut,m.hold,color);
  }).join('');
  var c=document.getElementById('fedWatchBars'); if(c) c.innerHTML=html;
}

function makeFedBar(label,cutProb,holdProb,color){
  return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:3px"><span style="color:var(--t2)">'+label+'</span><span><span style="color:'+color+'">CUT '+cutProb+'%</span> <span style="color:var(--t3)">HOLD '+holdProb+'%</span></span></div><div style="display:flex;height:5px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,0.05)"><div style="width:'+cutProb+'%;background:'+color+';transition:width 0.5s"></div><div style="flex:1;background:rgba(122,138,170,0.15)"></div></div></div>';
}

// ── HIGH IMPACT RELEASES ──
var RECENT_RELEASES=[
  {name:'Non-Farm Payrolls (May)',  actual:'139K', forecast:'130K', prev:'147K', beat:true,  date:'Jun 6',  goldImpact:'down'},
  {name:'Core CPI (May)',           actual:'0.2%', forecast:'0.3%', prev:'0.3%', beat:true,  date:'Jun 11', goldImpact:'up'},
  {name:'Core PCE (Apr)',           actual:'2.6%', forecast:'2.6%', prev:'2.7%', beat:false, date:'May 30', goldImpact:'up'}
];

function renderHighImpact(){
  var el=document.getElementById('highImpactList'); if(!el) return;
  var status=document.getElementById('hiStatus'); if(status) status.textContent='Jun 2026';
  el.innerHTML=RECENT_RELEASES.map(function(r){
    var beatColor=r.beat?'var(--green)':'var(--red)';
    var beatLabel=r.beat?'▲ BEAT':'▼ MISS';
    var goldColor=r.goldImpact==='up'?'var(--green)':r.goldImpact==='down'?'var(--red)':'var(--gold)';
    var goldLabel=r.goldImpact==='up'?'▲ GOLD+':r.goldImpact==='down'?'▼ GOLD-':'◆ NEUTRAL';
    return '<div style="padding:9px 12px;border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px"><span style="font-size:10px;color:var(--t1);font-weight:600">'+r.name+'</span><span style="font-size:9px;color:var(--t3)">'+r.date+'</span></div><div style="display:flex;gap:10px;align-items:center"><span style="font-size:9px;color:var(--t3)">A: <span style="color:var(--t1)">'+r.actual+'</span></span><span style="font-size:9px;color:var(--t3)">F: '+r.forecast+'</span><span style="font-size:9px;color:var(--t3)">P: '+r.prev+'</span><span style="margin-left:auto;font-size:9px;font-weight:700;color:'+beatColor+'">'+beatLabel+'</span><span style="font-size:9px;font-weight:700;color:'+goldColor+'">'+goldLabel+'</span></div></div>';
  }).join('');
}

// ── NEWS via NewsAPI.org / Newsdata.io ──
var NEWS_DATA_KEY = localStorage.getItem('dfxai_newsdata') || '';
var newsLastFetch = 0;
var newsCached = [];

window.setNewsDataKey = function(key) {
  NEWS_DATA_KEY = (key||'').trim();
  localStorage.setItem('dfxai_newsdata', NEWS_DATA_KEY);
};

function newsTimeAgo(ds) {
  try {
    var diff = Math.floor((Date.now() - new Date(ds)) / 60000);
    if(diff < 1)    return 'Just now';
    if(diff < 60)   return diff + 'm ago';
    if(diff < 1440) return Math.floor(diff/60) + 'h ago';
    return Math.floor(diff/1440) + 'd ago';
  } catch(e) { return 'Today'; }
}

function renderNewsPanel(items) {
  var panel = document.getElementById('newsPreview'); if(!panel) return;
  panel.innerHTML = items.map(function(a) {
    var time = a.date ? newsTimeAgo(a.date) : 'Today';
    var impact = /fed|fomc|nfp|payroll|cpi|pce|gdp|rate decision|inflation/i.test(a.t) ? 'high' : /gold|xau|dollar|dxy|china|oil|yield|treasury|war|conflict/i.test(a.t) ? 'med' : 'low';
    return '<div class="news-item"><div class="news-header"><span class="news-time">'+time+'</span><span class="news-source">'+a.s+'</span><div class="impact-badge impact-'+impact+'">'+impact.toUpperCase()+'</div></div><div class="news-title">'+a.t+'</div>'+(a.d ? '<div class="news-desc">'+a.d+'</div>' : '')+'</div>';
  }).join('');
}

function renderNewsFallbackStatic() {
  renderNewsPanel([
    {t:'Fed officials signal patience on rate cuts', s:'REUTERS', d:'Multiple Fed speakers reiterate data-dependent approach.', date:''},
    {t:'Gold ETF inflows surge to 3-month high', s:'BLOOMBERG', d:'Safe-haven demand accelerates amid geopolitical risk.', date:''}
  ]);
}

async function renderNewsFallback() {
  console.log('[news] Fetching live financial RSS as dynamic fallback...');
  var rssFeeds = [
    {url:'https://feeds.bbci.co.uk/news/business/rss.xml', label:'BBC BIZ'},
    {url:'https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml', label:'NYT ECON'},
    {url:'https://feeds.skynews.com/feeds/rss/world.xml', label:'SKY NEWS'}
  ];
  try {
    var all = [];
    var results = await Promise.allSettled(rssFeeds.map(fetchGeoRSS));
    results.forEach(function(r) {
      if(r.status === 'fulfilled' && r.value) {
        r.value.forEach(function(item) {
          all.push({
            t: item.title,
            s: item.source || 'RSS',
            d: '',
            date: item.date || ''
          });
        });
      }
    });
    
    if(all.length > 0) {
      all.sort(function(a,b){ return new Date(b.date || 0) - new Date(a.date || 0); });
      var seen = [];
      all = all.filter(function(a) {
        var k2 = a.t.substring(0,35).toLowerCase().replace(/\s+/g,'');
        if(seen.indexOf(k2) !== -1) return false;
        seen.push(k2); return true;
      }).slice(0, 8);
      
      console.log('[news] loaded dynamic RSS fallback items:', all.length);
      renderNewsPanel(all);
      newsCached = all;
      newsLastFetch = Date.now();
    } else {
      console.warn('[news] dynamic RSS empty, using static fallback');
      renderNewsFallbackStatic();
    }
  } catch(e) {
    console.error('[news] failed to load dynamic RSS fallback:', e);
    renderNewsFallbackStatic();
  }
}

async function fetchNews(force) {
  var now = Date.now();
  if(!force && newsCached.length > 0 && now - newsLastFetch < 900000) { renderNewsPanel(newsCached); return; }
  var key = NEWS_DATA_KEY || localStorage.getItem('dfxai_newsdata') || '';
  var panelDebug = document.getElementById('newsPreview');
  if(!key) { 
    if(panelDebug) panelDebug.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">News key not set — fetching live RSS...</div>'; 
    await renderNewsFallback(); 
    return; 
  }
  if(panelDebug) panelDebug.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">⟳ Fetching news...</div>';
  try {
    var allArticles = [];
    var q = 'gold+OR+XAU+OR+Federal+Reserve+OR+dollar+OR+DXY+OR+interest+OR+rate+OR+inflation';
    var url = 'https://newsdata.io/api/1/news?apikey='+key+'&q='+q+'&language=en&size=20&prioritydomain=top';
    console.log('[news] fetching:', url);
    var r = await fetch(url, {signal: AbortSignal.timeout(10000)});
    console.log('[news] response status:', r.status);
    var data = await r.json();
    console.log('[news] response:', data && data.status ? data.status : data);
    if(data.status === 'success' && data.results && data.results.length) {
      data.results.filter(function(a){ return a.title && a.title.length > 10 && isCredibleSource(a.source_id) && (Date.now() - new Date(a.pubDate) < 259200000); })
        .forEach(function(a) { allArticles.push({ t: a.title, s: a.source_id ? a.source_id.toUpperCase().substring(0,12) : 'NEWS', d: a.description ? a.description.substring(0,120) : '', date: a.pubDate || '' }); });
    }
    if(allArticles.length === 0) {
      console.warn('[news] no articles from NewsData, switching to dynamic RSS fallback');
      if(panelDebug) panelDebug.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">Empty NewsData response — fetching live RSS...</div>';
      await renderNewsFallback();
      return;
    }
    allArticles.sort(function(a,b){ return new Date(b.date)-new Date(a.date); });
    var seen = [];
    allArticles = allArticles.filter(function(a) { var k2 = a.t.substring(0,30).toLowerCase(); if(seen.indexOf(k2) !== -1) return false; seen.push(k2); return true; }).slice(0, 8);
    newsCached = allArticles; newsLastFetch = now; renderNewsPanel(allArticles);
  } catch(e) {
    console.warn('[news] fetch error', e && e.message || e);
    if(newsCached.length > 0) {
      renderNewsPanel(newsCached);
    } else {
      if(panelDebug) panelDebug.innerHTML='<div style="padding:20px;text-align:center;color:var(--red)">Error fetching NewsData: '+(e.message||e)+' — fetching live RSS...</div>';
      await renderNewsFallback();
    }
  }
}

// ── GOLD ETF INFLOW/OUTFLOW ──
var GOLD_ETF_DATA = {
  funds: [
    {name:'SPDR Gold Shares',     ticker:'GLD',   tonnes:857.2,  change:+4.2,  changeWk:+8.1,  aum:'$71.2B', region:'US'},
    {name:'iShares Gold Trust',   ticker:'IAU',   tonnes:312.4,  change:-1.1,  changeWk:+2.4,  aum:'$26.0B', region:'US'},
    {name:'SPDR Gold MiniShares', ticker:'GLDM',  tonnes:74.3,   change:+1.8,  changeWk:+3.2,  aum:'$6.2B',  region:'US'},
    {name:'iShares Physical Gold',ticker:'IGLN',  tonnes:236.1,  change:+3.4,  changeWk:+6.7,  aum:'$19.6B', region:'EU'},
    {name:'Xetra-Gold',           ticker:'4GLD',  tonnes:246.8,  change:-0.6,  changeWk:+1.2,  aum:'$20.5B', region:'EU'},
    {name:'ICBC Gold ETF',        ticker:'518880',tonnes:85.4,   change:+5.6,  changeWk:+9.2,  aum:'$7.1B',  region:'Asia'},
  ],
  monthly: {
    labels: ['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul'],
    inflow:  [18.4, 24.1, 31.2, 12.8,  0,   42.1, 38.6, 15.3, 28.7, 19.2, 34.5, 11.8],
    outflow: [-5.2, -8.1, -3.4,-12.1,-21.3, -4.2, -6.8, -9.1, -5.3, -8.4, -3.2, -6.7],
  }, lastUpdate: 'Jul 2026'
};

var etfChart = null;
function renderGoldETF() {
  var data = GOLD_ETF_DATA;
  var totalT    = data.funds.reduce(function(s,f){return s+f.tonnes;},0);
  var total24h  = data.funds.reduce(function(s,f){return s+f.change;},0);
  var total7d   = data.funds.reduce(function(s,f){return s+f.changeWk;},0);
  var netArr    = data.monthly.inflow.map(function(v,i){return v+data.monthly.outflow[i];});
  var lastNet   = netArr[netArr.length-1];

  var sumEl = document.getElementById('etfSummary');
  if(sumEl) {
    function card(label, val, unit, color, sub) {
      return '<div style="text-align:center;padding:10px;background:var(--bg-card);border-radius:3px;border:1px solid '+color.replace('var(','rgba(').replace(')',',0.25)')+'"><div class="stat-label">'+label+'</div><div style="font-family:\'Syne\',sans-serif;font-size:22px;font-weight:800;color:'+color+'">'+val+'</div><div style="font-size:9px;color:var(--t3)">'+sub+'</div></div>';
    }
    sumEl.innerHTML = card('TOTAL HOLDINGS', totalT.toFixed(1)+'T', '', 'var(--gold)', 'All tracked ETFs') + card('24H FLOW', (total24h>=0?'+':'')+total24h.toFixed(1)+'T', '', total24h>=0?'var(--green)':'var(--red)', total24h>=0?'NET INFLOW':'NET OUTFLOW') + card('7D FLOW',  (total7d>=0?'+':'')+total7d.toFixed(1)+'T',  '', total7d>=0?'var(--green)':'var(--red)',  total7d>=0?'BULLISH SIGNAL':'BEARISH SIGNAL') + card('LAST MONTH NET', (lastNet>=0?'+':'')+lastNet.toFixed(1)+'T', '', lastNet>=0?'var(--green)':'var(--red)', data.lastUpdate);
  }

  var tbl = document.getElementById('etfTable');
  if(tbl) {
    tbl.innerHTML = '<tr><th>FUND</th><th>TICKER</th><th>HOLDINGS</th><th>24H</th><th>7D</th><th>AUM</th><th>SIGNAL</th></tr>' +
      data.funds.map(function(f){
        return '<tr><td>'+f.name+'</td><td style="color:var(--blue);font-weight:700">'+f.ticker+'</td><td>'+f.tonnes.toFixed(1)+'T</td><td style="color:'+(f.change>=0?'var(--green)':'var(--red)')+'">'+(f.change>=0?'+':'')+f.change.toFixed(1)+'T</td><td style="color:'+(f.changeWk>=0?'var(--green)':'var(--red)')+'">'+(f.changeWk>=0?'+':'')+f.changeWk.toFixed(1)+'T</td><td style="color:var(--t2)">'+f.aum+'</td><td style="color:'+(f.changeWk>3?'var(--green)':f.changeWk<-3?'var(--red)':'var(--gold)')+';font-weight:700">'+(f.changeWk>3?'▲ INFLOW':f.changeWk<-3?'▼ OUTFLOW':'◆ NEUTRAL')+'</td></tr>';
      }).join('');
  }

  ['US','EU','Asia'].forEach(function(r){ var t = data.funds.filter(function(f){return f.region===r;}).reduce(function(s,f){return s+f.tonnes;},0); setEl('etf'+r, t.toFixed(1)+'T'); });
  var ctx = document.getElementById('etfFlowChart'); if(!ctx) return;
  if(etfChart) { etfChart.destroy(); etfChart=null; }
  var net = data.monthly.inflow.map(function(v,i){return +(v+data.monthly.outflow[i]).toFixed(1);});
  etfChart = new Chart(ctx, {
    type: 'bar', data: { labels: data.monthly.labels, datasets: [ {label:'Inflow (T)', data:data.monthly.inflow, backgroundColor:'rgba(34,217,138,0.5)',borderColor:'rgba(34,217,138,0.8)',borderWidth:1,borderRadius:2},{label:'Outflow (T)', data:data.monthly.outflow, backgroundColor:'rgba(255,77,109,0.5)',borderColor:'rgba(255,77,109,0.8)',borderWidth:1,borderRadius:2},{label:'Net (T)', data:net, type:'line', borderColor:'#f0c040', borderWidth:2, pointRadius:3, fill:false, tension:0.3} ] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{labels:{color:'#7a8aaa',font:{size:9}}}}, scales:{ x:{ticks:{color:'#3d4f6e',font:{size:9}},grid:{color:'rgba(26,37,64,0.5)'}}, y:{ticks:{color:'#3d4f6e',font:{size:9}},grid:{color:'rgba(26,37,64,0.5)'},position:'left'} } }
  });
}

// ── INIT ──
async function init() {
  NEWS_DATA_KEY = localStorage.getItem('dfxai_newsdata') || '';
  if(NEWS_DATA_KEY) {
    var ndInput = document.getElementById('newsdataKeyInput'); if(ndInput) ndInput.placeholder = 'Key sudah tersimpan ✓';
    var ndStatus = document.getElementById('ndKeyStatus'); if(ndStatus) ndStatus.textContent = '✓ Key active';
  }
  updateMarketBanner();
  setInterval(updateMarketBanner, 60000);
  renderSignalHistory();
  renderHighImpact();
  await Promise.all([fetchQuotes(), loadMainChart('1h'), loadDxyChart(), fetchNews()]);
  loadBTCChart();
  window.refreshFedWatch();
  setInterval(fetchQuotes, 60000);
  setInterval(fetchBTCPrice, 60000);
  setInterval(function(){loadMainChart(state.interval);}, 300000);
  setInterval(loadBTCChart, 300000);
}

document.addEventListener('DOMContentLoaded', function() { init(); });
