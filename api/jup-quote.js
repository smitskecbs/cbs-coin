export default async function handler(req, res) {
  // Zorg dat GitHub Pages dit endpoint mag aanroepen
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { amount } = req.query;

    if (!amount) {
      return res.status(400).json({
        error: true,
        message: "Missing 'amount' query param (lamports)",
      });
    }

    // SOL en CBS mints
    const SOL_MINT =
      "So11111111111111111111111111111111111111112";
    const CBS_MINT =
      "B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk";

    const url =
      `https://quote-api.jup.ag/v6/quote` +
      `?inputMint=${SOL_MINT}` +
      `&outputMint=${CBS_MINT}` +
      `&amount=${amount}` +
      `&slippageBps=50` +
      `&swapMode=ExactIn`;

    const jRes = await fetch(url, {
      headers: { accept: "application/json" },
    });

    if (!jRes.ok) {
      const text = await jRes.text();
      return res.status(jRes.status).json({
        error: true,
        message: "Jupiter error",
        details: text,
      });
    }

    const data = await jRes.json();
    const route = data?.data?.[0];

    if (!route) {
      return res.status(200).json({
        error: true,
        message: "No route found",
      });
    }

    // We geven alleen terug wat we nodig hebben op de site
    return res.status(200).json({
      error: false,
      data: {
        inAmount: route.inAmount,
        outAmount: route.outAmount,
        inputMint: route.inputMint,
        outputMint: route.outputMint,
        priceImpactPct: route.priceImpactPct,
      },
    });
  } catch (e) {
    console.error("Jup quote error:", e);
    return res.status(500).json({
      error: true,
      message: e?.message || "fetch failed",
    });
  }
}
