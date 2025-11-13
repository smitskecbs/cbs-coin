// api/holders.js

export default async function handler(req, res) {
  const mint  = 'B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk';
  const apiKey = 'efbead31f6db4087a18841c3bf32d0c6';

  try {
    const response = await fetch(
      `https://public-api.birdeye.so/defi/token_overview?address=${mint}`,
      {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'X-API-KEY': apiKey,
          'x-chain': 'solana'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      // Geef Birdeye-fout door aan de browser
      return res.status(response.status).json({
        error: true,
        status: response.status,
        message: response.statusText,
        data
      });
    }

    // Succes: stuur gewoon Birdeye data door
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: true,
      message: err.message || 'Unknown error while calling Birdeye'
    });
  }
}
