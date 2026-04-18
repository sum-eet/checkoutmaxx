let checked = false;

/**
 * Boot-time env validator. Called from lib/shopify.ts module load.
 * Throws loud if any required Shopify env var is missing.
 * Logs app identity on first cold start for cross-env verification.
 * Never logs raw SHOPIFY_API_SECRET.
 */
export function envCheck(): void {
  if (checked) return;
  checked = true;

  const key = process.env.SHOPIFY_API_KEY;
  const secret = process.env.SHOPIFY_API_SECRET;
  const url = process.env.SHOPIFY_APP_URL;

  const missing: string[] = [];
  if (!key || key === "build-placeholder") missing.push("SHOPIFY_API_KEY");
  if (!secret || secret === "build-placeholder") missing.push("SHOPIFY_API_SECRET");
  if (!url || url === "build-placeholder") missing.push("SHOPIFY_APP_URL");

  if (missing.length > 0) {
    const msg = `[env-check] MISSING or placeholder: ${missing.join(", ")}`;
    console.error(msg);
    throw new Error(msg);
  }

  // Log app identity for cold-start tracing (last 4 of API key, never secret)
  const keyLast4 = key!.slice(-4);
  console.log(`[env] app=${keyLast4} url=${url}`);
}
