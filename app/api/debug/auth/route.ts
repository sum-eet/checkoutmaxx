export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShop, getSessionTokenFromRequest, verifySessionToken } from "@/lib/verify-session-token";

/**
 * Debug endpoint — shows what auth info is available in the request.
 * Hit this from browser to see if session tokens are arriving.
 * REMOVE BEFORE PRODUCTION LAUNCH.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const shopFromToken = (() => {
    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) return verifySessionToken(auth.slice(7));
    const idToken = url.searchParams.get("id_token");
    if (idToken) return verifySessionToken(idToken);
    return null;
  })();

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    shopFromRequest: getAuthenticatedShop(req),
    shopFromToken,
    hasSessionToken: !!getSessionTokenFromRequest(req),
    hasIdTokenParam: !!url.searchParams.get("id_token"),
    hasShopParam: !!url.searchParams.get("shop"),
    shopParam: url.searchParams.get("shop"),
    hasAuthHeader: !!req.headers.get("authorization"),
    idTokenFirst20: url.searchParams.get("id_token")?.slice(0, 20) ?? null,
    envCheck: {
      hasApiKey: !!process.env.SHOPIFY_API_KEY,
      hasApiSecret: !!process.env.SHOPIFY_API_SECRET,
      apiKeyFirst8: process.env.SHOPIFY_API_KEY?.slice(0, 8) ?? null,
      appUrl: process.env.SHOPIFY_APP_URL ?? null,
    },
  });
}
