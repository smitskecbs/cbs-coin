// api/koop-cbs.js

import { Connection, PublicKey, Keypair, clusterApiUrl, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import bs58 from 'bs58';

// -------------------- INSTELLINGEN --------------------

// 👇 Vervang deze sleutel door jouw geheime (private) base58 key
// NIET PUBLIEK DELEN!
const SENDER_SECRET_KEY = '3uYAn7JrNqvwWqPQBzvRrVrHFoLEbi3hM2YqpYCVT3DaZtTyfsPuCHs93rFzxJuRyErG7mBDKDsmDhtYHLwNYsT'; // voorbeeld, vervangen!

const CBS_TOKEN_MINT = new PublicKey('B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk'); // CBS Coin
const CBS_DECIMALS = 9;
const CBS_AMOUNT = 10000 * 10 ** CBS_DECIMALS; // 10.000 CBS
const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');

// -------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Alleen POST toegestaan' });
  }

  const { buyer } = req.body;

  if (!buyer) {
    return res.status(400).json({ error: 'Ontvanger walletadres ontbreekt' });
  }

  try {
    const recipient = new PublicKey(buyer);
    const senderKeypair = Keypair.fromSecretKey(bs58.decode(SENDER_SECRET_KEY));

    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      CBS_TOKEN_MINT,
      senderKeypair.publicKey
    );

    const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      senderKeypair,
      CBS_TOKEN_MINT,
      recipient
    );

    const instruction = createTransferCheckedInstruction(
      senderTokenAccount.address,
      CBS_TOKEN_MINT,
      recipientTokenAccount.address,
      senderKeypair.publicKey,
      CBS_AMOUNT,
      CBS_DECIMALS
    );

    const tx = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(connection, tx, [senderKeypair]);

    return res.status(200).json({ success: true, signature });
  } catch (err) {
    console.error('Fout bij verzenden:', err);
    return res.status(500).json({ error: 'Verzenden mislukt', details: err.message });
  }
}
