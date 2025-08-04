// api/koop-cbs.js

import { Connection, PublicKey, Keypair, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import bs58 from 'bs58';

// --------------- CONFIG -------------------
const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');

// 👇 Voeg hier jouw geheime sleutel (base58 string) in van de sender-wallet
const SENDER_SECRET_KEY = 'jouw_base58_key_hier'; // <- Vervangen!
const CBS_TOKEN_MINT = new PublicKey('B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk');
const CBS_DECIMALS = 9;
const AMOUNT_TO_SEND = 10000 * 10 ** CBS_DECIMALS;
// ------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const { buyer } = req.body;

  if (!buyer) {
    return res.status(400).json({ error: 'No buyer wallet address provided' });
  }

  try {
    const recipient = new PublicKey(buyer);
    const senderKeypair = Keypair.fromSecretKey(bs58.decode(SENDER_SECRET_KEY));

    // 🪙 Zorg dat ontvanger CBS-tokenaccount heeft
    const buyerTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      CBS_TOKEN_MINT,
      recipient
    );

    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      CBS_TOKEN_MINT,
      senderKeypair.publicKey
    );

    // 🔁 Maak transfer aan
    const instruction = createTransferCheckedInstruction(
      senderTokenAccount.address,
      CBS_TOKEN_MINT,
      buyerTokenAccount.address,
      senderKeypair.publicKey,
      AMOUNT_TO_SEND,
      CBS_DECIMALS
    );

    const transaction = await sendAndConfirmTransaction(
      connection,
      {
        feePayer: senderKeypair.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [instruction],
      },
      [senderKeypair]
    );

    return res.status(200).json({ success: true, signature: transaction });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Token transfer failed', details: err.message });
  }
}

