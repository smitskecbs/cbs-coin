// api/koop.js — CBS Pack Buy frontend (multi-wallet)
// Warning only on confirm: we DO NOT open a wallet popup if balance is insufficient.
// Works with Phantom, Solflare, Backpack, OKX, Trust, BitKeep, etc.

(function () {
  const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = solanaWeb3;

  // === CONFIG ===
  const CREATOR_WALLET = new PublicKey("76SjWWFoJ1NQEWXVWbbqYR8112FAEyWGQT1PS1DeLmEg");
  const API_BASE = window.API_BASE || "https://cbs-coin.vercel.app";

  const RPC_FALLBACKS = [
    window.CBS_RPC_URL,
    "https://solana-rpc.publicnode.com",
    "https://api.mainnet-beta.solana.com"
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

  async function getBalanceWithFallback(pubkey) {
    let lastErr = null;
    for (const url of RPC_FALLBACKS) {
      try {
        const c = new Connection(url, "confirmed");
        const bal = await c.getBalance(pubkey, "confirmed");
        return { c, bal, url };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("No RPC available");
  }

  // === DOM ===
  const connectBtn  = document.getElementById("connect-wallet-btn");
  const buyBtn      = document.getElementById("buy-pack-btn");
  const statusEl    = document.getElementById("pack-status");
  const packSelect  = document.getElementById("pack-select");
  const stepsWrap   = document.getElementById("pack-steps");
  const linksWrap   = document.getElementById("pack-links");

  if (!connectBtn || !buyBtn || !statusEl || !packSelect || !stepsWrap || !linksWrap) {
    console.warn("koop.js: Missing DOM elements. Check buy.html ids.");
    return;
  }

  let provider = null;
  let buyerPubkey = null;

  function setStatus(msg, good = false) {
    statusEl.style.color = good ? "#24e6b5" : "#9ca3af";
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
  updateBuyText();
  packSelect.addEventListener("change", updateBuyText);

  // === MULTI WALLET DETECTION ===
  function detectProviders() {
    const found = [];

    if (window.solana && typeof window.solana.connect === "function") {
      found.push({ name: labelProvider(window.solana), provider: window.solana });
    }
    if (window.solflare && typeof window.solflare.connect === "function") {
      found.push({ name: "Solflare", provider: window.solflare });
    }
    if (window.backpack && typeof window.backpack.connect === "function") {
      found.push({ name: "Backpack", provider: window.backpack });
    }
    if (window.phantom?.solana && typeof window.phantom.solana.connect === "function") {
      found.push({ name: labelProvider(window.phantom.solana), provider: window.phantom.solana });
    }

    const uniq = [];
    const seen = new Set();
    for (const item of found) {
      if (!seen.has(item.provider)) {
        seen.add(item.provider);
        uniq.push(item);
      }
    }
    return uniq;
  }

  function labelProvider(p) {
    if (p?.isPhantom) return "Phantom";
    if (p?.isSolflare) return "Solflare";
    if (p?.isBackpack) return "Backpack";
    if (p?.isOKXWallet) return "OKX Wallet";
    if (p?.isTrust) return "Trust Wallet";
    if (p?.isBitKeep) return "BitKeep";
    if (p?.isCoinbaseWallet) return "Coinbase Wallet";
    return "Solana Wallet";
  }

  async function pickProvider() {
    const providers = detectProviders();
    if (providers.length === 0) return null;
    if (providers.length === 1) return providers[0].provider;

    const list = providers.map((p, i) => `${i + 1}) ${p.name}`).join("\n");
    const choice = window.prompt(
      "Multiple wallets detected. Choose one:\n\n" + list + "\n\nType a number:"
    );
    const idx = Number(choice) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= providers.length) {
      return providers[0].provider;
    }
    return providers[idx].provider;
  }

  // === CONNECT ===
  connectBtn.addEventListener("click", async () => {
    try {
      provider = await pickProvider();
      if (!provider) {
        setStatus("No Solana wallet found. Open in Phantom/Solflare/Backpack browser or install a wallet.");
        return;
      }

      setStep(1);

      const resp = await provider.connect({ onlyIfTrusted: false });
      buyerPubkey = resp.publicKey || provider.publicKey;
      if (!buyerPubkey) throw new Error("Wallet connected but no publicKey returned.");

      buyBtn.disabled = false;
      connectBtn.textContent = "Wallet Connected";
      setStatus("Connected: " + buyerPubkey.toString(), true);
      setStep(2);
    } catch (e) {
      console.error(e);
      setStatus("Connect cancelled or failed.");
    }
  });

  // === BUY PACK (with balance pre-check) ===
  buyBtn.addEventListener("click", async () => {
    try {
      if (!provider || !buyerPubkey) {
        setStatus("Connect wallet first.");
        return;
      }

      linksWrap.style.display = "none";
      linksWrap.innerHTML = "";

      const PRICE_SOL = Number(packSelect.value);
      const lamportsToSend = Math.round(PRICE_SOL * LAMPORTS_PER_SOL);

      // ---- IMPORTANT PART ----
      // We check balance ONLY when user clicks Buy.
      // If insufficient: we stop here -> no Phantom popup -> no Phantom red warning.
      setStatus("Checking balance...");
      const { c: balConn, bal } = await getBalanceWithFallback(buyerPubkey);

      // fee cushion (0.00001 SOL)
      const feeCushion = Math.round(0.00001 * LAMPORTS_PER_SOL);
      const required = lamportsToSend + feeCushion;

      if (bal < required) {
        const balSol = bal / LAMPORTS_PER_SOL;
        const reqSol = required / LAMPORTS_PER_SOL;
        setStatus(
          `Not enough SOL. You have ${balSol.toFixed(4)} SOL, need ~${reqSol.toFixed(4)} SOL.`,
          false
        );
        return; // <-- stops before wallet sign. No Phantom warning.
      }
      // -------------------------

      buyBtn.disabled = true;
      setStep(2);
      setStatus("Preparing payment...");

      const { c: connection, blockhash, url } = await getBlockhashWithFallback();

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: buyerPubkey,
          toPubkey: CREATOR_WALLET,
          lamports: lamportsToSend
        })
      );

      tx.feePayer = buyerPubkey;
      tx.recentBlockhash = blockhash;

      setStatus("Using RPC: " + url + " — confirm payment in wallet...");

      const signed = await provider.signTransaction(tx);

      setStatus("Sending payment...");
      const paymentSig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(paymentSig, "confirmed");

      setStatus("Payment confirmed. CBS payout...");
      setStep(3);

      const r = await fetch(`${API_BASE}/api/koop-cbs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyer: buyerPubkey.toString(),
          signature: paymentSig,
          priceSol: PRICE_SOL
        })
      });

      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "Payout failed");

      const paymentLink = `https://solscan.io/tx/${paymentSig}`;
      linksWrap.innerHTML += `<a href="${paymentLink}" target="_blank" rel="noopener">Payment tx ↗</a>`;

      if (j.already) {
        setStatus("Already paid for this transaction ✅", true);
      } else {
        const payoutLink = `https://solscan.io/tx/${j.tx}`;
        linksWrap.innerHTML += `<a href="${payoutLink}" target="_blank" rel="noopener">Payout tx ↗</a>`;
        setStatus("Success ✅ CBS sent to your wallet.", true);
      }

      linksWrap.style.display = "flex";
      setStep(1);
    } catch (e) {
      console.error(e);
      setStatus("Error: " + (e.message || e));
    } finally {
      buyBtn.disabled = false;
    }
  });

})();
