// api/airdrop-cbs.js

import {
  createTransferCheckedInstruction,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";

import nacl from "tweetnacl";
import bs58 from "bs58";

// ====== Config ======
const MINT = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk"); // CBS
const DECIMALS = 9;
const AIRDROP_AMOUNT_CBS = 250; // <-- 250 CBS
const AMOUNT_RAW = AIRDROP_AMOUNT_CBS * 10 ** DECIMALS;
const MESSAGE_PREFIX = "CBS_AIRDROP_250:";

// Gebruik Helius als je wilt, anders valt 'ie terug op mainnet-beta
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

// Private key van je airdrop-/creator-wallet (base58, die de CBS-tokens bezit)
const SENDER_SECRET = process.env.PRIVATE_KEY;

// Simpele (niet-persistente) “al geclaimd”-cache
// Let op: verdwijnt bij cold start/redeploy. Voor blijvende opslag: Vercel KV/Upstash gebruiken.
const claimed = new Set();

// ====== Helpers ======
function b64ToU8(b64) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function verifySignedMessage(buyerStr, message, signatureBase64) {
  // Verwacht format: "CBS_AIRDROP_250:<buyer>:<timestamp>"
  if (!message || !message.startsWith(MESSAGE_PREFIX)) {
    return { ok: false, reason: "invalid_message_format" };
  }
  const parts = message.split(":");
  // ["CBS_AIRDROP_250", <buyer>, <timestamp>]
  if (parts.length !== 3) return { ok: false, reason: "invalid_message_parts" };

  const buyerInMsg = parts[1];
  const tsStr = parts[2];
  if (buyerInMsg !== buyerStr) return { ok: false, reason: "buyer_mismatch" };

  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid_timestamp" };

  // 10 minuten geldigheid om replay te beperken
  const MAX_AGE_MS = 10 * 60 * 1000;
  if (Date.now() - ts > MAX_AGE_MS) return { ok: false, reason: "message_expired" };

  // Handtekening verifiëren (Ed25519)
  const msgBytes = new TextEncoder().encode(message);
  const sig = b64ToU8(signatureBase64);

  try {
    const buyerPk = new PublicKey(buyerStr);
    const ok = nacl.sign.detached.verify(msgBytes, sig, buyerPk.toBytes());
    return ok ? { ok: true } : { ok: false, reason: "invalid_signature" };
  } catch {
    return { ok: false, reason: "verify_exception" };
  }
}

// ====== Handler ======
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST toegestaan" });
  }

  try {
    const { buyer, message, signatureBase64 } = req.body || {};
    if (!buyer || !message || !signatureBase64) {
      return res.status(400).json({ error: "buyer, message en signatureBase64 zijn verplicht" });
    }

    if (!SENDER_SECRET) {
      return res.status(500).json({ error: "Server misconfiguratie: PRIVATE_KEY ontbreekt" });
    }

    // 1) Verify signed message
    const v = verifySignedMessage(buyer, message, signatureBase64);
    if (!v.ok) {
      return res.status(400).json({ error: "signature_invalid", reason: v.reason });
    }

    // 2) Eén keer per wallet (in-memory)
    if (claimed.has(buyer)) {
      return res.status(409).send("already_claimed");
    }

    // 3) Blockchain acties
    const connection = new Connection(RPC_URL, "confirmed");
    const sender = Keypair.fromSecretKey(bs58.decode(SENDER_SECRET));
    const buyerPk = new PublicKey(buyer);

    // Zorg dat beide token accounts bestaan
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection, sender, MINT, sender.publicKey
    );
    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection, sender, MINT, buyerPk
    );

    // Bouw transfer
    const ix = createTransferCheckedInstruction(
      fromTokenAccount.address,
      MINT,
      toTokenAccount.address,
      sender.publicKey,
      AMOUNT_RAW,
      DECIMALS
    );

    const tx = new Transaction().add(ix);
    tx.feePayer = sender.publicKey;

    const sig = await connection.sendTransaction(tx, [sender]);
    await connection.confirmTransaction(sig, "confirmed");

    // Markeer als geclaimd (tijdelijk, verdwijnt bij redeploy)
    claimed.add(buyer);

    return res.status(200).json({ ok: true, txid: sig });
  } catch (err) {
    console.error("Airdrop-fout:", err);
    return res.status(500).json({ error: "Transactie mislukt", details: err?.message || String(err) });
  }
}

