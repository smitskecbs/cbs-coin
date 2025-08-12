import {
  createTransferCheckedInstruction,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
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
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // OPTIONS request for CORS preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Alleen POST toegestaan
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST toegestaan" });
  }

  const { buyer } = req.body;

  try {
    // Verbinden met mainnet
    const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

    // CBS Token en verzender instellen
    const mint = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk"); // CBS Coin
    const sender = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
    const buyerPubkey = new PublicKey(buyer);

    // Token accounts ophalen of aanmaken
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

    // ✅ Bedrag in CBS (50.000 CBS met 9 decimals)
    const amount = 50000 * 10 ** 9;

    // Transactie opbouwen
    const instruction = createTransferCheckedInstruction(
      fromTokenAccount.address, // source
      mint,                     // mint
      toTokenAccount.address,  // destination
      sender.publicKey,        // authority
      amount,                  // amount
      9                        // ✅ decimals
    );

    const transaction = new Transaction().add(instruction);

    // Verzenden
    const signature = await sendAndConfirmTransaction(connection, transaction, [sender]);

    return res.status(200).json({ success: true, signature });
  } catch (err) {
    console.error("Fout bij verzenden CBS Coin:", err);
    return res.status(500).json({ error: "Transactie mislukt", details: err.message });
  }
}
