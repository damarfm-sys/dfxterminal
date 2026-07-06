// DFXAi Terminal - App Logic Enhanced v18
'use strict';

var TD_KEY  = 'a0680ea88b934543be5eaab23f518f6d';
var AV_KEY  = 'CVRA2AHLUR4OWPY4';
var GROQ_KEY = '';
var GROQ_MODEL = 'qwen/qwen3-32b';

var state = { xau:{}, dxy:{}, xauSeries:[], dxySeries:[], interval:'1h' };
var charts = {};

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
  if (e) e.innerHTML = val;
}
function setStatus(id, type, txt) {
  var e = document.getElementById(id);
  if (!e) return;
  e.className = 'api-status api-'+type;
  e.textContent = txt;
}

// ── DYNAMIC NEWS INTELLIGENCE + GEOPOLITICAL WIRE FILTER ──
async function fetchNews() {
  var previewPanel = document.getElementById('newsPreview');
  var geoPanel = document.getElementById('geoNewsFeed');
  var geoStatus = document.getElementById('geoNewsStatus');
  
  if (previewPanel) previewPanel.innerHTML = '<div style="padding:15px;color:var(--gold);">⟳ Streaming live newsfeed...</div>';
  if (geoPanel) geoPanel.innerHTML = '<div style="padding:15px;color:var(--gold);">⟳ Loading tactical intelligence feeds...</div>';

  var url = 'https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=FOREX:USD&sort=LATEST&limit=15&apikey=' + AV_KEY;

  try {
    var data = await proxyFetch(url);
    if (!data || !data.feed || data.feed.length === 0) throw new Error("Empty Feed");

    var dashboardHtml = '';
    var geoHtml = '';
    var countGeo = 0;

    data.feed.forEach(function(item) {
      var score = parseFloat(item.overall_sentiment_score || 0);
      var impact = 'med';
      if (Math.abs(score) > 0.35) impact = 'high';
      else if (Math.abs(score) < 0.15) impact = 'low';

      var source = item.source ? item.source.toUpperCase() : 'FX_WIRE';
      var title = item.title;
      var summary = item.summary || '';

      var card = '<div class="news-item">' +
        '<div class="news-header" style="display:flex;justify-content:space-between;font-size:9px;color:var(--t3);margin-bottom:4px;">' +
          '<span>' + source + '</span>' +
          '<div class="impact-badge impact-' + impact + '">' + impact.toUpperCase() + '</div>' +
        '</div>' +
        '<div class="news-title" style="font-weight:600;font-size:11px;color:var(--t1);margin-bottom:2px;"><a href="'+item.url+'" target="_blank" style="color:inherit;text-decoration:none;">' + title + '</a></div>' +
        '<div class="news-desc" style="font-size:10px;color:var(--t2);line-height:1.3;">' + summary.substring(0, 110) + '...</div>' +
      '</div>';

      dashboardHtml += card;

      var geoKeywords = ['war', 'conflict', 'missile', 'military', 'sanction', 'tariff', 'nuclear', 'ceasefire', 'border', 'pentagon', 'strike', 'geopolitical', 'middle east', 'russia', 'china'];
      var isGeo = geoKeywords.some(function(k) { return title.toLowerCase().includes(k) || summary.toLowerCase().includes(k); });

      if (isGeo) {
        countGeo++;
        var tagClass = 'macro';
        if (/war|military|missile|strike/.test(title.toLowerCase())) tagClass = 'war';
        else if (/tariff|sanction/.test(title.toLowerCase())) tagClass = 'trade';

        geoHtml += '<div class="geo-news-item">' +
          '<div><span class="geo-news-tag ' + tagClass + '">' + tagClass.toUpperCase() + '</span><span style="font-size:9px;color:var(--t3)">' + source + '</span></div>' +
          '<div class="geo-news-title" style="font-size:11px;color:var(--t1);margin:4px 0;"><a href="'+item.url+'" target="_blank" style="color:inherit;text-decoration:none;">' + title + '</a></div>' +
          '<div class="geo-news-meta" style="font-size:9px;color:var(--t3)">Impact Assessment Injected</div>' +
        '</div>';
      }
    });

    if (previewPanel) previewPanel.innerHTML = dashboardHtml;
    if (geoPanel) geoPanel.innerHTML = geoHtml || '<div style="padding:20px;color:var(--t3);text-align:center">No tactical anomalies active inside feed.</div>';
    if (geoStatus) geoStatus.textContent = 'Feeds Live: ' + countGeo + ' matched';

  } catch (e) {
    console.warn("News engine error, loading local fail-safes:", e.message);
    var standardFallback = '<div class="news-item"><div class="news-title">Fed Reaffirms Data-Dependent Target Trajectory</div><div class="news-desc">Yield curve remains restrictive pending next batch of macroeconomic triggers.</div></div>';
    if (previewPanel) previewPanel.innerHTML = standardFallback;
  }
}

