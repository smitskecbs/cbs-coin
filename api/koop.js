/* koop.js — CBS Buy Packs (live market payout)
   Frontend:
   1) Connect wallet (Phantom / Solflare / Backpack / OKX)
   2) Send SOL to creator wallet
   3) Call backend payout (dynamic SOL->CBS via Jupiter)
   NOTE: No imports here. Uses global solanaWeb3 from ./libs/solana-web3.min.js
*/

(function () {
  // ---------------- CONFIG ----------------
  const CBS_MINT = "B9z8cEWFmc7LvQtjKsaLoKqW5MJmGRCWqs1DPKupCfkk";
  const CREATOR_WALLET = "76SjWWFoJ1NQEWXVWbbqYR8112FAEyWGQT1PS1DeLmEg";

  // Public RPC (no key). You can override in buy.html by setting window.CBS_RPC_URL before this loads.
  const RPC_URL = window.CBS_RPC_URL || "https://api.mainnet-beta.solana.com";

  // Backend base (Vercel). You can override in buy.html with window.CBS_BACKEND_BASE
  const BACKEND_BASE =
    window.CBS_BACKEND_BASE ||
    (location.hostname.includes("github.io")
      ? "https://cbs-coin.vercel.app"
      : "");

  const API_URL = `${BACKEND_BASE}/api/koop-cbs.js`;

  const PACKS = [
    { label: "Starter Pack — 0.02 SOL", sol: 0.02 },
    { label: "Mini Pack — 0.01 SOL", sol: 0.01 },
    { label: "Builder Pack — 0.05 SOL", sol: 0.05 },
    { label: "Whale Pack — 0.10 SOL", sol: 0.1 },
  ];

  // ---------------- STATE ----------------
  let provider = null;
  let publicKey = null;

  // ---------------- DOM HELPERS ----------------
  const $ = (id) => document.getElementById(id);

  function setStatus(msg, isError = false) {
    const el = $("cbs-pack-status");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "#fca5a5" : "#a7f3d0";
  }

  function setStep(step) {
    const steps = ["step-1", "step-2", "step-3"];
    steps.forEach((s, i) => {
      const el = $(s);
      if (!el) return;
      el.style.opacity = i + 1 <= step ? "1" : "0.4";
      el.style.borderColor = i + 1 === step ? "rgba(36,230,181,0.9)" : "rgba(148,163,184,0.4)";
    });
  }

  function setWalletUI(connected) {
    const btn = $("connect-wallet-btn");
    const addr = $("connected-address");
    if (btn) {
      btn.textContent = connected ? "Wallet Connected" : "Connect Wallet";
      btn.disabled = connected;
      btn.style.opacity = connected ? "0.8" : "1";
    }
    if (addr) {
      addr.textContent = connected ? publicKey.toString() : "Not connected.";
      addr.style.color = connected ? "#a7f3d0" : "#9ca3af";
    }
  }

  // ---------------- WALLET DETECTION ----------------
  function getProvider() {
    if (window.solana && window.solana.isPhantom) return window.solana;
    if (window.solflare && window.solflare.isSolflare) return window.solflare;
    if (window.backpack && window.backpack.isBackpack) return window.backpack;
    if (window.okxwallet && window.okxwallet.solana) return window.okxwallet.solana;
    if (window.solana) return window.solana; // fallback
    return null;
  }

  async function connectWallet() {
    provider = getProvider();
    if (!provider) {
      setStatus("No Solana wallet found. Install Phantom, Solflare, Backpack or OKX.", true);
      return;
    }

    try {
      setStatus("Connecting wallet...");
      const res = await provider.connect();
      publicKey = res.publicKey || provider.publicKey;
      if (!publicKey) throw new Error("No public key returned");

      setWalletUI(true);
      setStep(2);
      setStatus("Wallet connected.");
    } catch (e) {
      console.error(e);
      setStatus("Wallet connect failed: " + (e?.message || e), true);
    }
  }

  // ---------------- PAYMENT + PAYOUT ----------------
  function getSelectedPack() {
    const sel = $("pack-select");
    const idx = sel ? Number(sel.value) : 0;
    return PACKS[idx] || PACKS[0];
  }

  async function sendSolAndPayout() {
    if (!provider || !publicKey) {
      setStatus("Connect your wallet first.", true);
      return;
    }

    if (!window.solanaWeb3) {
      setStatus("solana-web3 library not loaded. Check ./libs/solana-web3.min.js", true);
      return;
    }

    const pack = getSelectedPack();
    const lamports = Math.round(pack.sol * window.solanaWeb3.LAMPORTS_PER_SOL);

    try {
      setStep(2);
      setStatus("Preparing transaction...");

      const connection = new window.solanaWeb3.Connection(RPC_URL, "confirmed");
      const toPubkey = new window.solanaWeb3.PublicKey(CREATOR_WALLET);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");

      const tx = new window.solanaWeb3.Transaction({
        feePayer: publicKey,
        recentBlockhash: blockhash,
      }).add(
        window.solanaWeb3.SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey,
          lamports,
        })
      );

      setStatus(`Confirm ${pack.sol} SOL payment in your wallet...`);

      let sig;
      if (provider.signAndSendTransaction) {
        const r = await provider.signAndSendTransaction(tx);
        sig = r.signature || r;
      } else if (provider.signTransaction) {
        const signed = await provider.signTransaction(tx);
        sig = await connection.sendRawTransaction(signed.serialize());
      } else {
        throw new Error("Wallet does not support signAndSendTransaction/signTransaction.");
      }

      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      setStep(3);
      setStatus("Payment confirmed. Requesting CBS payout...");

      // Call backend for dynamic payout
      const payoutRes = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyer: publicKey.toString(),
          signature: sig,
          priceSol: pack.sol,
          cbsMint: CBS_MINT,
        }),
      });

      const payoutJson = await payoutRes.json();
      if (!payoutRes.ok || !payoutJson.ok) {
        throw new Error(payoutJson?.error || "Payout API failed");
      }

      setStatus("CBS payout sent! Check your wallet in a moment.");
      $("last-payment-sig").textContent = sig;
      $("last-payout-sig").textContent = payoutJson.tx || "pending";
    } catch (e) {
      console.error(e);
      setStatus(e?.message || String(e), true);
      setStep(1);
    }
  }

  // ---------------- INIT UI ----------------
  function mountPacks() {
    const sel = $("pack-select");
    if (!sel) return;
    sel.innerHTML = PACKS.map((p, i) =>
      `<option value="${i}">${p.label}</option>`
    ).join("");
  }

  function bindEvents() {
    const connectBtn = $("connect-wallet-btn");
    const buyBtn = $("buy-pack-btn");
    if (connectBtn) connectBtn.addEventListener("click", connectWallet);
    if (buyBtn) buyBtn.addEventListener("click", sendSolAndPayout);
  }

  document.addEventListener("DOMContentLoaded", function () {
    mountPacks();
    bindEvents();
    setStep(1);
    setWalletUI(false);
    setStatus("Not connected.");
  });
})();

