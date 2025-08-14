export const config = { runtime: "edge" };

// Sta alleen jouw sites toe (CORS)
const ALLOW_ORIGINS = [
  "https://smitskecbs.github.io",        // jouw GitHub Pages
  "https://cbs-coin.vercel.app",         // jouw Vercel domein
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

function corsHeaders(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
    "content-type": "application/json",
  };
}

export default async function handler(req) {
  const origin = req.headers.get("origin") || "";

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const body = req.method === "GET" ? undefined : await req.text();

  // Belangrijk: zet in Vercel een env var HELIUS_KEY met je Helius API key
  const url = `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_KEY}`;

  const upstream = await fetch(url, {
    method: req.method,
    headers: { "content-type": "application/json" },
    body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: corsHeaders(origin),
  });
}
