export default async function handler(req, res) {
  const apiKey = process.env.BIRDEYE_KEY; // haalt key veilig uit Vercel

  try {
    const response = await fetch(
      "https://public-api.birdeye.so/public/tokenlist?chain=solana",
      {
        headers: {
          accept: "application/json",
          "x-chain": "solana",
          "X-API-KEY": apiKey,efbead31f6db4087a18841c3bf32d0c6
        },
      }
    );

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