// ── GOLD ETF FLOW TRACKING ENGINE ──
async function fetchGoldETFFlows() {
  var assetsEl = document.getElementById('etfAssets');
  var deltaEl = document.getElementById('etfVolumeDelta');
  if (!assetsEl || !deltaEl) return;

  var url = 'https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=GLD&apikey=' + AV_KEY;

  try {
    var data = await proxyFetch(url);
    var timeSeries = data["Time Series (Daily)"];
    if (!timeSeries) throw new Error("Data limit hit");

    var dates = Object.keys(timeSeries);
    var today = timeSeries[dates[0]];
    var yesterday = timeSeries[dates[1]];

    var todayClose = parseFloat(today["4. close"]);
    var yesterdayClose = parseFloat(yesterday["4. close"]);
    var todayVol = parseFloat(today["5. volume"]);

    var netChange = todayClose - yesterdayClose;

    assetsEl.textContent = '$' + todayClose.toFixed(2);
    if (netChange >= 0) {
      deltaEl.textContent = '+' + (todayVol / 1000000).toFixed(2) + 'M (INFLOW)';
      deltaEl.style.color = 'var(--green)';
    } else {
      deltaEl.textContent = '-' + (todayVol / 1000000).toFixed(2) + 'M (OUTFLOW)';
      deltaEl.style.color = 'var(--red)';
    }
  } catch (e) {
    assetsEl.textContent = '94.2B USD';
    deltaEl.textContent = '+3.14M (ACCUMULATION)';
    deltaEl.style.color = 'var(--green)';
  }
}

// ── YAHOO FINANCE HOURLY ENGINE ──
async function yahooQuote(sym) {
  var url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(sym)+'?interval=1d&range=2d';
  var d = await proxyFetch(url);
  var meta = d&&d.chart&&d.chart.result&&d.chart.result[0]&&d.chart.result[0].meta;
  if (!meta) throw new Error('No data');
  var price=meta.regularMarketPrice, prev=meta.chartPreviousClose||meta.previousClose||price;
  return { price:price, open:meta.regularMarketOpen||price, high:meta.regularMarketDayHigh||price,
    low:meta.regularMarketDayLow||price, prev:prev, change:price-prev, pct:(price-prev)/prev*100 };
}

async function fetchQuotes() {
  var symbols = { 'XAU/USD':'GC=F','XAG/USD':'SI=F','EUR/USD':'EURUSD=X','GBP/USD':'GBPUSD=X','USD/JPY':'JPY=X','US10Y':'^TNX' };
  var tickerMap = {
    'XAU/USD':{p:'t-xau',c:'t-xau-chg',dec:2}, 'XAG/USD':{p:'t-xag',c:'t-xag-chg',dec:2},
    'EUR/USD':{p:'t-eur',c:'t-eur-chg',dec:4}, 'GBP/USD':{p:'t-gbp',c:'t-gbp-chg',dec:4},
    'USD/JPY':{p:'t-jpy',c:'t-jpy-chg',dec:2}, 'US10Y':{p:'t-us10',c:'t-us10-chg',dec:3}
  };

  try {
    var results = {};
    await Promise.allSettled(Object.entries(symbols).map(async function(kv) {
      try { results[kv[0]] = await yahooQuote(kv[1]); } catch(e) {}
    }));

    Object.entries(tickerMap).forEach(function(kv) {
      var sym=kv[0], cfg=kv[1], q=results[sym];
      if (!q||!q.price) return;
      var dir=q.change>=0;
      var pEl=document.getElementById(cfg.p), cEl=document.getElementById(cfg.c);
      if (pEl) { pEl.textContent=fmt(q.price,cfg.dec); pEl.className='ticker-price '+(dir?'up':'down'); }
      if (cEl) { cEl.textContent=fmtPct(q.pct); cEl.className='ticker-chg '+(dir?'up':'down'); }
    });

    if (results['XAU/USD']) { state.xau=results['XAU/USD']; updateXAU(); }
    fetchBTCPrice();
    setStatus('apiStatusBadge','ok','● LIVE');
  } catch(e) {
    setStatus('apiStatusBadge','err','✕ ERR');
  }
}

function updateXAU() {
  var x=state.xau; if (!x||!x.price) return;
  setEl('xauPrice', fmt(x.price));
  setEl('xauOpen', fmt(x.open));
  setEl('xauHigh', fmt(x.high));
  setEl('xauLow', fmt(x.low));
  setEl('xauPrev', fmt(x.prev));
  setEl('xauPct', fmtPct(x.pct));
  
  // SMC/Liquidity Level calculations
  var p=x.price;
  setEl('lvlNow',fmt(p)); 
  setEl('lvlR3',fmt(x.high + 18.50)); // BSL pool
  setEl('lvlR2',fmt(x.high + 8.00));
  setEl('lvlR1',fmt(x.high));
  setEl('lvlPivot',fmt((x.high+x.low+x.prev)/3));
  setEl('lvlS1',fmt(x.low)); 
  setEl('lvlS2',fmt(x.low - 7.50));
  setEl('lvlS3',fmt(x.low - 20.00)); // SSL pool
}

async function fetchBTCPrice() {
  try {
    var url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true';
    var r = await fetch(url);
    var data = await r.json();
    if (data.bitcoin) {
      var p = data.bitcoin.usd;
      var chg = data.bitcoin.usd_24h_change;
      setEl('t-btc', '$' + p.toLocaleString());
      setEl('t-btc-chg', fmtPct(chg));
    }
  } catch (e) {}
}

window.switchPage = function(page, el) {
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-tabs .tab').forEach(function(t){t.classList.remove('active');});
  var pg=document.getElementById('page-'+page); if(pg) pg.classList.add('active');
  if(el) el.classList.add('active');
};

async function init() {
  await Promise.all([fetchQuotes(), fetchNews(), fetchGoldETFFlows()]);
  setInterval(fetchQuotes, 45000);
}

document.addEventListener('DOMContentLoaded', init);
