// api/airdrop-cbs.js  (Node.js serverless, ESM)
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";

// CORS
const ALLOW_ORIGIN = "https://smitskecbs.github.io";
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

// simpele memory-limiter (reset bij cold start)
if (!globalThis.__claimedSet) globalThis.__claimedSet = new Set();

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  // Health-check
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "airdrop-cbs" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST toegestaan" });
  }

  try {
    const { buyer } = req.body || {};
    if (!buyer) return res.status(400).json({ error: "buyer ontbreekt" });

    // 1× per wallet (in-memory)
    if (globalThis.__claimedSet.has(buyer)) {
      return res.status(409).json({ error: "already_claimed" });
    }

    if (!process.env.PRIVATE_KEY) {
      return res.status(500).json({ error: "Server misconfiguratie: PRIVATE_KEY ontbreekt" });
    }

    // RPC (optioneel Helius via env)
    const rpcUrl = process.env.RPC_URL || clusterApiUrl("mainnet-beta");
    const connection = new Connection(rpcUrl, "confirmed");

    // Airdrop-wallet
    let sender;
    try {
      const secret = bs58.decode(process.env.PRIVATE_KEY);   // base58 secret
      sender = Keypair.fromSecretKey(secret);
    } catch {
      return res.status(500).json({ error: "PRIVATE_KEY ongeldig (verwacht base58)" });
    }

    const mint = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk");
    const buyerPubkey = new PublicKey(buyer);

    // Associated Token Accounts
    const fromATA = await getOrCreateAssociatedTokenAccount(connection, sender, mint, sender.publicKey);
    const toATA   = await getOrCreateAssociatedTokenAccount(connection, sender, mint, buyerPubkey);

    // 250 CBS (9 decimals) met BigInt
    const amount = 250n * 10n ** 9n;

    const ix = createTransferCheckedInstruction(
      fromATA.address,
      mint,
      toATA.address,
      sender.publicKey,
      amount,
      9
    );

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [sender]);

    // markeer als geclaimd
    globalThis.__claimedSet.add(buyer);

    return res.status(200).json({ success: true, txid: sig });
  } catch (err) {
    console.error("airdrop-cbs error:", err);
    return res.status(500).json({ error: "Transactie mislukt", details: String(err?.message || err) });
  }
}
