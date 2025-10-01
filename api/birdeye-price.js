export default async function handler(req, res) {
  // CORS (handig voor testen)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'Missing address' });

  try {
    const r = await fetch(
      `https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(address)}&chain=solana`,
      {
        headers: {
          accept: 'application/json',
          'X-API-KEY': process.env.BIRDEYE_KEY, // ✅ key staat server-side
          'x-chain': 'solana',
        },
      }
    );

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Birdeye upstream error', detail: txt });
    }

    const j = await r.json();
    const raw = j?.data?.value ?? j?.data?.price ?? j?.data?.priceUsd ?? j?.price ?? j?.value;
    const price = typeof raw === 'number' ? raw : Number(raw);
    return res.status(200).json({ price: Number.isFinite(price) ? price : null, source: 'Birdeye' });
  } catch (e) {
    return res.status(500).json({ error: 'Proxy failure', detail: String(e) });
  }
}
