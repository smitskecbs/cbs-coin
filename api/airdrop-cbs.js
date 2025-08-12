// api/airdrop-cbs.js  (Vercel Node.js runtime, ESM)

import { Connection, Keypair, PublicKey, clusterApiUrl, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, createTransferCheckedInstruction } from "@solana/spl-token";
import bs58 from "bs58";

const ALLOW_ORIGIN = "https://smitskecbs.github.io"; // tijdens testen mag "*"
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  // Handige ping: hiermee kun je in de browser zien dat de route leeft (geen 500 meer)
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "airdrop-cbs" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST toegestaan" });
  }

  try {
    const { buyer, message, signatureBase64 } = req.body || {};
    if (!buyer)           return res.status(400).json({ error: "buyer ontbreekt" });
    if (!message)         return res.status(400).json({ error: "message ontbreekt" });
    if (!signatureBase64) return res.status(400).json({ error: "signatureBase64 ontbreekt" });

    if (!process.env.PRIVATE_KEY) {
      return res.status(500).json({ error: "Server misconfiguratie: PRIVATE_KEY ontbreekt" });
    }

    // RPC kiezen (optioneel Helius, anders Solana endpoint)
    const rpcUrl = process.env.RPC_URL || clusterApiUrl("mainnet-beta");
    const connection = new Connection(rpcUrl, "confirmed");

    // Airdrop wallet
    let sender;
    try {
      // verwacht base58 private key (bv. uit Phantom export)
      const secret = bs58.decode(process.env.PRIVATE_KEY);
      sender = Keypair.fromSecretKey(secret);
    } catch (e) {
      return res.status(500).json({ error: "PRIVATE_KEY ongeldig (verwacht base58)" });
    }

    const mint = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk"); // CBS
    const buyerPubkey = new PublicKey(buyer);

    // (optioneel) anti-replay check van je message/signature hier…

    // Associated Token Accounts
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(connection, sender, mint, sender.publicKey);
    const toTokenAccount   = await getOrCreateAssociatedTokenAccount(connection, sender, mint, buyerPubkey);

    // 250 CBS met 9 decimals
    const amount = 250n * 10n ** 9n; // BigInt: 250 * 10^9

    const ix = createTransferCheckedInstruction(
      fromTokenAccount.address,
      mint,
      toTokenAccount.address,
      sender.publicKey,
      amount, // BigInt ok
      9
    );

    const tx = new Transaction().add(ix);
    const signature = await sendAndConfirmTransaction(connection, tx, [sender]);

    return res.status(200).json({ success: true, txid: signature });
  } catch (err) {
    // Log zoveel mogelijk door naar Vercel logs
    console.error("airdrop-cbs error:", err);
    return res.status(500).json({ error: "Transactie mislukt", details: String(err?.message || err) });
  }
}
