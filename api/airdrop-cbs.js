// api/airdrop-cbs.js  (Vercel Node.js runtime, ESM)

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
import { kv } from "@vercel/kv"; // ✅ Vercel KV voor 1x-per-wallet

const ALLOW_ORIGIN = "https://smitskecbs.github.io"; // tijdens testen mag "*"
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

function assertKvConfigured() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error(
      "Vercel KV niet geconfigureerd (KV_REST_API_URL / KV_REST_API_TOKEN ontbreken)."
    );
  }
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  // Simpele health-check
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, route: "airdrop-cbs" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST toegestaan" });
  }

  try {
    // --- input ---
    const { buyer, message, signatureBase64 } = req.body || {};
    if (!buyer) return res.status(400).json({ error: "buyer ontbreekt" });
    if (!message) return res.status(400).json({ error: "message ontbreekt" });
    if (!signatureBase64) return res.status(400).json({ error: "signatureBase64 ontbreekt" });

    if (!process.env.PRIVATE_KEY) {
      return res
        .status(500)
        .json({ error: "Server misconfiguratie: PRIVATE_KEY ontbreekt" });
    }

    // --- RPC ---
    const rpcUrl = process.env.RPC_URL || clusterApiUrl("mainnet-beta");
    const connection = new Connection(rpcUrl, "confirmed");

    // --- afzender ---
    let sender;
    try {
      const secret = bs58.decode(process.env.PRIVATE_KEY);
      sender = Keypair.fromSecretKey(secret);
    } catch {
      return res.status(500).json({ error: "PRIVATE_KEY ongeldig (verwacht base58)" });
    }

    const mint = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk"); // CBS
    const buyerPubkey = new PublicKey(buyer);

    // === 1×-per-wallet met Vercel KV ===
    assertKvConfigured();
    const claimKey = `airdrop:cbs:${buyerPubkey.toBase58()}`;

    // Zet key als hij nog niet bestaat (NX). Als hij wél bestaat → al geclaimd.
    // Wil je het permanent maken? laat EX weg of zet bv. ex: 365*24*3600
    const lock = await kv.set(claimKey, JSON.stringify({ ts: Date.now() }), {
      nx: true,
      // ex: 60 * 60 * 24 * 365, // (optioneel) verval na 1 jaar
    });
    if (lock === null) {
      return res.status(409).json({ error: "already_claimed" });
    }

    try {
      // --- token accounts ---
      const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        sender,
        mint,
        sender.publicKey
      );
      const toTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        sender,
        mint,
        buyerPubkey
      );

      // --- 250 CBS (9 decimals) ---
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
      const signature = await sendAndConfirmTransaction(connection, tx, [sender]);

      // sla eventueel de tx-id op
      await kv.set(claimKey, JSON.stringify({ ts: Date.now(), txid: signature }));

      return res.status(200).json({ success: true, txid: signature });
    } catch (txErr) {
      // bij echte fout: lock weer vrijgeven
      try { await kv.del(claimKey); } catch {}
      throw txErr;
    }
  } catch (err) {
    console.error("airdrop-cbs error:", err);
    return res
      .status(500)
      .json({ error: "Transactie mislukt", details: String(err?.message || err) });
  }
}
