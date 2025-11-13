// api/holders.js
export default async function handler(req, res) {
  const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
  const MINT = "B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk";

  if (!HELIUS_API_KEY) {
    return res.status(500).json({
      error: true,
      status: 500,
      message: "Missing HELIUS_API_KEY in environment",
    });
  }

  const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

  try {
    let page = 1;
    const limit = 1000;
    const owners = new Set();

    while (true) {
      const body = {
        jsonrpc: "2.0",
        id: "cbs-holders",
        method: "getTokenAccounts",   // **DE JUISTE METHODE**
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

      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({
          error: true,
          status: response.status,
          message: `Helius HTTP ${response.status}`,
          data: text,
        });
      }

      const json = await response.json();
      const accounts = json?.result?.token_accounts || [];

      // Geen resultaten meer → klaar
      if (!accounts.length) break;

      // Elke owner met amount > 0 toevoegen
      for (const acc of accounts) {
        const amount = Number(acc.amount ?? 0);
        if (amount > 0 && acc.owner) {
          owners.add(acc.owner);
        }
      }

      page += 1;

      // Veiligheidsrem: niet oneindig loopen
      if (page > 50) break;
    }

    return res.status(200).json({
      error: false,
      status: 200,
      holders: owners.size,
    });
  } catch (e) {
    console.error("[CBS holders] error:", e);
    return res.status(500).json({
      error: true,
      status: 500,
      message: e?.message || "Internal error while fetching holders",
    });
  }
}
