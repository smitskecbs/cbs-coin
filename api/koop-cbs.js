import { Connection, Keypair, PublicKey, clusterApiUrl, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction
} from "@solana/spl-token";
import bs58 from "bs58";

const CBS_MINT = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk");
const CBS_DECIMALS = 6;
const CBS_AMOUNT = 50000000; // 50.000 CBS
const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

export default async function handler(req, res) {
  // ✅ CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // ✅ Preflight (CORS) request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST toegestaan" });
  }

  try {
    const { buyer } = req.body;
    if (!buyer) return res.status(400).json({ error: "Walletadres ontbreekt" });

    const buyerPubkey = new PublicKey(buyer);
    const senderKeypair = Keypair.fromSecretKey(bs58.decode(process.env.SENDER_SECRET));
    const senderPubkey = senderKeypair.publicKey;

    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      CBS_MINT,
      senderPubkey
    );

    const buyerTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      CBS_MINT,
      buyerPubkey
    );

    const transaction = new Transaction().add(
      createTransferCheckedInstruction(
        senderTokenAccount.address,
        CBS_MINT,
        buyerTokenAccount.address,
        senderPubkey,
        CBS_AMOUNT,
        CBS_DECIMALS
      )
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair]);

    res.status(200).json({ success: true, signature });
  } catch (error) {
    console.error("Fout in koop-cbs.js:", error);
    res.status(500).json({ error: error.message || "Onbekende fout" });
  }
}
