export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { shopify } from "@/lib/shopify";

// GET /api/auth?shop=mystore.myshopify.com
// Begins the Shopify OAuth flow — returns a redirect Response
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) {
    return new Response("Missing shop parameter", { status: 400 });
  }

  const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
  if (!sanitizedShop) {
    return new Response("Invalid shop parameter", { status: 400 });
  }

  // web-api adapter: auth.begin returns a Response directly
  return shopify.auth.begin({
    shop: sanitizedShop,
    callbackPath: "/api/auth/callback",
    isOnline: false,
    rawRequest: req,
  }) as unknown as Response;
}
