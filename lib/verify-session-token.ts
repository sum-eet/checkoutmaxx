import { createHmac } from "crypto";

/**
 * Verify an App Bridge session token (JWT signed with app secret).
 * Returns the shop domain if valid, null if invalid.
 */
export function verifySessionToken(token: string): string | null {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return null;

  try {
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    if (!headerB64 || !payloadB64 || !signatureB64) return null;

    const expected = createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");

    if (expected !== signatureB64) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    const dest = payload.dest || payload.iss || "";
    const match = dest.match(/https?:\/\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Get authenticated shop from request.
 * Tries session token first, falls back to query param.
 */
export function getShopFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const shop = verifySessionToken(auth.slice(7));
    if (shop) return shop;
  }

  const url = new URL(req.url);
  return url.searchParams.get("shop");
}
