export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PRD-3 — POST /api/billing/cancel
 * Cancels the active Shopify app subscription.
 * billingPlan stays until currentPeriodEnd webhook fires (EXPIRED → free).
 */

import { NextRequest, NextResponse } from "next/server";
import { Session } from "@shopify/shopify-api";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { prisma } from "@/lib/prisma";
import { shopify } from "@/lib/shopify";

const CANCEL_SUBSCRIPTION_MUTATION = `
  mutation appSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      userErrors { field message }
      appSubscription { id status }
    }
  }
`;

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

  const shop = await prisma.shop.findUnique({
    where: { id: shopRow.id },
    select: { subscriptionId: true, subscriptionStatus: true },
  });

  if (!shop?.subscriptionId) {
    console.log("[PRD-3:billing/cancel] no active subscription shopId=%s", shopRow.id);
    return NextResponse.json({ error: "no_active_subscription" }, { status: 400 });
  }

  const session = new Session({
    id: `offline_${authed.shopDomain}`,
    shop: authed.shopDomain,
    state: "installed",
    isOnline: false,
    accessToken: shopRow.accessToken,
  });
  const client = new shopify.clients.Graphql({ session });

  try {
    const res = await (client as any).request(CANCEL_SUBSCRIPTION_MUTATION, {
      variables: { id: shop.subscriptionId },
    });
    const data = (res.data as any)?.appSubscriptionCancel;
    const userErrors = data?.userErrors ?? [];
    if (userErrors.length > 0) {
      console.error("[PRD-3:billing/cancel] userErrors:", JSON.stringify(userErrors));
      return NextResponse.json({ error: "shopify_error", details: userErrors }, { status: 500 });
    }
    console.log(
      "[PRD-3:billing/cancel] cancelled subId=%s shopId=%s",
      shop.subscriptionId,
      shopRow.id,
    );
  } catch (err: any) {
    console.error("[PRD-3:billing/cancel] graphql error:", err?.message);
    return NextResponse.json({ error: "graphql_error", message: err?.message }, { status: 500 });
  }

  // Mark as CANCELLED but keep billingPlan until EXPIRED webhook fires
  await prisma.shop.update({
    where: { id: shopRow.id },
    data: { subscriptionStatus: "CANCELLED" },
  });

  console.log("[PRD-3:billing/cancel] done shopId=%s", shopRow.id);
  return NextResponse.json({ ok: true });
}
