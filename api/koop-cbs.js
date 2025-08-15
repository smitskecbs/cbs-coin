// /api/koop-cbs.js  — na 0.020 SOL → 25.000 CBS sturen (met CORS)

// ---------- CORS ----------
const ALLOW_ORIGINS = [
  "https://smitskecbs.github.io", // jouw GitHub Pages (origin is zonder pad)
  "https://cbs-coin.vercel.app",  // jouw Vercel frontend
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function corsHeaders(origin = "") {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}
function send(res, status, body, origin) {
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.status(status).json(body);
}
function ok(res, data, origin) { send(res, 200, { ok: true, ...data }, origin); }
function bad(res, status, msg, origin) { send(res, status, { ok: false, error: msg }, origin); }

// ---------- Imports ----------
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

// ---------- ENV ----------
const RPC_URL          = process.env.HELIUS_RPC_URL;
const CREATOR_WALLET   = process.env.CREATOR_WALLET;           // 76Sj...LmEg
const TREASURY_SECRET  = process.env.TREASURY_PRIVATE_KEY_B58; // base58 geheime key
const CBS_MINT         = process.env.CBS_MINT;                 // B9z8...Cfkk
const PRICE_SOL        = Number(process.env.PRICE_SOL ?? "0.02");
const CBS_AMOUNT_HUMAN = Number(process.env.CBS_AMOUNT ?? "25000");

// ---------- Helpers ----------
function kpFromBase58(b58) { return Keypair.fromSecretKey(bs58.decode(b58)); }
function isSystemTransfer(ix){
  try {
    const prog = ix?.programId?.toString?.() || ix?.program;
    return prog === SystemProgram.programId.toString() || prog === "system";
  } catch { return false; }
}
async function findRecentPayout(connection, fromPubkey, toPubkey, mint, uiAmount){
  try{
    const sigs = await connection.getSignaturesForAddress(fromPubkey, { limit: 25 });
    const infos = await connection.getParsedTransactions(sigs.map(s=>s.signature), {
      maxSupportedTransactionVersion: 0
    });
    for (const tx of infos){
      if (!tx) continue;
      for (const ix of (tx.transaction.message.instructions || [])){
        const p = ix?.parsed;
        if (p?.type !== "transferChecked" && p?.type !== "transfer") continue;
        const info = p.info || {};
        if ((info.mint || info.mintAddress) !== mint.toString()) continue;
        if (info.destinationOwner && info.destinationOwner !== toPubkey.toString()) continue;
        const ui = Number(info.tokenAmount?.uiAmountString ?? info.tokenAmount?.uiAmount ?? info.amount ?? 0);
        if (Math.abs(ui - uiAmount) < 0.0001) return true;
      }
    }
  }catch(_){}
  return false;
}

// ---------- Handler ----------
export default async function handler(req, res){
  const origin = req.headers.origin || "";

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  if (req.method !== "POST") return bad(res, 405, "Method not allowed", origin);

  try{
    const { buyer, signature } = req.body || {};
    if (!buyer || !signature) return bad(res, 400, "Missing buyer or signature", origin);

    const connection = new Connection(RPC_URL, "confirmed");
    const buyerPk  = new PublicKey(buyer);
    const creator  = new PublicKey(CREATOR_WALLET);
    const mintPk   = new PublicKey(CBS_MINT);

    // 1) Verifieer betaling (buyer -> creator, >= PRICE_SOL)
    const parsed = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0, commitment: "confirmed"
    });
    if (!parsed) return bad(res, 400, "Transaction not found", origin);

    const lamportsExpected = Math.round(PRICE_SOL * LAMPORTS_PER_SOL);
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
    if (!valid) return bad(res, 400, "Payment not verified (wrong recipient or amount)", origin);

    // Stale guard (30 min)
    const now = Math.floor(Date.now()/1000);
    if (parsed.blockTime && (now - parsed.blockTime) > 1800){
      return bad(res, 400, "Payment too old", origin);
    }

    // 2) Dubbele uitbetaling voorkomen
    const treasury = kpFromBase58(TREASURY_SECRET);
    const already = await findRecentPayout(connection, treasury.publicKey, buyerPk, mintPk, CBS_AMOUNT_HUMAN);
    if (already) return ok(res, { already: true }, origin);

    // 3) Uitbetaling 25.000 CBS
    const mintInfo = await getMint(connection, mintPk);
    const decimals = mintInfo.decimals ?? 9;
    const amountBn = BigInt(Math.round(CBS_AMOUNT_HUMAN * (10 ** decimals)));

    const fromAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPk, treasury.publicKey);
    const toAta   = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPk, buyerPk);

    const memoProgramId = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const memoIx = new TransactionInstruction({
      programId: memoProgramId,
      keys: [{ pubkey: treasury.publicKey, isSigner: true, isWritable: false }],
      data: Buffer.from(String(signature), "utf8"),
    });

    const transferIx = createTransferCheckedInstruction(
      fromAta.address, mintPk, toAta.address, treasury.publicKey, amountBn, decimals
    );

    const tx = new Transaction().add(memoIx, transferIx);
    tx.feePayer = treasury.publicKey;
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;

    const sendSig = await connection.sendTransaction(tx, [treasury], { skipPreflight: false });
    await connection.confirmTransaction(sendSig, "confirmed");

    return ok(res, { tx: sendSig }, origin);
  }catch(e){
    console.error("koop-cbs error:", e);
    return bad(res, 500, e?.message || "Internal error", origin);
  }
}
