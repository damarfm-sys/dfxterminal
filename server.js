// Local proxy for development - simple fetch passthrough
// Usage: GET /fetch?url=<encoded url>

const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/fetch', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('url required');
  try {
    console.log('[proxy] fetching:', url);
    const r = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': '*/*', 'Referer': 'https://www.cmegroup.com/' } });
    const contentType = r.headers.get('content-type') || 'application/octet-stream';
    console.log('[proxy] status:', r.status, 'content-type:', contentType);
    res.set('Content-Type', contentType);
    res.status(r.status);
    const buffer = Buffer.from(await r.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('[proxy] error fetching:', err && err.message || err);
    res.status(502).send(String(err.message || err));
  }
});

app.listen(PORT, () => console.log('Local proxy running on http://localhost:' + PORT));
