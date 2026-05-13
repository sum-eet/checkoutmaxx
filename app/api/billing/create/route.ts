export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PRD-3 — POST /api/billing/create
 * Body: { plan: "standard" | "plus" }
 * Managed Pricing app: returns redirect URL to Shopify's hosted plan picker.
 * appSubscriptionCreate mutation is forbidden for Managed Pricing apps.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";

export async function POST(req: NextRequest) {
  console.log("[PRD-3:billing/create] POST");

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-3:billing/create] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shopRow = await ensureShop(authed.shopDomain, authed.token);
  if (!shopRow) {
    console.warn("[PRD-3:billing/create] shop not found domain=%s", authed.shopDomain);
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }

  let body: { plan?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const plan = body?.plan;
  // Log requested plan for analytics (Managed Pricing UI handles the actual picker)
  console.log("[PRD-3:billing/create] plan requested=%s shopId=%s", plan, shopRow.id);

  const shopHandle = authed.shopDomain.replace(/\.myshopify\.com$/, "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE ?? "couponmaxx-coupon-tracking";
  const confirmationUrl = `https://admin.shopify.com/store/${shopHandle}/charges/${appHandle}/pricing_plans`;

  console.log("[PRD-3:billing/create] managed pricing redirect shopId=%s url=%s", shopRow.id, confirmationUrl);

  return NextResponse.json({ confirmationUrl });
}
