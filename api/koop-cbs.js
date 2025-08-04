const bs58 = require("bs58");
const {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} = require("@solana/web3.js");
const {
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
} = require("@solana/spl-token");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Alleen POST toegestaan." });
  }

  try {
    const { buyer } = req.body;
    if (!buyer) {
      return res.status(400).json({ error: "Geen walletadres ontvangen." });
    }

    console.log("✅ Buyer ontvangen:", buyer);

    // 🔐 Private key van Vercel .env
    const secretKey = bs58.decode(process.env.PRIVATE_KEY);
    const payer = Keypair.fromSecretKey(secretKey);

    // 🔗 Solana verbinding
    const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

    // 🔧 Instellingen
    const mint = new PublicKey("B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk");
    const recipient = new PublicKey(buyer);
    const sender = payer.publicKey;

    // 📦 Token accounts ophalen of aanmaken
    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(connection, payer, mint, sender);
    const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(connection, payer, mint, recipient);

    console.log("✅ Verzender ATA:", senderTokenAccount.address.toBase58());
    console.log("✅ Ontvanger ATA:", recipientTokenAccount.address.toBase58());

    // 🔢 Aantal tokens: 50.000 CBS (5 decimalen)
    const amount = 50000 * Math.pow(10, 5);

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

    const signature = await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log("✅ Transactie geslaagd:", signature);

    return res.status(200).json({ success: true, signature });
  } catch (err) {
    console.error("❌ Fout bij koopCBS:", err);
    return res.status(500).json({ error: err.message || "Onbekende fout" });
  }
};
