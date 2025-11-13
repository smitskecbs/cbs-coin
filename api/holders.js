export default async function handler(req, res) {
  const mint = 'B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk';
  const apiKey = 'efbead31f6db4087a18841c3bf32d0c6';

  try {
    const result = await fetch(
      `https://public-api.birdeye.so/defi/token_overview?address=${mint}`,
      {
        headers: {
          'accept': 'application/json',
          'X-API-KEY': apiKey,
          'x-chain': 'solana'
        }
      }
    );

    const data = await result.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
