import { kv } from "@vercel/kv";

import {
  createTransferCheckedInstruction,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST toegestaan" });

  try {
    const { buyer } = req.body || {};
    if (!buyer) return res.status(400).json({ error: "buyer is verplicht" });

    const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
    const mint = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk");

    const pk = process.env.PRIVATE_KEY;
    if (!pk) return res.status(500).json({ error: "PRIVATE_KEY ontbreekt in Vercel env" });

    const sender = Keypair.fromSecretKey(bs58.decode(pk));
    const buyerPubkey = new PublicKey(buyer);

    // === Wallet-lock: één keer per wallet ===
    const claimKey = `airdrop:cbs:${buyerPubkey.toBase58()}`;

    // Probeer lock te zetten voor 10 minuten (race-condition safe).
    // Als er al een waarde is, dan heeft deze wallet al geclaimd.
    const lock = await kv.set(claimKey, "locked", { nx: true, ex: 10 * 60 });
    if (lock === null) {
      // bestond al
      return res.status(409).json({ error: "already_claimed" });
    }

    // Token accounts
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

    // 250 CBS (9 decimals)
    const amount = BigInt(250) * BigInt(10 ** 9);

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

    // Lock definitief maken (geen TTL meer) + tx opslaan
    await kv.set(claimKey, JSON.stringify({ ts: Date.now(), txid: signature }));

    return res.status(200).json({ success: true, txid: signature });
  } catch (err) {
    console.error("airdrop-cbs error:", err);
    // Als iets faalt, lock weer vrijgeven om vastlopers te voorkomen
    try {
      const buyer = req.body?.buyer;
      if (buyer) {
        const claimKey = `airdrop:cbs:${new PublicKey(buyer).toBase58()}`;
        await kv.del(claimKey);
      }
    } catch (_) {}
    return res.status(500).json({ error: "Transactie mislukt", details: String(err?.message || err) });
  }
}
