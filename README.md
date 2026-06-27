# DFXAi Terminal

**Professional XAU/USD Trading Terminal** — Web-based gold trading dashboard with live market data, AI-powered analysis, and real-time signals.

🌐 **Live:** [dfxterminal.vercel.app](https://dfxterminal.vercel.app)

---

## Features

### 📊 Dashboard
- Live XAU/USD price with real-time updates every 60 seconds
- Key technical indicators: RSI (14), EMA 20/50, ATR (14)
- Support & resistance levels
- DXY mini chart and trend indicator
- Latest market news feed

### 📈 Charts
- **XAU/USD** 1H chart with technical stats (Price, Change, RSI, Signal)
- **DXY** 1H chart with gold impact indicator
- **BTC/USD** 1H chart via CoinGecko (Price, Change, RSI, Signal)
- Switchable timeframes: 1min, 5min, 15min, 30min, 1H, 4H, 1D

### ⚡ Signals
- Auto-generated XAU/USD trading signals with Entry Zone, SL, TP1, TP2, R:R Ratio
- Signal confidence scoring based on RSI + EMA crossover
- **Signal History** — persistent localStorage storage (up to 100 signals)
- **Win Rate Tracker** — track TP1/TP2/SL results with performance stats
- Long Win% and Short Win% breakdown
- Manual signal entry support

### 📉 COT Data
- Commitments of Traders positioning for gold

### 📅 Economic Calendar
- Live economic calendar embed (investing.com)
- **Fed Rate Cut Probability** — CME FedWatch data with probability bars per meeting
- **Recent High-Impact Releases** — NFP, CPI, PCE, FOMC, GDP, Retail Sales with Beat/Miss + Gold impact

### 🌍 Sentiment
- Market sentiment indicators
- DXY trend vs Gold correlation

### 🗺️ Geopolitical
- **Live Geopolitical News Feed** — 10 RSS sources (Reuters, BBC, Al Jazeera, NYT, FT, Guardian, Sky News, and more)
- Auto-refresh every 10 minutes
- News categorized by tag: WAR / TRADE / ENERGY / MACRO
- Automated Gold impact assessment per headline
- **AI Geopolitical Analysis** — Groq-powered summary of current risks
- Risk Matrix with regional breakdown
- Central Bank Gold Buying chart

### 📺 Live TV
- Embedded live financial news stream

### 🤖 AI Analysis
- Powered by **Groq** (`llama-3.3-70b-versatile`) — fast LPU inference
- Real-time market data injected into prompt (price, RSI, EMA, DXY, ATR)
- 5-point structured analysis: Bias, Key Levels, Entry, Risk, Outlook

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (single-page app) |
| Charts | Chart.js 4.4 |
| Auth | Supabase |
| AI | Groq API (`llama-3.3-70b-versatile`) |
| Market Data | Yahoo Finance (via CORS proxy), CoinGecko |
| DXY Data | Yahoo Finance `DX-Y.NYB` (multi-proxy fallback) |
| News | RSS feeds via allorigins.win + corsproxy.io |
| Deployment | Vercel |

---

## Project Structure

```
dfxterminal/
├── index.html      # Main SPA — all pages/tabs
├── app.js          # Core logic: data fetching, charts, signals, AI
├── auth.js         # Supabase authentication
└── style.css       # Dark terminal theme
```

---

## Setup & Deployment

### 1. Clone the repo
```bash
git clone https://github.com/damarfm/dfxterminal.git
cd dfxterminal
```

### 2. Configure Supabase (optional — for auth)
In `auth.js`, update:
```js
var SUPA_URL  = 'your-supabase-url';
var SUPA_ANON = 'your-supabase-anon-key';
```

### 3. Deploy to Vercel
```bash
npm i -g vercel
vercel --prod
```

Or connect the repo directly to [vercel.com](https://vercel.com) for automatic deployments on every push.

### 4. Set Groq API Key (in-app)
1. Get a free key at [console.groq.com](https://console.groq.com)
2. Open the **AI Analysis** tab in the terminal
3. Paste your `gsk_...` key and click **ACTIVATE**
4. Key is stored locally in the browser — never sent to any server

---

## API Keys

| Service | Required | Notes |
|---|---|---|
| Groq | ✅ For AI Analysis | Free — 14,400 req/day. Set in-app. |
| Supabase | ✅ For Auth | Free tier sufficient |
| Yahoo Finance | ❌ | Public API, no key needed |
| CoinGecko | ❌ | Public API, no key needed |

---

## Screenshots

| Dashboard | Charts |
|---|---|
| Live XAU/USD price + indicators | XAU, DXY, BTC charts with stats |

| Signals | Geopolitical |
|---|---|
| Auto signal with history & winrate | Live news feed + AI analysis |

---

## Roadmap

- [ ] WebSocket live price feed (replace polling)
- [ ] Email/Telegram alert on signal generation
- [ ] Backtesting module for signal accuracy
- [ ] Multi-asset support (XAG, CRUDE, S&P500)
- [ ] Mobile-optimized layout

---

## Author

**Damar** — [@damarfm](https://linkedin.com/in/damarfm)

Built as a personal trading terminal for XAU/USD analysis.

---

## License

MIT License — free to use, modify, and deploy.
