export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PRD-3 — POST /api/billing/cancel
 * Managed Pricing app: returns redirect URL to Shopify's hosted plan picker.
 * appSubscriptionCancel mutation is forbidden for Managed Pricing apps.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";

export async function POST(req: NextRequest) {
  console.log("[PRD-3:billing/cancel] POST");

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-3:billing/cancel] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shopRow = await ensureShop(authed.shopDomain, authed.token);
  if (!shopRow) {
    console.warn("[PRD-3:billing/cancel] shop not found domain=%s", authed.shopDomain);
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }

  const shopHandle = authed.shopDomain.replace(/\.myshopify\.com$/, "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE ?? "couponmaxx-coupon-tracking";
  const confirmationUrl = `https://admin.shopify.com/store/${shopHandle}/charges/${appHandle}/pricing_plans`;

  console.log("[PRD-3:billing/cancel] managed pricing redirect shopId=%s url=%s", shopRow.id, confirmationUrl);

  return NextResponse.json({ confirmationUrl });
}
