// api/holders.js
// CBS holder counter via Helius + CORS voor GitHub Pages

export default async function handler(req, res) {
  // ===== CORS HEADERS =====
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight voor browsers
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({
      error: true,
      status: 405,
      message: "Method not allowed",
    });
    return;
  }

  // ===== CONFIG =====
  const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
  const MINT = "B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk";
  const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

  if (!HELIUS_API_KEY) {
    return res.status(500).json({
      error: true,
      status: 500,
      message: "Missing HELIUS_API_KEY in environment",
    });
  }

  try {
    let page = 1;
    const limit = 1000;
    const owners = new Set();

    // We loopen door de pagina's met token accounts
    while (true) {
      const body = {
        jsonrpc: "2.0",
        id: "cbs-holders",
        method: "getTokenAccounts",
        params: {
          page,
          limit,
          mint: MINT,
        },
      };

      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          error: true,
          status: response.status,
          message: `Helius HTTP ${response.status}`,
          data,
        });
      }

      const accounts = data?.result?.token_accounts || [];
      if (!accounts.length) break; // geen accounts meer → klaar

      for (const acc of accounts) {
        const amount = Number(acc.amount ?? 0);
        if (amount > 0 && acc.owner) {
          owners.add(acc.owner);
        }
      }

      page += 1;
      if (page > 50) break; // safety limit
    }

    return res.status(200).json({
      error: false,
      status: 200,
      holders: owners.size,
    });
  } catch (e) {
    console.error("[CBS holders] API error:", e);
    return res.status(500).json({
      error: true,
      status: 500,
      message: e?.message || "Internal error while fetching holders",
    });
  }
}
