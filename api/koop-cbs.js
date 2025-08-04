import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST toegestaan" });
  }

  try {
    const { buyer } = req.body;

    const connection = new Connection("https://api.mainnet-beta.solana.com");
    const mint = new PublicKey(process.env.CBS_MINT);
    const payer = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
    const buyerPublicKey = new PublicKey(buyer);

    const amount = parseInt(process.env.AMOUNT_PER_SOL); // bijv. 100000 voor 0.05 SOL

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      buyerPublicKey
    );

    const mintInfo = await getMint(connection, mint);
    const tx = await connection.requestAirdrop(payer.publicKey, 1); // optioneel voor fee

    const instruction = createTransferCheckedInstruction(
      tokenAccount.address,
      mint,
      tokenAccount.address,
      payer.publicKey,
      amount,
      mintInfo.decimals,
      [],
      TOKEN_PROGRAM_ID
    );

    res.status(200).json({ message: "Transactie aangemaakt" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.toString() });
  }
}
