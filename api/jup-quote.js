// /api/jup-quote.js
// Proxy naar Jupiter Quote API met CORS open voor GitHub Pages

export default async function handler(req, res) {
  // CORS headers zodat smitskecbs.github.io mag callen
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: true, message: "Method not allowed" });
    return;
  }

  try {
    const { inputMint, outputMint, amount, slippageBps } = req.query;

    if (!inputMint || !outputMint || !amount) {
      res.status(400).json({
        error: true,
        message: "Missing inputMint, outputMint or amount",
      });
      return;
    }

    const url = new URL("https://quote-api.jup.ag/v6/quote");
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", amount);        // integer als string
    url.searchParams.set("slippageBps", slippageBps || "100"); // 1% slippage

    const jupRes = await fetch(url.toString());
    const data = await jupRes.json();

    if (!jupRes.ok) {
      res.status(jupRes.status).json({
        error: true,
        message: data.error || "Quote API error",
        data,
      });
      return;
    }

    res.status(200).json({ error: false, data });
  } catch (err) {
    console.error("[jup-quote] error", err);
    res.status(500).json({ error: true, message: err.message || "Server error" });
  }
}
