// /api/koop-cbs.js — dynamic live-price payout via Jupiter Quote (met CORS)

// ---------- CORS ----------
const ALLOW_ORIGINS = [
  "https://smitskecbs.github.io",
  "https://cbs-coin.vercel.app",
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
const CREATOR_WALLET   = process.env.CREATOR_WALLET;
const TREASURY_SECRET  = process.env.TREASURY_PRIVATE_KEY_B58;
const CBS_MINT         = process.env.CBS_MINT;

const PRICE_SOL        = Number(process.env.PRICE_SOL ?? "0.02");

// Jupiter quote tuning (defaults ok)
const QUOTE_SLIPPAGE_BPS  = Number(process.env.QUOTE_SLIPPAGE_BPS ?? "150"); // 1.5%
const SAFETY_BUFFER_BPS   = Number(process.env.SAFETY_BUFFER_BPS ?? "50");  // 0.5%

// ---------- Helpers ----------
function kpFromBase58(b58) { return Keypair.fromSecretKey(bs58.decode(b58)); }

function isSystemTransfer(ix){
  try {
    const prog = ix?.programId?.toString?.() || ix?.program;
    return prog === SystemProgram.programId.toString() || prog === "system";
  } catch { return false; }
}

// check for earlier payout by memo(signature)
async function findPayoutByMemo(connection, fromPubkey, signature){
  try{
    const sigs = await connection.getSignaturesForAddress(fromPubkey, { limit: 25 });
    const infos = await connection.getParsedTransactions(
      sigs.map(s=>s.signature),
      { maxSupportedTransactionVersion: 0 }
    );

    for (const tx of infos){
      if (!tx) continue;
      const ixs = tx.transaction.message.instructions || [];
      for (const ix of ixs){
        // Memo program parsed may be absent; so check raw program id + data
        const pid = ix?.programId?.toString?.();
        if (pid !== "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") continue;

        const data = ix?.data;
        // parsed tx can show base58 data too; safest to decode as utf8 if possible
        try {
          const memoStr = Buffer.from(data, "base64").toString("utf8");
          if (memoStr === signature) return true;
        } catch {
          // if not base64, ignore
        }
      }
    }
  }catch(_){}
  return false;
}

// Jupiter Quote v6
async function getJupiterQuote({ inputMint, outputMint, amount, slippageBps }) {
  const url =
    `https://quote-api.jup.ag/v6/quote` +
    `?inputMint=${inputMint}` +
    `&outputMint=${outputMint}` +
    `&amount=${amount}` +
    `&slippageBps=${slippageBps}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Jupiter quote failed: ${r.status}`);
  const j = await r.json();
  if (!j?.outAmount) throw new Error("No outAmount in Jupiter quote");
  return j;
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
    if (parsed.meta?.err) return bad(res, 400, "Transaction failed", origin);

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

    // 2) Dubbele uitbetaling voorkomen via memo(signature)
    const treasury = kpFromBase58(TREASURY_SECRET);
    const already = await findPayoutByMemo(connection, treasury.publicKey, signature);
    if (already) return ok(res, { already: true }, origin);

    // 3) Live quote ophalen: 0.02 SOL -> CBS amount (base units)
    const WSOL_MINT = "So11111111111111111111111111111111111111112";
    const amountLamports = Math.round(PRICE_SOL * LAMPORTS_PER_SOL);

    const quote = await getJupiterQuote({
      inputMint: WSOL_MINT,
      outputMint: mintPk.toString(),
      amount: amountLamports,
      slippageBps: QUOTE_SLIPPAGE_BPS
    });

    let outAmountBase = BigInt(quote.outAmount);

    // 4) Safety buffer (bijv 0.5%) om underfill failures te vermijden
    const bufferBps = BigInt(Math.max(0, SAFETY_BUFFER_BPS));
    if (bufferBps > 0n) {
      outAmountBase = (outAmountBase * (10000n - bufferBps)) / 10000n;
    }

    if (outAmountBase <= 0n) {
      return bad(res, 500, "Quote returned 0 CBS", origin);
    }

    // 5) Transfer CBS uit treasury naar buyer
    const mintInfo = await getMint(connection, mintPk);
    const decimals = mintInfo.decimals ?? 9;

    const fromAta = await getOrCreateAssociatedTokenAccount(
      connection, treasury, mintPk, treasury.publicKey
    );
    const toAta   = await getOrCreateAssociatedTokenAccount(
      connection, treasury, mintPk, buyerPk
    );

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
      outAmountBase,
      decimals
    );

    const tx = new Transaction().add(memoIx, transferIx);
    tx.feePayer = treasury.publicKey;
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;

    const sendSig = await connection.sendTransaction(tx, [treasury], { skipPreflight: false });
    await connection.confirmTransaction(sendSig, "confirmed");

    // UI amount for frontend display
    const uiAmount = Number(outAmountBase) / (10 ** decimals);

    return ok(res, { tx: sendSig, cbsPaid: uiAmount }, origin);
  }catch(e){
    console.error("koop-cbs error:", e);
    return bad(res, 500, e?.message || "Internal error", origin);
  }
}
