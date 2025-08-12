// api/airdrop-cbs.js
// Vercel Node.js function (ESM)

export const config = { runtime: "nodejs18.x" };

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

const ALLOW_ORIGIN = "https://smitskecbs.github.io"; // jouw site
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(204).end();

    if (req.method === "GET") {
      return res.status(200).json({ ok: true, route: "airdrop-cbs" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Alleen POST toegestaan" });
    }

    const { buyer, message, signatureBase64 } = req.body || {};
    if (!buyer) return res.status(400).json({ error: "buyer ontbreekt" });
    if (!message) return res.status(400).json({ error: "message ontbreekt" });
    if (!signatureBase64) return res.status(400).json({ error: "signatureBase64 ontbreekt" });

    if (!process.env.PRIVATE_KEY) {
      console.error("ENV PRIVATE_KEY ontbreekt");
      return res.status(500).json({ error: "Server misconfiguratie (PRIVATE_KEY)" });
    }

    // RPC
    const rpcUrl = process.env.RPC_URL || clusterApiUrl("mainnet-beta");
    const connection = new Connection(rpcUrl, "confirmed");

    // Wallet
    let sender;
    try {
      const secret = bs58.decode(process.env.PRIVATE_KEY.trim());
      sender = Keypair.fromSecretKey(secret);
    } catch (e) {
      console.error("PRIVATE_KEY decode error:", e);
      return res.status(500).json({ error: "PRIVATE_KEY ongeldig (verwacht base58)" });
    }

    console.log("Sender pubkey:", sender.publicKey.toBase58());

    // Check SOL balance (handig voor 500's)
    const balLamports = await connection.getBalance(sender.publicKey);
    console.log("Sender balance (lamports):", balLamports);
    if (balLamports < 2000000) { // ~0.002 SOL minimum voor ATA + fee
      return res.status(500).json({ error: "Onvoldoende SOL in airdrop wallet" });
    }

    const mint = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk");
    const buyerPubkey = new PublicKey(buyer);

    // --- (optioneel) sign/verificatie anti-replay ---
    // Hier zou je message + signatureBase64 kunnen verifiëren.
    // Voor nu laten we dat achterwege.

    // Token accounts
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection, sender, mint, sender.publicKey
    );
    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection, sender, mint, buyerPubkey
    );

    // 250 CBS (9 decimals) → bigint
    const amount = 250n * 10n ** 9n;

    const ix = createTransferCheckedInstruction(
      fromTokenAccount.address,
      mint,
      toTokenAccount.address,
      sender.publicKey,
      amount,
      9
    );

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [sender]);

    console.log("Airdrop OK:", sig);
    return res.status(200).json({ success: true, txid: sig });
  } catch (err) {
    console.error("airdrop-cbs UNCAUGHT:", err);
    const msg = typeof err?.message === "string" ? err.message : String(err);
    return res.status(500).json({ error: "Transactie mislukt", details: msg });
  }
}
