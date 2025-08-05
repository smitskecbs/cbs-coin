import { Connection, Keypair, PublicKey, clusterApiUrl, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction
} from "@solana/spl-token";
import bs58 from "bs58";

// ✅ Jouw CBS Coin mint
const CBS_MINT = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk");
const CBS_DECIMALS = 6;
const CBS_AMOUNT = 50000000; // = 50.000 CBS (6 decimalen)

const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

export default async function handler(req, res) {
  // ✅ CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // Voor preflight check
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST toegestaan" });
  }

  try {
    const { buyer } = req.body;
    if (!buyer) {
      return res.status(400).json({ error: "Geen walletadres opgegeven" });
    }

    const buyerPublicKey = new PublicKey(buyer);
    const senderKeypair = Keypair.fromSecretKey(bs58.decode(process.env.SENDER_SECRET));
    const senderPublicKey = senderKeypair.publicKey;

    const buyerTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      CBS_MINT,
      buyerPublicKey
    );

    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      CBS_MINT,
      senderPublicKey
    );

    const transaction = new Transaction().add(
      createTransferCheckedInstruction(
        senderTokenAccount.address,
        CBS_MINT,
        buyerTokenAccount.address,
        senderPublicKey,
        CBS_AMOUNT,
        CBS_DECIMALS
      )
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair]);

    return res.status(200).json({ success: true, signature });
  } catch (error) {
    console.error("Fout bij verzenden:", error);
    return res.status(500).json({ error: error.message || "Onbekende fout" });
  }
}
