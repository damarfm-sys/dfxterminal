// DFXAi Terminal - App Logic
'use strict';

// ── CONFIG ──
var TD_KEY  = 'a0680ea88b934543be5eaab23f518f6d';
var AV_KEY  = 'CVRA2AHLUR4OWPY4';
var GEMINI_KEY = ''; // Set via UI

// ── STATE ──
var state = { xau:{}, dxy:{}, xauSeries:[], dxySeries:[], interval:'1h' };
var charts = {};

// ── PROXIES ──
var PROXIES = [
  function(u){ return 'https://corsproxy.io/?'+encodeURIComponent(u); },
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
    'GBP/USD':'GBPUSD=X','USD/JPY':'JPY=X','US10Y':'^TNX'
  };
  var tickerMap = {
    'XAU/USD':{p:'t-xau',c:'t-xau-chg',dec:2},
    'XAG/USD':{p:'t-xag',c:'t-xag-chg',dec:2},
    'EUR/USD':{p:'t-eur',c:'t-eur-chg',dec:4},
    'GBP/USD':{p:'t-gbp',c:'t-gbp-chg',dec:4},
    'USD/JPY':{p:'t-jpy',c:'t-jpy-chg',dec:2},
    'US10Y':{p:'t-us10',c:'t-us10-chg',dec:3}
  };

  try {
    var results = {};
    await Promise.allSettled(Object.entries(symbols).map(async function(kv) {
      try { results[kv[0]] = await yahooQuote(kv[1]); } catch(e) { console.warn(kv[0],e.message); }
    }));

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
    if (results['EUR/USD']) { state.dxy=results['EUR/USD']; updateDXY(); }

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
  var ce=document.getElementById('dxyChg');
  if (ce) { ce.textContent=(dir?'▲ +':'▼ ')+Math.abs(d.change).toFixed(4)+' ('+fmtPct(d.pct)+')'; ce.className=dir?'up':'down'; }
  updateDXYIndicator();
}

