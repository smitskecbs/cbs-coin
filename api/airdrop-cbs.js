// /api/airdrop-cbs.js  — Node serverless (ontvanger betaalt fee)

// CORS: sta jouw sites toe
const ALLOW_ORIGINS = [
  "https://smitskecbs.github.io",
  "https://cbs-coin.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function cors(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors(origin));
    return res.end();
  }
  if (req.method !== "POST") {
    res.writeHead(405, cors(origin));
    return res.end("Method Not Allowed");
  }

  try {
    // === Imports (dynamic zodat het in Vercel Node werkt) ===
    const { Connection, PublicKey, Transaction, ComputeBudgetProgram, Keypair } =
      await import("@solana/web3.js");
    const {
      getAssociatedTokenAddress,
      createAssociatedTokenAccountInstruction,
      createTransferCheckedInstruction,
      getMint
    } = await import("@solana/spl-token");
    const { default: nacl } = await import("tweetnacl");
    const { default: bs58 } = await import("bs58");

    // === ENV ===
    const HELIUS_KEY       = process.env.HELIUS_KEY;
    const PRIVATE_KEY      = process.env.PRIVATE_KEY;        // base58 of JSON array
    const AIRDROP_MINT     = process.env.AIRDROP_MINT || "B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk";
    const AIRDROP_TREASURY = process.env.AIRDROP_TREASURY;   // pubkey die bron-ATA bezit
    const AIRDROP_AMOUNT   = Number(process.env.AIRDROP_AMOUNT ?? 250); // in UI-eenheden (bv. 250 CBS)

    if (!HELIUS_KEY || !PRIVATE_KEY || !AIRDROP_MINT || !AIRDROP_TREASURY) {
      res.writeHead(500, { ...cors(origin), "content-type": "text/plain" });
      return res.end("Missing env vars (HELIUS_KEY / PRIVATE_KEY / AIRDROP_MINT / AIRDROP_TREASURY)");
    }

    const RPC = `https://rpc.helius.xyz/?api-key=${HELIUS_KEY}`;
    const conn = new Connection(RPC, "confirmed");

    // === Body ===
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const buyerBase58 = body?.buyer;
    const message = body?.message || "";
    const signatureBase64 = body?.signatureBase64 || "";

    // Minimale anti-bot check: verify signed message
    const okFormat = typeof message === "string" && message.startsWith(`CBS_AIRDROP_${AIRDROP_AMOUNT}:`);
    if (!okFormat) {
      res.writeHead(400, { ...cors(origin), "content-type": "text/plain" });
      return res.end("Bad message format");
    }
    try {
      const sig = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
      const msg = new TextEncoder().encode(message);
      const pub = bs58.decode(buyerBase58);
      const verified = nacl.sign.detached.verify(msg, sig, pub);
      if (!verified) throw new Error("Signature invalid");
    } catch (e) {
      res.writeHead(400, { ...cors(origin), "content-type": "text/plain" });
      return res.end("Signature verification failed");
    }

    const recipient = new PublicKey(buyerBase58);
    const MINT = new PublicKey(AIRDROP_MINT);
    const TREASURY_OWNER = new PublicKey(AIRDROP_TREASURY);

    // Decode jouw secret
    let secretKey;
    if (PRIVATE_KEY.trim().startsWith("[")) {
      secretKey = Uint8Array.from(JSON.parse(PRIVATE_KEY));
    } else {
      secretKey = bs58.decode(PRIVATE_KEY.trim());
    }
    const owner = Keypair.fromSecretKey(secretKey); // tekent voor bron-ATA

    // Mint info (decimals)
    const mintInfo = await getMint(conn, MINT);
    const decimals = mintInfo.decimals;
    const amountU64 = BigInt(Math.round(AIRDROP_AMOUNT * 10 ** decimals));

    // Afgeleide ATA's
    const srcAta = await getAssociatedTokenAddress(MINT, TREASURY_OWNER, true);
    const dstAta = await getAssociatedTokenAddress(MINT, recipient, true);

    const ixs = [];

    // Maak ontvanger-ATA indien nodig (payer = ontvanger → ontvanger betaalt rent)
    const dstInfo = await conn.getAccountInfo(dstAta);
    if (!dstInfo) {
      ixs.push(
        createAssociatedTokenAccountInstruction(
          recipient,  // payer (ondertekent aan clientzijde)
          dstAta,
          recipient,  // owner
          MINT
        )
      );
    }

    // Transfer vanuit jouw treasury → ontvanger
    ixs.push(
      createTransferCheckedInstruction(
        srcAta,          // bron ATA
        MINT,
        dstAta,
        TREASURY_OWNER,  // owner van bron-ATA (jij)
        Number(amountU64),
        decimals
      )
    );

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");

    const tx = new Transaction().add(
      // optioneel: kleine priority fee
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      ...ixs
    );

    // >>>>>>> Belangrijk: ONTVANGER betaalt fee
    tx.feePayer = recipient;
    tx.recentBlockhash = blockhash;

    // Jij tekent als owner van bron-ATA; ontvanger tekent als feePayer
    tx.partialSign(owner);

    const serialized = tx.serialize({ requireAllSignatures: false }); // alleen jouw handtekening aanwezig
    const b64 = Buffer.from(serialized).toString("base64");

    res.writeHead(200, { ...cors(origin), "content-type": "application/json" });
    return res.end(JSON.stringify({ tx: b64, blockhash, lastValidBlockHeight }));
  } catch (e) {
    res.writeHead(500, { ...cors(req.headers.origin || ""), "content-type": "text/plain" });
    return res.end(`error: ${e?.message || e}`);
  }
}

