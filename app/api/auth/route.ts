export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { shopify } from "@/lib/shopify";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) return new Response("Missing shop", { status: 400 });

  const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
  if (!sanitizedShop) return new Response("Invalid shop", { status: 400 });

  console.log("[auth/begin] shop:", sanitizedShop);

  // web-api adapter returns a Response directly
  return shopify.auth.begin({
    shop: sanitizedShop,
    callbackPath: "/api/auth/callback",
    isOnline: false,
    rawRequest: req,
  }) as unknown as Response;
}
