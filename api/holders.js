// api/holders.js
// Proxy via Vercel → Helius token holders endpoint

export default async function handler(req, res) {
  const mint = 'B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk';
  const HELIUS_KEY = 'a9a11d45-2d40-4da0-a3b6-557b855f1e5c';

  const url = `https://api.helius.xyz/v0/tokens/${mint}/holders?limit=1`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'x-api-key': HELIUS_KEY
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: true,
        status: response.status,
        message: response.statusText,
        data
      });
    }

    // Helius geeft o.a. een "total" veld terug met het aantal holders
    const total = data?.total ?? null;

    return res.status(200).json({
      ok: true,
      total
    });
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'Unknown error while calling Helius'
    });
  }
}
