export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { shopify, sessionStorage } from "@/lib/shopify";

// GET /api/auth?shop=mystore.myshopify.com
// Begins the Shopify OAuth flow — redirects merchant to consent screen
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) {
    return NextResponse.json({ error: "Missing shop parameter" }, { status: 400 });
  }

  const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
  if (!sanitizedShop) {
    return NextResponse.json({ error: "Invalid shop parameter" }, { status: 400 });
  }

  const authRoute = await shopify.auth.begin({
    shop: sanitizedShop,
    callbackPath: "/api/auth/callback",
    isOnline: false,
    rawRequest: req,
    rawResponse: new Response(),
  });

  return NextResponse.redirect(authRoute);
}
