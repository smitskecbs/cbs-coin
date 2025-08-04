// /api/koop-cbs.js
const bs58 = require("bs58");
const {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  sendAndConfirmTransaction,
  Transaction,
} = require("@solana/web3.js");
const {
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
} = require("@solana/spl-token");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST toegestaan" });
  }

  try {
    const { buyer } = req.body;
    if (!buyer) return res.status(400).json({ error: "Geen walletadres ontvangen." });

    console.log("✅ Buyer ontvangen:", buyer);

    const secretKey = bs58.decode(process.env.PRIVATE_KEY);
    const payer = Keypair.fromSecretKey(secretKey);
    const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

    const mint = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk");
    const recipient = new PublicKey(buyer);
    const sender = payer.publicKey;

    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(connection, payer, mint, sender);
    console.log("✅ Sender token account:", senderTokenAccount.address.toBase58());

    const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(connection, payer, mint, recipient);
    console.log("✅ Recipient token account:", recipientTokenAccount.address.toBase58());

    const amount = 50000 * Math.pow(10, 5); // CBS heeft 5 decimals
    console.log("✅ Verstuur bedrag:", amount);

    const tx = new Transaction().add(
      createTransferCheckedInstruction(
        senderTokenAccount.address,
        mint,
        recipientTokenAccount.address,
        sender,
        amount,
        5
      )
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log("✅ Transactie succesvol:", sig);

    return res.status(200).json({ success: true, signature: sig });
  } catch (err) {
    console.error("❌ Fout in koop-cbs.js:", err);
    return res.status(500).json({ error: err.message || "Onbekende fout" });
  }
};

