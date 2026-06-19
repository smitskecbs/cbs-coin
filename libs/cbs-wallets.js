/**
 * CBS wallet detection + connection layer
 * Ported from Token Builder (token-builder.cbs-coin.com):
 *   - src/solana/wallets.ts
 *   - src/solana/walletPublicKey.ts
 *   - main.ts wallet select / connect flow (yw, AE, Ou, NE)
 */
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "https://esm.sh/@solana/web3.js@1.95.3";

export const WALLET_PK_ERROR =
  "Wallet public key could not be read. Please reconnect your wallet.";
export const SIGNING_ERROR =
  "This wallet does not support the required signing method for minting.";

const SOLANA_CHAIN_PREFIX = "solana:";
const RESERVED_INJECTED_IDS = new Set(["phantom", "solflare", "backpack", "glow"]);
/** mint.html — injected-only signing (Phantom, Solflare, Backpack, Glow). */
const MINT_INJECTED_IDS = new Set(["phantom", "solflare", "backpack", "glow"]);
const walletStore = new Map();
const mintWalletStore = new Map();

let walletStandardApi = null;
const registeredStandardWallets = new Set();
let cachedStandardWalletList = null;
const walletStandardListeners = { register: [], unregister: [] };

/* ===== walletPublicKey.ts ===== */

export function describePublicKeyType(publicKey) {
  if (publicKey == null) return "undefined";
  if (typeof publicKey === "string") return "string";
  if (publicKey instanceof PublicKey) return "PublicKey";
  if (publicKey instanceof Uint8Array) return "Uint8Array";
  return publicKey.constructor?.name ?? typeof publicKey;
}

export function normalizePublicKeyBase58(publicKey) {
  if (publicKey == null) throw new Error(WALLET_PK_ERROR);
  if (typeof publicKey === "string") {
    const trimmed = publicKey.trim();
    if (trimmed.startsWith("0x")) throw new Error(WALLET_PK_ERROR);
    try {
      return new PublicKey(trimmed).toBase58();
    } catch {
      throw new Error(WALLET_PK_ERROR);
    }
  }
  if (publicKey instanceof PublicKey) return publicKey.toBase58();
  if (publicKey instanceof Uint8Array) {
    try {
      return new PublicKey(publicKey).toBase58();
    } catch {
      throw new Error(WALLET_PK_ERROR);
    }
  }
  const value = publicKey;
  if (typeof value.toBase58 === "function") {
    try {
      const encoded = value.toBase58();
      if (typeof encoded === "string") return new PublicKey(encoded).toBase58();
    } catch {}
  }
  if (typeof value.address === "string" && value.address.trim()) {
    return normalizePublicKeyBase58(value.address);
  }
  if (typeof value.toString === "function") {
    try {
      const text = value.toString();
      if (typeof text === "string" && text !== "[object Object]") {
        return normalizePublicKeyBase58(text);
      }
    } catch {}
  }
  throw new Error(WALLET_PK_ERROR);
}

export function toPublicKey(publicKey) {
  return new PublicKey(normalizePublicKeyBase58(publicKey));
}

export function getProviderAddress(provider) {
  if (!provider?.publicKey) return null;
  try {
    return normalizePublicKeyBase58(provider.publicKey);
  } catch {
    return null;
  }
}

export async function connectProvider(provider, options) {
  if (typeof provider.connect !== "function") throw new Error(WALLET_PK_ERROR);
  const result = await provider.connect(options);
  return normalizePublicKeyBase58(result.publicKey);
}

