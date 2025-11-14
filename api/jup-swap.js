// /api/jup-swap.js
// Vraagt swap-transactie aan bij Jupiter Swap API en geeft base64 TX terug

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: true, message: "Method not allowed" });
    return;
  }

  try {
    const { quoteResponse, userPublicKey } = req.body || {};

    if (!quoteResponse || !userPublicKey) {
      res.status(400).json({
        error: true,
        message: "Missing quoteResponse or userPublicKey",
      });
      return;
    }

    const jupRes = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
      }),
    });

    const data = await jupRes.json();

    if (!jupRes.ok) {
      res.status(jupRes.status).json({
        error: true,
        message: data.error || "Swap API error",
        data,
      });
      return;
    }

    // data bevat o.a. { swapTransaction, lastValidBlockHeight, ... }
    res.status(200).json({ error: false, data });
  } catch (err) {
    console.error("[jup-swap] error", err);
    res.status(500).json({ error: true, message: err.message || "Server error" });
  }
}
