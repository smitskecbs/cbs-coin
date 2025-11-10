export default async function handler(req, res) {
  const { mint = 'B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk' } = req.query;
  const key = process.env.HELIUS_KEY;
  const url = `https://api.helius.xyz/v0/token-holders?api-key=${key}&mint=${mint}`;

  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return res.status(r.status).json({ error: 'Helius error' });

    const data = await r.json();
    const holders = Array.isArray(data)
      ? data.filter(h => (h.amount || h.uiAmount || 0) > 0).length
      : 0;

    res.status(200).json({ holders });
  } catch (e) {
    res.status(500).json({ error: 'proxy_failed' });
  }
}
