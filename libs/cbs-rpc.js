/**
 * CBS public mainnet RPC configuration (browser-safe keys only).
 * Primary key matches Token Builder (token-builder.cbs-coin.com).
 */

export const RPC_BUSY_MSG = "RPC is busy. Please try again in a moment.";

export const FALLBACK_READ_RPC = "https://api.mainnet-beta.solana.com";

const DEFAULT_HELIUS_RPC =
  "https://mainnet.helius-rpc.com/?api-key=10bce36c-e0fb-405c-a924-7eb73eace1a4";

/** Primary Helius mainnet RPC — override via window or ?rpc= query if needed. */
export function getPrimaryRpcUrl() {
  if (typeof window !== "undefined") {
    const fromWindow =
      window.CBS_HELIUS_MAINNET_RPC ||
      window.CBS_HELIUS_RPC ||
      window.CBS_RPC_URL;
    if (typeof fromWindow === "string" && fromWindow.trim()) {
      return fromWindow.trim();
    }
    const fromQuery = new URLSearchParams(window.location.search).get("rpc");
    if (fromQuery?.trim()) return fromQuery.trim();
  }
  return DEFAULT_HELIUS_RPC;
}

export function getReadFallbackRpcUrl() {
  return FALLBACK_READ_RPC;
}

export function isRpcBusyError(error) {
  if (!error) return false;
  if (error.status === 429 || error.httpStatus === 429) return true;

  const parts = [
    error.message,
    error.cause?.message,
    error.cause?.code,
    error.code,
    typeof error === "string" ? error : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    parts.includes("429") ||
    parts.includes("too many requests") ||
    parts.includes("rate limit") ||
    parts.includes("max usage reached") ||
    parts.includes("rate limited")
  );
}

export function rpcBusyMessage(error) {
  return isRpcBusyError(error) ? RPC_BUSY_MSG : null;
}

/** JSON-RPC fetch with optional read fallback (Helius DAS excluded). */
export async function rpcPost(url, body, options = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...options,
  });

  if (res.status === 429) {
    const err = new Error(RPC_BUSY_MSG);
    err.status = 429;
    throw err;
  }

  const data = await res.json();
  const message = String(data?.error?.message || "").toLowerCase();
  if (
    message.includes("429") ||
    message.includes("max usage reached") ||
    message.includes("rate limit")
  ) {
    const err = new Error(RPC_BUSY_MSG);
    err.status = 429;
    err.rpcError = data.error;
    throw err;
  }

  return data;
}

/**
 * Run a read-only RPC call on primary, then public fallback once if busy.
 * Mint/send paths should NOT use this — primary only.
 */
export async function withReadRpcFallback(primaryUrl, fallbackUrl, fn) {
  try {
    return await fn(primaryUrl);
  } catch (primaryError) {
    if (!isRpcBusyError(primaryError) || primaryUrl === fallbackUrl) {
      throw primaryError;
    }
    try {
      return await fn(fallbackUrl);
    } catch (fallbackError) {
      if (isRpcBusyError(fallbackError)) throw new Error(RPC_BUSY_MSG);
      throw fallbackError;
    }
  }
}
