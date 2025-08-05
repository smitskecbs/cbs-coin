export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    // ... hier je bestaande CBS-verstuur-code ...
    res.status(200).json({ success: true });
  } catch (e) {
    console.error("Fout bij koopCBS:", e);
    res.status(500).json({ error: e.message });
  }
}

    console.error("❌ Fout bij koopCBS:", err);
    return res.status(500).json({ error: err.message || "Onbekende fout" });
  }
};
