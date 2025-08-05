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
  Transaction
} from "@solana/web3.js";
import bs58 from "bs58";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Alleen POST toegestaan" });

  const { buyer } = req.body;

  try {
    const connection = new Connection(clusterApiUrl("mainnet-beta"), "confirmed");

    const mint = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk"); // CBS Coin
    const sender = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
    const buyerPubkey = new PublicKey(buyer);

    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(connection, sender, mint, sender.publicKey);
    const toTokenAccount = await getOrCreateAssociatedTokenAccount(connection, sender, mint, buyerPubkey);

    const amount = 50000 * 10 ** 6;

    const instruction = createTransferCheckedInstruction(
      fromTokenAccount.address,
      mint,
      toTokenAccount.address,
      sender.publicKey,
      amount,
      6,
      [],
      TOKEN_PROGRAM_ID
    );

    const transaction = new Transaction().add(instruction); // ✅ DIT WAS JOUW FOUT
    const signature = await sendAndConfirmTransaction(connection, transaction, [sender]);

    return res.status(200).json({ success: true, signature });
  } catch (error) {
    console.error("Fout in backend:", error);
    return res.status(500).json({ error: error.message || "Onbekende fout" });
  }
}
