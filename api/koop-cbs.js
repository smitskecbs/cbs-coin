// koop.js — CBS Pack Buy (Option B frontend)
// Uses Phantom for payment + calls your Vercel /api/koop-cbs backend
// Requires: solanaWeb3 loaded in buy.html + DOM elements in buy.html

(function () {
  const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = solanaWeb3;

  // === SETTINGS ===
  const CREATOR_WALLET = new PublicKey("76SjWWFoJ1NQEWXVWbbqYR8112FAEyWGQT1PS1DeLmEg");

  // ✅ Your backend base (Vercel). You can override from buy.html with window.API_BASE
  const API_BASE =
    window.API_BASE ||
    "https://cbs-coin.vercel.app";  // <--- change to your own domain later if you want

  // ✅ RPC fallback list (fixes 403)
  const RPC_FALLBACKS = [
    window.CBS_RPC_URL,                 // your Helius/Ankr if set
    "https://rpc.ankr.com/solana",
    "https://solana-rpc.publicnode.com"
  ].filter(Boolean);

  async function getBlockhashWithFallback() {
    let lastErr = null;
    for (const url of RPC_FALLBACKS) {
      try {
        const c = new Connection(url, "confirmed");
        const { blockhash } = await c.getLatestBlockhash("finalized");
        return { c, blockhash, url };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("No RPC available");
  }

  // === UI refs ===
  const connectBtn = document.getElementById("connect-wallet-btn");
  const buyBtn = document.getElementById("buy-pack-btn");
  const statusEl = document.getElementById("pack-status");
  const packSelect = document.getElementById("pack-select");
  const stepsWrap = document.getElementById("pack-steps");
  const linksWrap = document.getElementById("pack-links");

  if (!connectBtn || !buyBtn || !statusEl || !packSelect || !stepsWrap || !linksWrap) {
    console.warn("koop.js: Missing DOM elements. Check buy.html ids.");
    return;
  }

  let provider = null;
  let buyerPubkey = null;

  function setStatus(msg, good = false) {
    statusEl.style.color = good ? "var(--cbs-neon)" : "var(--cbs-muted)";
    statusEl.textContent = msg;
  }

  function setStep(n) {
    const pills = stepsWrap.querySelectorAll(".pack-step");
    pills.forEach(p => p.classList.remove("pack-step--active"));
    const active = stepsWrap.querySelector(`.pack-step[data-step="${n}"]`);
    if (active) active.classList.add("pack-step--active");
  }

  function updateBuyText() {
    const sol = Number(packSelect.value);
    buyBtn.textContent = `Buy Pack (${sol.toFixed(2)} SOL)`;
  }

  function getProvider() {
    if ("solana" in window) {
      const p = window.solana;
      if (p?.isPhantom) return p;
    }
    return null;
  }

  updateBuyText();
  packSelect.addEventListener("change", updateBuyText);

  // 1) Connect wallet
  connectBtn.addEventListener("click", async () => {
    try {
      provider = getProvider();
      if (!provider) {
        setStatus("Phantom not found. Open this page in Phantom browser or install Phantom.");
        return;
      }

      setStep(1);
      const resp = await provider.connect();
      buyerPubkey = resp.publicKey;

      buyBtn.disabled = false;
      connectBtn.textContent = "Wallet Connected";
      setStatus("Connected: " + buyerPubkey.toString(), true);
      setStep(2);
    } catch (e) {
      console.error(e);
      setStatus("Connect cancelled.");
    }
  });

  // 2) Buy pack
  buyBtn.addEventListener("click", async () => {
    try {
      if (!provider || !buyerPubkey) {
        setStatus("Connect wallet first.");
        return;
      }

      linksWrap.style.display = "none";
      linksWrap.innerHTML = "";

      const PRICE_SOL = Number(packSelect.value);
      const lamports = Math.round(PRICE_SOL * LAMPORTS_PER_SOL);

      buyBtn.disabled = true;
      setStep(2);
      setStatus("Preparing payment...");

      const { c: connection, blockhash, url } = await getBlockhashWithFallback();

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: buyerPubkey,
          toPubkey: CREATOR_WALLET,
          lamports
        })
      );

      tx.feePayer = buyerPubkey;
      tx.recentBlockhash = blockhash;

      setStatus("Using RPC: " + url + " — confirm payment in wallet...");
      const signed = await provider.signTransaction(tx);

      setStatus("Sending payment...");
      const paymentSig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(paymentSig, "confirmed");

      setStatus("Payment confirmed. Calculating live CBS payout...");
      setStep(3);

      // ✅ Call YOUR Vercel backend (absolute URL)
      const r = await fetch(`${API_BASE}/api/koop-cbs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyer: buyerPubkey.toString(),
          signature: paymentSig,
          priceSol: PRICE_SOL // backend ignores for now; later we make it variable
        })
      });

      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Payout failed");

      // links
      const paymentLink = `https://solscan.io/tx/${paymentSig}`;
      linksWrap.innerHTML += `<a href="${paymentLink}" target="_blank" rel="noopener">Payment tx ↗</a>`;

      if (j.already) {
        setStatus("Already paid for this transaction ✅", true);
      } else {
        const payoutLink = `https://solscan.io/tx/${j.tx}`;
        linksWrap.innerHTML += `<a href="${payoutLink}" target="_blank" rel="noopener">Payout tx ↗</a>`;
        setStatus(`Success ✅ You received CBS.`, true);
      }

      linksWrap.style.display = "flex";
      setStep(1); // reset glow

    } catch (e) {
      console.error(e);
      setStatus("Error: " + (e.message || e));
    } finally {
      buyBtn.disabled = false;
    }
  });

})();
