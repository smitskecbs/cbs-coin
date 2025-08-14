export const config = { runtime: "edge" };

const ALLOW_ORIGINS = [
  "https://smitskecbs.github.io", // GitHub Pages
  // Voeg je Vercel domein toe als je de HTML daar ook host:
  // "https://<jouw-vercel-project>.vercel.app",
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

  const upstream = await fetch(
    `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_KEY}`,
    {
      method: req.method,
      headers: { "content-type": "application/json" },
      body,
    }
  );

  return new Response(upstream.body, {
    status: upstream.status,
    headers: corsHeaders(origin),
  });
}
