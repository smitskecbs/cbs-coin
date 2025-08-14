// ...bovenaan blijft gelijk...
function corsHeaders(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST,OPTIONS",
    // voeg 'solana-client' toe:
    "access-control-allow-headers": "content-type,solana-client",
    "cache-control": "no-store",
    "content-type": "application/json",
  };
}