/** Public-key normalization only — native provider methods are not replaced or re-wrapped. */
export function wrapMintProviderPublicKey(provider) {
  return new Proxy(provider, {
    get(target, prop) {
      if (prop === "publicKey") {
        if (!target.publicKey) return undefined;
        try {
          return toPublicKey(target.publicKey);
        } catch {
          return undefined;
        }
      }
      if (prop === "connect") {
        return async function connect(options) {
          if (typeof target.connect !== "function") throw new Error(WALLET_PK_ERROR);
          const result = await target.connect(options);
          return { publicKey: toPublicKey(result.publicKey) };
        };
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function wrapProviderForStablePublicKey(provider) {
  return wrapMintProviderPublicKey(provider);
}

export function inspectProviderPublicKey(provider) {
  const rawPublicKeyType = describePublicKeyType(provider.publicKey);
  let normalizedPublicKey = null;
  try {
    if (provider.publicKey) normalizedPublicKey = normalizePublicKeyBase58(provider.publicKey);
  } catch {
    normalizedPublicKey = null;
  }
  return { rawPublicKeyType, normalizedPublicKey };
}

/* ===== wallets.ts helpers ===== */

export function getWalletChain() {
  return "solana:mainnet";
}

function hasConnect(provider) {
  return typeof provider.connect === "function";
}

function isValidBase58Address(value) {
  const text = value.trim();
  if (!text || text.startsWith("0x")) return false;
  return text.length >= 32 && text.length <= 44;
}

function isMetaMaskProvider(provider) {
  return Boolean(provider.isMetaMask);
}

function ensureSignTransactionCapability(provider) {
  const wrapped = wrapSignTransactionCapability(provider);
  return (
    typeof wrapped.signTransaction === "function" ||
    typeof wrapped.signAndSendTransaction === "function"
  );
}

function hasValidProviderPublicKey(provider) {
  if (!provider.publicKey) return true;
  try {
    return isValidBase58Address(normalizePublicKeyBase58(provider.publicKey));
  } catch {
    return false;
  }
}

function isUsableInjectedProvider(provider) {
  if (isMetaMaskProvider(provider) || !hasConnect(provider) || !hasValidProviderPublicKey(provider)) {
    return false;
  }
  return ensureSignTransactionCapability(provider);
}

function wrapSignTransactionCapability(provider) {
  if (typeof provider.signTransaction === "function") return provider;
  if (typeof provider.signAllTransactions === "function") {
    return {
      ...provider,
      signTransaction: async (transaction) =>
        (await provider.signAllTransactions([transaction]))[0],
    };
  }
  return provider;
}

export function providerCanSign(provider) {
  return typeof wrapSignTransactionCapability(provider).signTransaction === "function";
}

function isSolanaStandardAccount(account) {
  if (!isValidBase58Address(account.address)) return false;
  if (!account.chains || account.chains.length === 0) return true;
  return account.chains.some((chain) => chain.startsWith(SOLANA_CHAIN_PREFIX));
}

function walletStandardSupportsSolana(wallet) {
  return (
    "solana:signTransaction" in wallet.features ||
    "solana:signAndSendTransaction" in wallet.features
  );
}

function isEthereumOnlyWalletStandard(wallet) {
  if (walletStandardSupportsSolana(wallet)) return false;
  const hasEvm = Object.keys(wallet.features).some(
    (feature) => feature.startsWith("eip155:") || feature.startsWith("ethereum:")
  );
  if (!hasEvm) return false;
  if (wallet.accounts.length === 0) return true;
  return wallet.accounts.every((account) => {
    if (account.address.trim().startsWith("0x")) return true;
    return account.chains?.every((chain) => chain.startsWith("eip155:")) ?? false;
  });
}

function isSupportedWalletStandard(wallet) {
  if (!("standard:connect" in wallet.features) || !walletStandardSupportsSolana(wallet)) {
    return false;
  }
  if (isEthereumOnlyWalletStandard(wallet)) return false;
  if (
    wallet.accounts.length > 0 &&
    !wallet.accounts.some(isSolanaStandardAccount) &&
    !walletStandardSupportsSolana(wallet)
  ) {
    return false;
  }
  return true;
}

function walletStandardId(wallet) {
  const slug = wallet.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.includes("metamask") ? "metamask-solana" : `ws-${slug}`;
}

function serializeTransactionBytes(transaction) {
  if (transaction instanceof Uint8Array) return transaction;
  if (transaction instanceof Transaction) {
    return transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  }
  if (transaction instanceof VersionedTransaction) {
    return transaction.serialize();
  }
  const value = transaction;
  if (typeof value.serialize === "function") {
    const bytes = value.serialize();
    if (bytes instanceof Uint8Array) return bytes;
  }
  throw new Error(SIGNING_ERROR);
}

/** Token Builder Qu — restore wallet-signed bytes to the original tx type. */
function restoreSignedTransaction(original, signedBytes) {
  if (original instanceof Transaction) return Transaction.from(signedBytes);
  if (original instanceof VersionedTransaction) {
    return VersionedTransaction.deserialize(signedBytes);
  }
  if (typeof original === "object" && original) {
    return Object.assign({}, original, {
      serialize() {
        return signedBytes;
      },
    });
  }
  return signedBytes;
}

function transactionHasNonEmptySignature(transaction) {
  if (!transaction?.signatures) return false;
  if (Array.isArray(transaction.signatures)) {
    return transaction.signatures.some((entry) => {
      if (entry == null) return false;
      if (entry instanceof Uint8Array) return entry.some((byte) => byte !== 0);
      if (typeof entry === "object" && entry.signature instanceof Uint8Array) {
        return entry.signature.some((byte) => byte !== 0);
      }
      return false;
    });
  }
  return false;
}

/**
 * Stable publicKey + signTransaction round-trip for Metaplex UMI walletAdapterIdentity.
 * Ensures Wallet Standard and injected wallets return real signed web3 transactions.
 */
export function wrapProviderForUmiIdentity(provider) {
  const stable = wrapProviderForStablePublicKey(provider);
  const innerSign = provider.signTransaction?.bind(provider);
  const innerSignAll = provider.signAllTransactions?.bind(provider);

  if (typeof innerSign !== "function") return stable;

  async function normalizeSignedTransaction(original, signed) {
    if (signed instanceof Transaction || signed instanceof VersionedTransaction) {
      return signed;
    }
    if (typeof signed?.serialize === "function") {
      try {
        const bytes = signed.serialize();
        if (bytes instanceof Uint8Array) {
          return restoreSignedTransaction(original, bytes);
        }
      } catch {}
    }
    return signed;
  }

  return {
    ...stable,
    async signTransaction(transaction) {
      const signed = await innerSign(transaction);
      return normalizeSignedTransaction(transaction, signed);
    },
    async signAllTransactions(transactions) {
      if (typeof innerSignAll === "function") {
        const signedList = await innerSignAll(transactions);
        return signedList.map((signed, index) =>
          normalizeSignedTransaction(transactions[index], signed)
        );
      }
      const signedList = [];
      for (const transaction of transactions) {
        signedList.push(await normalizeSignedTransaction(transaction, await innerSign(transaction)));
      }
      return signedList;
    },
  };
}

export function debugWalletProvider(provider, meta = {}) {
  const inspect = inspectProviderPublicKey(provider);
  return {
    ...meta,
    rawPublicKeyType: inspect.rawPublicKeyType,
    normalizedPublicKey: inspect.normalizedPublicKey,
    hasSignTransaction: typeof provider?.signTransaction === "function",
    hasSignAndSendTransaction: typeof provider?.signAndSendTransaction === "function",
  };
}

export async function debugSignedTransaction(provider, transaction) {
  if (typeof provider?.signTransaction !== "function") {
    return { signed: false, reason: "no signTransaction" };
  }
  const signed = await provider.signTransaction(transaction);
  return {
    signed: transactionHasNonEmptySignature(signed),
    type:
      signed instanceof VersionedTransaction
        ? "VersionedTransaction"
        : signed instanceof Transaction
          ? "Transaction"
          : signed?.constructor?.name ?? typeof signed,
  };
}

function providerFromWalletStandard(wallet) {
  const features = wallet.features;
  const connectFeature = features["standard:connect"];
  const signTransactionFeature = features["solana:signTransaction"];
  const signAndSendFeature = features["solana:signAndSendTransaction"];
  if (!connectFeature || (!signTransactionFeature && !signAndSendFeature)) return null;

  let activeAccount = wallet.accounts[0];
  const adapter = {
    async connect(options) {
      activeAccount =
        (await connectFeature.connect({ silent: options?.onlyIfTrusted })).accounts[0] ??
        wallet.accounts[0];
      if (!activeAccount) throw new Error("No wallet account returned.");
      return { publicKey: { toString: () => activeAccount.address } };
    },
    get publicKey() {
      const account = activeAccount ?? wallet.accounts[0];
      if (!account) return undefined;
      return { toString: () => account.address };
    },
    async signTransaction(transaction) {
      if (!signTransactionFeature) throw new Error(SIGNING_ERROR);
      const account = activeAccount ?? wallet.accounts[0];
      if (!account) throw new Error("No wallet account selected.");
      const outputs = await signTransactionFeature.signTransaction({
        account,
        transaction: serializeTransactionBytes(transaction),
        chain: getWalletChain(),
      });
      return restoreSignedTransaction(transaction, outputs[0].signedTransaction);
    },
    async signAllTransactions(transactions) {
      const signed = [];
      for (const transaction of transactions) {
        signed.push(await adapter.signTransaction(transaction));
      }
      return signed;
    },
    async signAndSendTransaction(transaction) {
      if (!signAndSendFeature) throw new Error(SIGNING_ERROR);
      const account = activeAccount ?? wallet.accounts[0];
      if (!account) throw new Error("No wallet account selected.");
      const signature = (
        await signAndSendFeature.signAndSendTransaction({
          account,
          transaction: serializeTransactionBytes(transaction),
          chain: getWalletChain(),
        })
      )[0].signature;
      return {
        signature: typeof signature === "string" ? signature : Buffer.from(signature).toString("base64"),
      };
    },
  };

  return wrapSignTransactionCapability(adapter);
}

function walletDedupKey(entry) {
  const name = entry.name.toLowerCase();
  const id = entry.id.toLowerCase();
  if (name.includes("phantom") || id.includes("phantom")) return "phantom";
  if (name.includes("solflare") || id.includes("solflare")) return "solflare";
  if (name.includes("backpack") || id.includes("backpack")) return "backpack";
  if (name.includes("glow") || id.includes("glow")) return "glow";
  if (name.includes("metamask") || id.includes("metamask")) return "metamask";
  return name.replace(/[^a-z0-9]+/g, "-");
}

function sourcePriority(entry) {
  // Prefer native injected extensions for known wallets — UMI walletAdapterIdentity
  // expects real web3.js Transaction / VersionedTransaction objects from signTransaction.
  if (entry.source === "injected" && RESERVED_INJECTED_IDS.has(entry.id)) return 0;
  if (entry.source === "wallet-standard") return 1;
  return 2;
}

function stableWalletId(bucket, entry) {
  switch (bucket) {
    case "phantom": return "phantom";
    case "solflare": return "solflare";
    case "backpack": return "backpack";
    case "glow": return "glow";
    case "metamask": return "metamask-solana";
    default: return entry.id;
  }
}

function shouldReplaceWallet(existing, candidate) {
  return sourcePriority(candidate) < sourcePriority(existing);
}

function finalizeWalletEntry(entry, bucket) {
  return {
    ...entry,
    id: stableWalletId(bucket, entry),
    provider: wrapProviderForStablePublicKey(entry.provider),
  };
}

function mergeWalletEntry(entry, map) {
  const bucket = walletDedupKey(entry);
  const current = map.get(bucket);
  if (!current || shouldReplaceWallet(current, entry)) {
    map.set(bucket, finalizeWalletEntry(entry, bucket));
  }
}

function createInjectedWallet(id, name, provider) {
  if (!RESERVED_INJECTED_IDS.has(id) || !provider || !isUsableInjectedProvider(provider)) return null;
  return {
    id,
    name,
    provider: wrapSignTransactionCapability(provider),
    source: "injected",
  };
}

function readGenericSolanaInjector() {
  const provider = window.solana;
  if (!provider || !hasConnect(provider)) return null;
  if (provider.isPhantom) return createInjectedWallet("phantom", "Phantom", provider);
  if (provider.isSolflare) return createInjectedWallet("solflare", "Solflare", provider);
  if (provider.isBackpack) return createInjectedWallet("backpack", "Backpack", provider);
  if (provider.isGlow) return createInjectedWallet("glow", "Glow", provider);
  return null;
}

function readGlowProvider() {
  const glow = window.glow;
  if (!glow) return null;
  return glow.solana === undefined ? glow : glow.solana;
}

function discoverInjectedWallets() {
  const wallets = [];
  const candidates = [
    createInjectedWallet("phantom", "Phantom", window.phantom?.solana),
    createInjectedWallet("solflare", "Solflare", window.solflare),
    createInjectedWallet("backpack", "Backpack", window.backpack?.solana),
    createInjectedWallet("glow", "Glow", readGlowProvider()),
    readGenericSolanaInjector(),
  ];
  for (const wallet of candidates) {
    if (wallet) wallets.push(wallet);
  }
  return wallets;
}

function getWalletStandardWallets() {
  return getWalletStandardApi().get();
}

function discoverWalletStandardWallets() {
  const wallets = [];
  for (const wallet of getWalletStandardWallets()) {
    if (!isSupportedWalletStandard(wallet)) continue;
    const provider = providerFromWalletStandard(wallet);
    if (!provider || !ensureSignTransactionCapability(provider)) continue;
    wallets.push({
      id: walletStandardId(wallet),
      name: wallet.name,
      provider,
      source: "wallet-standard",
    });
  }
  return wallets;
}

export function discoverAllWallets() {
  walletStore.clear();
  const merged = new Map();
  for (const wallet of discoverInjectedWallets()) mergeWalletEntry(wallet, merged);
  for (const wallet of discoverWalletStandardWallets()) mergeWalletEntry(wallet, merged);
  for (const wallet of merged.values()) walletStore.set(wallet.id, wallet);
  return Array.from(walletStore.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function readMintInjectedProvider(id) {
  switch (id) {
    case "phantom":
      return window.phantom?.solana ?? null;
    case "solflare":
      return window.solflare ?? null;
    case "backpack":
      return window.backpack?.solana ?? null;
    case "glow":
      return readGlowProvider();
    default:
      return null;
  }
}

/**
 * mint.html wallet list — injected extensions only; Wallet Standard is never used for signing.
 */
export function discoverMintWallets() {
  mintWalletStore.clear();
  const wallets = [];
  for (const id of MINT_INJECTED_IDS) {
    const rawProvider = readMintInjectedProvider(id);
    if (!rawProvider || !isUsableInjectedProvider(rawProvider)) continue;
    const name =
      id === "phantom"
        ? "Phantom"
        : id === "solflare"
          ? "Solflare"
          : id === "backpack"
            ? "Backpack"
            : "Glow";
    const entry = {
      id,
      name,
      source: "injected",
      rawProvider,
      provider: wrapMintProviderPublicKey(rawProvider),
    };
    mintWalletStore.set(id, entry);
    wallets.push(entry);
  }
  return wallets.sort((a, b) => a.name.localeCompare(b.name));
}

/** Optional UI hint — WS wallets may exist but are not used on mint.html. */
export function countWalletStandardWallets() {
  return discoverWalletStandardWallets().length;
}

export function getMintWalletById(walletId) {
  if (mintWalletStore.size === 0) discoverMintWallets();
  return mintWalletStore.get(walletId);
}

export function getMintWalletProvider(walletId) {
  return getMintWalletById(walletId)?.provider ?? null;
}

export function getMintRawProvider(walletId) {
  return getMintWalletById(walletId)?.rawProvider ?? null;
}

export function describeTransactionSignStatus(transaction) {
  const txClass =
    transaction instanceof VersionedTransaction
      ? "VersionedTransaction"
      : transaction instanceof Transaction
        ? "Transaction"
        : transaction?.constructor?.name ?? typeof transaction;
  const signatures = transaction?.signatures;
  if (!Array.isArray(signatures)) {
    return { txClass, signatureCount: 0, hasNonEmptySignature: false };
  }
  const hasNonEmptySignature = signatures.some((entry) => {
    if (entry == null) return false;
    if (entry instanceof Uint8Array) return entry.some((byte) => byte !== 0);
    if (typeof entry === "object" && entry.signature instanceof Uint8Array) {
      return entry.signature.some((byte) => byte !== 0);
    }
    return false;
  });
  return { txClass, signatureCount: signatures.length, hasNonEmptySignature };
}

export function getWalletById(walletId) {
  if (walletStore.size === 0) discoverAllWallets();
  return walletStore.get(walletId);
}

export function getWalletProvider(walletId) {
  return getWalletById(walletId)?.provider;
}

function addStandardWallet(wallet) {
  cachedStandardWalletList = null;
  registeredStandardWallets.add(wallet);
}

function removeStandardWallet(wallet) {
  cachedStandardWalletList = null;
  registeredStandardWallets.delete(wallet);
}

function runWalletStandardListener(type, callback) {
  try {
    callback();
  } catch (error) {
    console.error(error);
  }
}

function getWalletStandardApi() {
  if (walletStandardApi) return walletStandardApi;

  const registerWallets = (...wallets) => {
    const fresh = wallets.filter((wallet) => !registeredStandardWallets.has(wallet));
    if (!fresh.length) return () => {};
    fresh.forEach(addStandardWallet);
    walletStandardListeners.register.forEach((listener) =>
      runWalletStandardListener("register", () => listener(...fresh))
    );
    return () => {
      fresh.forEach(removeStandardWallet);
      walletStandardListeners.unregister.forEach((listener) =>
        runWalletStandardListener("unregister", () => listener(...fresh))
      );
    };
  };

  walletStandardApi = Object.freeze({
    register: registerWallets,
    get() {
      return (cachedStandardWalletList ??= [...registeredStandardWallets]);
    },
    on(event, listener) {
      walletStandardListeners[event]?.push(listener);
      return () => {
        walletStandardListeners[event] = walletStandardListeners[event]?.filter((item) => item !== listener);
      };
    },
  });

  if (typeof window !== "undefined") {
    const eventApi = Object.freeze({ register: registerWallets });
    try {
      window.addEventListener("wallet-standard:register-wallet", ({ detail }) => detail(eventApi));
    } catch (error) {
      console.error("wallet-standard:register-wallet listener could not be added", error);
    }
    try {
      window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: eventApi }));
    } catch (error) {
      console.error("wallet-standard:app-ready could not be dispatched", error);
    }
  }

  return walletStandardApi;
}

export function subscribeWalletUpdates(onChange) {
  const api = getWalletStandardApi();
  const unregister = api.on("register", onChange);
  const ununregister = api.on("unregister", onChange);
  return () => {
    if (typeof unregister === "function") unregister();
    if (typeof ununregister === "function") ununregister();
  };
}

export function assertWalletCanSign(provider) {
  if (providerCanSign(provider)) return true;
  throw new Error(SIGNING_ERROR);
}

export async function connectAndNormalizeAddress(provider, options = {}) {
  let address = getProviderAddress(provider);
  if (options.storedAddress && address && options.storedAddress !== address) {
    address = null;
  }
  if (!address || options.forceReconnect) {
    address = await connectProvider(provider, { onlyIfTrusted: options.onlyIfTrusted });
  }
  return address;
}
