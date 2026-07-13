// Serverless function acting as proxy for Vercel production
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const url = req.query.url;
  if (!url) {
    return res.status(400).send('url required');
  }

  try {
    console.log('[vercel-proxy] fetching:', url);
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Referer': 'https://www.cmegroup.com/'
      }
    });

    const contentType = r.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.status(r.status);

    const arrayBuffer = await r.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (err) {
    console.error('[vercel-proxy] error:', err);
    res.status(502).send(err.message || String(err));
  }
}
