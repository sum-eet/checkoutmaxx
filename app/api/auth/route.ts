export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { shopify } from "@/lib/shopify";

const SCOPES = "read_orders,read_checkouts,write_pixels,read_analytics";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) return new Response("Missing shop", { status: 400 });

  const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
  if (!sanitizedShop) return new Response("Invalid shop", { status: 400 });

  // Generate a random state nonce for CSRF protection
  const state = crypto.randomUUID().replace(/-/g, "");
  // Derive host from the actual request — never trust env var for redirect_uri
  const host = req.nextUrl.host; // e.g. checkoutmaxx-rt55.vercel.app
  const redirectUri = `https://${host}/api/auth/callback`;

  console.log("[auth/begin]", { shop: sanitizedShop, redirectUri, apiKey: process.env.SHOPIFY_API_KEY?.slice(0, 8) });

  const authUrl =
    `https://${sanitizedShop}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_API_KEY}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  const response = NextResponse.redirect(authUrl);

  // Store state in a cookie to validate on callback
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 5, // 5 minutes
    path: "/",
  });

  return response;
}
