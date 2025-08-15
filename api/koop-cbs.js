// /api/koop-cbs.js  — na 0.020 SOL → 25.000 CBS sturen

import bs58 from "bs58";
import {
  Connection, PublicKey, Keypair, SystemProgram,
  Transaction, TransactionInstruction, LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
  getMint,
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
} from "@solana/spl-token";

// === ENV ===
// Zet deze in Vercel → Project → Settings → Environment Variables
const RPC_URL          = process.env.HELIUS_RPC_URL;   // bv: https://mainnet.helius-rpc.com/?api-key=xxxxx
const CREATOR_WALLET   = process.env.CREATOR_WALLET;   // jouw SOL-ontvangstadres (76Sj...LmEg)
const TREASURY_SECRET  = process.env.TREASURY_PRIVATE_KEY_B58; // base58 secret key (NIET de pubkey!)
const CBS_MINT         = process.env.CBS_MINT;         // B9z8...Cfkk
const PRICE_SOL        = Number(process.env.PRICE_SOL ?? "0.02");   // 0.02
const CBS_AMOUNT_HUMAN = Number(process.env.CBS_AMOUNT ?? "25000"); // 25000

function bad(res, code, msg){ res.status(code).json({ ok:false, error:msg }); }
function ok(res, data={}){ res.status(200).json({ ok:true, ...data }); }

function kpFromBase58(b58){
  const secret = bs58.decode(b58);
  return Keypair.fromSecretKey(secret);
}

function isSystemTransfer(ix){
  try {
    const prog = ix?.programId?.toString?.() || ix?.program;
    return prog === SystemProgram.programId.toString() || ix?.program === "system";
  } catch { return false; }
}

async function findRecentPayout(connection, fromPubkey, toPubkey, mint, rawAmountHuman){
  // Heuristiek om dubbele uitbetaling te vermijden: kijk recente txs van treasury
  try{
    const sigs = await connection.getSignaturesForAddress(fromPubkey, { limit: 25 });
    const infos = await connection.getParsedTransactions(sigs.map(s=>s.signature), {
      maxSupportedTransactionVersion: 0
    });
    for (const tx of infos){
      if (!tx) continue;
      const ixs = tx.transaction.message.instructions || [];
      for (const ix of ixs){
        // parsed SPL transfer?
        const p = ix?.parsed;
        if (p?.type === "transferChecked" || p?.type === "transfer"){
          const info = p.info || {};
          // filter op mint en ontvanger
          if ((info.mint || info.mintAddress) !== mint.toString()) continue;
          if (info.destinationOwner && info.destinationOwner !== toPubkey.toString()) continue;

          // bedrag vergelijken (op humane hoeveelheid; dit is grofmazig, maar voldoende als guard)
          const ui = Number(info.tokenAmount?.uiAmountString ?? info.tokenAmount?.uiAmount ?? info.amount ?? 0);
          if (Math.abs(ui - rawAmountHuman) < 0.0001) return true;
        }
      }
    }
  }catch(_){}
  return false;
}

export default async function handler(req, res){
  if (req.method !== "POST") return bad(res, 405, "Method not allowed");
  try{
    const { buyer, signature } = req.body || {};
    if (!buyer || !signature) return bad(res, 400, "Missing buyer or signature");

    // Basis checks
    const connection = new Connection(RPC_URL, "confirmed");
    const buyerPk  = new PublicKey(buyer);
    const creator  = new PublicKey(CREATOR_WALLET);
    const mintPk   = new PublicKey(CBS_MINT);

    // 1) Verifieer SOL-betaling
    const parsed = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0, commitment: "confirmed"
    });
    if (!parsed) return bad(res, 400, "Transaction not found");

    const lamportsExpected = Math.round(PRICE_SOL * LAMPORTS_PER_SOL);

    // Zoek een system transfer van buyer → creator met ≥ expected lamports
    let valid = false;
    for (const ix of (parsed.transaction.message.instructions || [])){
      if (!isSystemTransfer(ix)) continue;
      const info = ix?.parsed?.info;
      if (!info) continue;
      const from = info.source || info.fromPubkey || info.sourcePubkey;
      const to   = info.destination || info.toPubkey || info.destinationPubkey;
      const lam  = Number(info.lamports || info.amount || 0);
      if (from === buyerPk.toString() && to === creator.toString() && lam >= lamportsExpected){
        valid = true; break;
      }
    }
    if (!valid) return bad(res, 400, "Payment not verified (wrong recipient or amount)");

    // Stale-protect (30 min)
    const now = Math.floor(Date.now()/1000);
    if (parsed.blockTime && (now - parsed.blockTime) > 1800){
      return bad(res, 400, "Payment too old");
    }

    // 2) Dubbele uitbetaling voorkomen: check recente payouts
    const treasury = kpFromBase58(TREASURY_SECRET);
    const already = await findRecentPayout(connection, treasury.publicKey, buyerPk, mintPk, CBS_AMOUNT_HUMAN);
    if (already) return ok(res, { already: true });

    // 3) Stuur 25.000 CBS
    const mintInfo = await getMint(connection, mintPk);
    const decimals = mintInfo.decimals ?? 9;
    const amountBn = BigInt(Math.round(CBS_AMOUNT_HUMAN * (10 ** decimals)));

    // ATAs
    const fromAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPk, treasury.publicKey);
    const toAta   = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPk, buyerPk);

    // Memo (maak idempotent markering met de SOL-signature)
    const memoProgramId = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const memoIx = new TransactionInstruction({
      programId: memoProgramId,
      keys: [{ pubkey: treasury.publicKey, isSigner: true, isWritable: false }],
      data: Buffer.from(String(signature), "utf8"),
    });

    const transferIx = createTransferCheckedInstruction(
      fromAta.address,
      mintPk,
      toAta.address,
      treasury.publicKey,
      amountBn,
      decimals
    );

    const tx = new Transaction().add(memoIx, transferIx);
    tx.feePayer = treasury.publicKey;
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;

    const sendSig = await connection.sendTransaction(tx, [treasury], { skipPreflight: false });
    await connection.confirmTransaction(sendSig, "confirmed");

    return ok(res, { tx: sendSig });
  }catch(e){
    console.error("koop-cbs error:", e);
    return bad(res, 500, e?.message || "Internal error");
  }
}