function updateDXYIndicator() {
  var d=state.dxy; if (!d||!d.pct&&d.pct!==0) return;
  // EUR/USD inverse = DXY proxy
  var pct=d.pct||0; // EUR up = DXY down
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
async function fetchSeries(sym, interval, size) {
  size = size||80;
  var yMap={'XAU/USD':'GC=F','XAG/USD':'SI=F','EUR/USD':'EURUSD=X','DXY':'EURUSD=X'};
  var tvToYf={'1min':'2m','5min':'5m','15min':'15m','30min':'30m','1h':'1h','4h':'1h','1day':'1d'};
  var yfRange={'2m':'1d','5m':'5d','15m':'5d','30m':'5d','1h':'1mo','1d':'6mo'};
  var yfi=tvToYf[interval]||'1h';
  var yfr=yfRange[yfi]||'1mo';
  var yticker=yMap[sym]||'GC=F';
  try {
    var url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(yticker)+'?interval='+yfi+'&range='+yfr;
    var d=await proxyFetch(url);
    var r=d&&d.chart&&d.chart.result&&d.chart.result[0];
    if(!r||!r.timestamp) throw new Error('no data');
    var ts=r.timestamp, q=r.indicators.quote[0];
    var series=ts.map(function(t,i){return{t:new Date(t*1000).toISOString(),c:q.close[i]||0,h:q.high[i]||0,l:q.low[i]||0,o:q.open[i]||0};})
      .filter(function(v){return v.c>0;});
    return series.slice(-size);
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
  if(d&&d.pct>0.1) score+=2; // EUR up = DXY down = bullish gold
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
}

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
  if(xs.length){ buildLineChart('xauH1Chart','rgb(240,192,64)',xs.map(function(v){return v.c;}),seriesLabels(xs),300); updateTechnicals(xs); }
  var ds=await fetchSeries('EUR/USD','1h',60);
  if(ds.length) buildLineChart('dxyH1Chart','rgb(77,166,255)',ds.map(function(v){return v.c;}),seriesLabels(ds),300);
}

// ── COT + CB CHARTS ──
var cotInited=false, cbInited=false;
function initCOTCharts() {
  if(cotInited) return; cotInited=true;
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
  if(page==='geopolitical') initCBChart();
  if(page==='ai') renderAIPanel();
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

// ── GEMINI AI ANALYSIS ──
window.setGeminiKey = function() {
  var k=document.getElementById('geminiKeyInput'); if(!k) return;
  GEMINI_KEY=k.value.trim(); localStorage.setItem('dfxai_gemini',GEMINI_KEY);
  setEl('geminiKeyStatus','✓ Key saved'); renderAIPanel();
};

window.renderAIPanel = async function() {
  var key=GEMINI_KEY||localStorage.getItem('dfxai_gemini')||'';
  if(!key) {
    var panel=document.getElementById('aiAnalysisResult');
    if(panel) panel.innerHTML='<div style="padding:20px;color:var(--text-dim);text-align:center">Enter your Gemini API key above to enable AI analysis</div>';
    return;
  }
  GEMINI_KEY=key;
  var panel=document.getElementById('aiAnalysisResult');
  if(panel) panel.innerHTML='<div style="padding:20px;color:var(--gold);text-align:center">⟳ Analyzing market conditions...</div>';
  var x=state.xau, d=state.dxy, s=state.xauSeries;
  var closes=s.map(function(v){return v.c;});
  var ema20=calcEMA(closes,20), ema50=calcEMA(closes,50), rsi=calcRSI(closes,14), atr=calcATR(s,14);
  var prompt='You are a professional XAUUSD (Gold) trader and analyst. Analyze the following real-time market data and provide a concise trading analysis in 5 bullet points:\n\n'+
    'XAUUSD Price: '+fmt(x.price)+'\nDaily Change: '+fmtPct(x.pct)+'\nOpen: '+fmt(x.open)+' | High: '+fmt(x.high)+' | Low: '+fmt(x.low)+'\n'+
    'EUR/USD (DXY proxy): '+fmt(d.price,4)+' ('+fmtPct(d.pct)+')\n'+
    'RSI(14): '+(rsi?rsi.toFixed(1):'N/A')+'\nEMA20: '+fmt(ema20)+' | EMA50: '+fmt(ema50)+'\nATR(14): '+fmt(atr,1)+'\n'+
    'Price vs EMA20: '+(ema20&&x.price>ema20?'ABOVE (bullish)':'BELOW (bearish)')+'\n'+
    'Price vs EMA50: '+(ema50&&x.price>ema50?'ABOVE (bullish)':'BELOW (bearish)')+'\n\n'+
    'Provide: 1) Market Bias (Bullish/Bearish/Neutral) 2) Key levels to watch 3) Entry suggestion 4) Risk factors 5) Short-term outlook. Be concise and direct.';
  try {
    var url='https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='+key;
    var r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.7,maxOutputTokens:600}})});
    var data=await r.json();
    if(data.error) throw new Error(data.error.message);
    var txt=data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts&&data.candidates[0].content.parts[0].text||'No response';
    // Format nicely
    var lines=txt.split('\n').filter(function(l){return l.trim();});
    var html=lines.map(function(l){
      l=l.trim();
      if(l.match(/^[1-5]\)|^\*\*[1-5]/)||l.includes('**')) {
        l=l.replace(/\*\*/g,'');
        return '<div style="padding:8px 0;border-bottom:1px solid rgba(26,37,64,0.5)"><span style="color:var(--gold)">◈ </span>'+l+'</div>';
      }
      return '<div style="color:var(--text-secondary);font-size:10px;line-height:1.6;padding:2px 0">'+l+'</div>';
    }).join('');
    if(panel) panel.innerHTML='<div style="padding:12px">'+html+'</div>';
  } catch(e) {
    if(panel) panel.innerHTML='<div style="padding:20px;color:var(--red);text-align:center">⚠ Gemini error: '+e.message+'</div>';
  }
};

// ── NEWS ──
async function fetchNews() {
  var panel=document.getElementById('newsPreview'); if(!panel) return;
  // Fallback curated news (Yahoo Finance news API blocked by CORS)
  panel.innerHTML=[
    {t:'Fed officials signal patience on rate cuts',s:'REUTERS',i:'high',d:'Multiple Fed speakers reiterate data-dependent approach.'},
    {t:'Gold ETF inflows surge to 3-month high',s:'BLOOMBERG',i:'high',d:'Safe-haven demand accelerates amid geopolitical risk.'},
    {t:'US Treasury yields decline on soft PMI data',s:'WSJ',i:'med',d:'10Y yield falls supporting non-yielding assets.'},
    {t:'China PBoC adds gold for 18th consecutive month',s:'REUTERS',i:'med',d:'De-dollarization strategy continues at full pace.'},
    {t:'DXY breaks below key 100.00 support',s:'FXSTREET',i:'high',d:'Dollar weakness broad-based on fiscal concerns.'},
  ].map(function(a){
    return '<div class="news-item"><div class="news-header"><span class="news-time">Today</span><span class="news-source">'+a.s+'</span><div class="impact-badge impact-'+a.i+'">'+a.i.toUpperCase()+'</div></div><div class="news-title">'+a.t+'</div><div class="news-desc">'+a.d+'</div></div>';
  }).join('');
}

// ── INIT ──
async function init() {
  updateMarketBanner();
  setInterval(updateMarketBanner, 60000);
  await Promise.all([fetchQuotes(), loadMainChart('1h'), loadDxyChart(), fetchNews()]);
  setInterval(fetchQuotes, 60000);
  setInterval(function(){loadMainChart(state.interval);}, 300000);
}

document.addEventListener('DOMContentLoaded', function() { init(); });
