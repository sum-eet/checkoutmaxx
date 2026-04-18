import { createHmac } from "crypto";

/**
 * Verify an App Bridge session token (JWT signed with app secret).
 * Returns the shop domain if valid, null if invalid.
 */
export function verifySessionToken(token: string): string | null {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("[verifySessionToken] SHOPIFY_API_SECRET not set — cannot verify token");
    return null;
  }

  // Log first 4 chars of secret for cross-env eyeball comparison (never log full secret)
  const secretHint = secret.slice(0, 4);

  try {
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    if (!headerB64 || !payloadB64 || !signatureB64) {
      console.warn("[verifySessionToken] malformed token — missing header/payload/signature segments");
      return null;
    }

    const expected = createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");

    if (expected !== signatureB64) {
      console.warn(`[verifySessionToken] hmac_mismatch secret_hint=${secretHint} — wrong SHOPIFY_API_SECRET for this Vercel project?`);
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

    if (payload.exp && Date.now() / 1000 > payload.exp) {
      console.warn("[verifySessionToken] token expired exp=%s now=%s", payload.exp, Math.floor(Date.now() / 1000));
      return null;
    }

    const dest = payload.dest || payload.iss || "";
    if (!dest) {
      console.warn("[verifySessionToken] missing dest/iss claim in token payload");
      return null;
    }

    const match = dest.match(/https?:\/\/([^/]+)/);
    if (!match) {
      console.warn("[verifySessionToken] dest claim has no recognizable domain: %s", dest);
      return null;
    }

    return match[1];
  } catch (err: any) {
    console.error("[verifySessionToken] unexpected error:", err.message);
    return null;
  }
}

/**
 * Get authenticated shop from request.
 * Tries session token first, falls back to query param.
 */
export function getShopFromRequest(req: Request): string | null {
  // 1. Try Authorization header
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const shop = verifySessionToken(auth.slice(7));
    if (shop) return shop;
  }

  const url = new URL(req.url);

  // 2. Try id_token from URL (App Bridge 4.x passes it here)
  const idToken = url.searchParams.get("id_token");
  if (idToken) {
    const shop = verifySessionToken(idToken);
    if (shop) return shop;
  }

  // 3. Fallback to shop query param
  return url.searchParams.get("shop");
}

/**
 * Extract the raw session token JWT from the request.
 * Returns null if no valid token found.
 * Used by ensureShop() for token exchange.
 */
export function getSessionTokenFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    if (verifySessionToken(token)) return token;
  }

  const url = new URL(req.url);
  const idToken = url.searchParams.get("id_token");
  if (idToken && verifySessionToken(idToken)) return idToken;

  return null;
}
