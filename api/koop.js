// /api/koop-cbs.js — dynamic CBS payout at live market price (NO presale)
// After buyer pays SOL, backend fetches Jupiter quote SOL->CBS and pays that amount.

// ---------- CORS ----------
const ALLOW_ORIGINS = [
  "https://smitskecbs.github.io",
  "https://cbs-coin.vercel.app",
  "https://cbs-coin.com",
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
const HELIUS_API_KEY   = process.env.HELIUS_API_KEY;
const RPC_URL          = process.env.HELIUS_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const CREATOR_WALLET   = process.env.CREATOR_WALLET;           // 76Sj...LmEg
const TREASURY_SECRET  = process.env.TREASURY_PRIVATE_KEY_B58; // treasury base58 secret
const CBS_MINT         = process.env.CBS_MINT;                 // B9z8...Cfkk

// Pack price is sent from frontend (priceSol). We'll verify >= that amount.
const DEFAULT_PRICE_SOL = Number(process.env.PRICE_SOL ?? "0.02");

// Slippage for quote (bps = 100 = 1%)
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? "300");

// Safety buffer so we NEVER overpay vs quote (e.g. 0.5% less)
const PAYOUT_BUFFER_BPS = Number(process.env.PAYOUT_BUFFER_BPS ?? "50");

// WSOL mint (Jupiter uses WSOL as inputMint)
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// ---------- Helpers ----------
function kpFromBase58(b58) { return Keypair.fromSecretKey(bs58.decode(b58)); }

function isSystemTransfer(ix){
  try {
    const prog = ix?.programId?.toString?.() || ix?.program;
    return prog === SystemProgram.programId.toString() || prog === "system";
  } catch { return false; }
}

// prevent double payout by scanning treasury->buyer recent transfers
async function findRecentPayout(connection, fromPubkey, toPubkey, mint){
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
        // if destination matches buyer -> payout already happened
        if (info.destinationOwner === toPubkey.toString()) return true;
      }
    }
  }catch(_){}
  return false;
}

async function getJupiterQuoteLamportsToCbsRaw(lamportsIn, cbsMint){
  const url =
    `https://api.jup.ag/swap/v1/quote` +
    `?inputMint=${WSOL_MINT}` +
    `&outputMint=${cbsMint}` +
    `&amount=${lamportsIn}` +
    `&slippageBps=${SLIPPAGE_BPS}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error("Jupiter quote failed");
  const j = await r.json();
  if (!j?.outAmount) throw new Error("No outAmount in quote");
  return BigInt(j.outAmount); // raw integer (already decimals-adjusted)
}

// ---------- Handler ----------
export default async function handler(req, res){
  const origin = req.headers.origin || "";

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }
  if (req.method !== "POST") return bad(res, 405, "Method not allowed", origin);

  try{
    const { buyer, signature, priceSol } = req.body || {};
    if (!buyer || !signature) return bad(res, 400, "Missing buyer or signature", origin);

    const connection = new Connection(RPC_URL, "confirmed");
    const buyerPk  = new PublicKey(buyer);
    const creator  = new PublicKey(CREATOR_WALLET);
    const mintPk   = new PublicKey(CBS_MINT);

    const expectedPriceSol = Number(priceSol ?? DEFAULT_PRICE_SOL);
    const lamportsExpected = Math.round(expectedPriceSol * LAMPORTS_PER_SOL);

    // 1) Verify payment (buyer -> creator, >= expected SOL)
    const parsed = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0, commitment: "confirmed"
    });
    if (!parsed) return bad(res, 400, "Transaction not found", origin);

    let valid = false;
    let lamportsPaid = 0;

    for (const ix of (parsed.transaction.message.instructions || [])){
      if (!isSystemTransfer(ix)) continue;
      const info = ix?.parsed?.info;
      if (!info) continue;
      const from = info.source || info.fromPubkey || info.sourcePubkey;
      const to   = info.destination || info.toPubkey || info.destinationPubkey;
      const lam  = Number(info.lamports || info.amount || 0);
      if (from === buyerPk.toString() && to === creator.toString() && lam >= lamportsExpected){
        valid = true;
        lamportsPaid = lam;
        break;
      }
    }
    if (!valid) return bad(res, 400, "Payment not verified (wrong recipient or amount)", origin);

    // stale guard (30 min)
    const now = Math.floor(Date.now()/1000);
    if (parsed.blockTime && (now - parsed.blockTime) > 1800){
      return bad(res, 400, "Payment too old", origin);
    }

    // 2) Double payout guard
    const treasury = kpFromBase58(TREASURY_SECRET);
    const already = await findRecentPayout(connection, treasury.publicKey, buyerPk, mintPk);
    if (already) return ok(res, { already: true }, origin);

    // 3) Get LIVE market payout amount from Jupiter quote
    const quoteOutRaw = await getJupiterQuoteLamportsToCbsRaw(lamportsPaid, mintPk.toString());

    // Apply small safety buffer (e.g. 0.5% less)
    const bufferFactor = BigInt(10_000 - PAYOUT_BUFFER_BPS);
    const payoutRaw = (quoteOutRaw * bufferFactor) / BigInt(10_000);

    // 4) Send CBS payout
    const mintInfo = await getMint(connection, mintPk);
    const decimals = mintInfo.decimals ?? 9;

    const fromAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPk, treasury.publicKey);
    const toAta   = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPk, buyerPk);

    const memoProgramId = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const memoIx = new TransactionInstruction({
      programId: memoProgramId,
      keys: [{ pubkey: treasury.publicKey, isSigner: true, isWritable: false }],
      data: Buffer.from(String(signature), "utf8"),
    });

    const transferIx = createTransferCheckedInstruction(
      fromAta.address, mintPk, toAta.address, treasury.publicKey, payoutRaw, decimals
    );

    const tx = new Transaction().add(memoIx, transferIx);
    tx.feePayer = treasury.publicKey;
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;

    const sendSig = await connection.sendTransaction(tx, [treasury], { skipPreflight: false });
    await connection.confirmTransaction(sendSig, "confirmed");

    return ok(res, {
      tx: sendSig,
      lamportsPaid,
      quoteOutRaw: quoteOutRaw.toString(),
      payoutRaw: payoutRaw.toString()
    }, origin);

  }catch(e){
    console.error("koop-cbs error:", e);
    return bad(res, 500, e?.message || "Internal error", origin);
  }
}
