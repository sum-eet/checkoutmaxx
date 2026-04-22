import { createHmac } from "crypto";

export function verifySessionToken(token: string): string | null {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("[verifySessionToken] SHOPIFY_API_SECRET not set — cannot verify token");
    return null;
  }

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

// For authenticated admin routes — requires a valid session token.
// Never falls back to ?shop query param.
export function getAuthenticatedShop(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const shop = verifySessionToken(auth.slice(7));
    if (shop) return shop;
  }

  const url = new URL(req.url);

  const idToken = url.searchParams.get("id_token");
  if (idToken) {
    const shop = verifySessionToken(idToken);
    if (shop) return shop;
  }

  const hasAuth = !!req.headers.get("authorization");
  const hasIdToken = !!idToken;
  console.warn(
    "[getAuthenticatedShop] no valid token",
    { hasAuthHeader: hasAuth, hasIdTokenParam: hasIdToken, path: new URL(req.url).pathname },
  );
  return null;
}

// For public ingest endpoints — extracts ?shop from query param, no token verification.
// Separate validation (rate limiting, sanitization) lives in the ingest route.
export function getShopFromPublicRequest(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get("shop");
}

// Extract the raw session token JWT from the request.
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
