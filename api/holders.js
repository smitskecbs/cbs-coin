// /api/holders.js
export default async function handler(req, res) { 
  // Optioneel: simpele CORS zodat je vanuit je site kunt fetchen
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.BIRDEYE_KEY;
  const mint  = process.env.CBS_MINT || 'B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk';

  if (!apiKey) return res.status(500).json({ error: 'Missing BIRDEYE_KEY' });
  if (!mint)  return res.status(500).json({ error: 'Missing CBS_MINT' });

  try {
    // Birdeye: haal holders op voor één token
    // NB: sommige tenants hebben /defi/token_holders, anderen /public/token_holders.
    // Deze werkt meestal:
    const url = `https://public-api.birdeye.so/defi/token_holders?address=${mint}&limit=1&offset=0`;

    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'x-chain': 'solana',
        'X-API-KEY': apiKey,   // <-- alleen de variabele, niets erachter!
      },
      // Vercel Node runt fetch standaard met keepalive
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return res.status(response.status).json({ error: 'Birdeye error', body: text });
    }

    const json = await response.json();

    // Probeer het totale aantal holders robuust uit de response te lezen
    const total =
      json?.data?.total ??
      json?.data?.count ??
      json?.data?.holders ??
      null;

    return res.status(200).json({
      mint,
      totalHolders: total,
      raw: json, // handig voor debug; kun je later weghalen
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
