export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PRD-3 — GET /api/billing/callback?plan=<plan>&charge_id=<id>
 * Shopify redirects here after merchant approves/declines the charge.
 * Queries the subscription status and activates the billing plan.
 */

import { NextRequest, NextResponse } from "next/server";
import { Session } from "@shopify/shopify-api";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { prisma } from "@/lib/prisma";
import { shopify } from "@/lib/shopify";

const APP_URL = process.env.SHOPIFY_APP_URL ?? "https://couponmaxx.vercel.app";

const SUBSCRIPTION_QUERY = `
  query getSubscription($id: ID!) {
    node(id: $id) {
      ... on AppSubscription {
        id
        status
        currentPeriodEnd
        trialDays
        createdAt
      }
    }
  }
`;

export async function GET(req: NextRequest) {
  console.log("[PRD-3:billing/callback] GET url=%s", req.url);

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-3:billing/callback] unauthorized");
    return NextResponse.redirect(`${APP_URL}/checkoutlens/billing?error=unauthorized`);
  }

  const shopRow = await ensureShop(authed.shopDomain, authed.token);
  if (!shopRow) {
    console.warn("[PRD-3:billing/callback] shop not found domain=%s", authed.shopDomain);
    return NextResponse.redirect(`${APP_URL}/checkoutlens/billing?error=shop_not_found`);
  }

  const { searchParams } = new URL(req.url);
  const plan = searchParams.get("plan");

  if (!plan || (plan !== "standard" && plan !== "plus")) {
    console.warn("[PRD-3:billing/callback] invalid plan param=%s", plan);
    return NextResponse.redirect(`${APP_URL}/checkoutlens/billing?error=invalid_plan`);
  }

  const shop = await prisma.shop.findUnique({
    where: { id: shopRow.id },
    select: { subscriptionId: true },
  });

  if (!shop?.subscriptionId) {
    console.warn("[PRD-3:billing/callback] no subscriptionId in DB shopId=%s", shopRow.id);
    return NextResponse.redirect(`${APP_URL}/checkoutlens/billing?error=no_subscription`);
  }

  // Query Shopify for subscription status
  const session = new Session({
    id: `offline_${authed.shopDomain}`,
    shop: authed.shopDomain,
    state: "installed",
    isOnline: false,
    accessToken: shopRow.accessToken,
  });
  const client = new shopify.clients.Graphql({ session });

  let status: string;
  let currentPeriodEnd: string | null = null;
  let createdAt: string | null = null;
  try {
    const res = await (client as any).request(SUBSCRIPTION_QUERY, {
      variables: { id: shop.subscriptionId },
    });
    const node = (res.data as any)?.node;
    status = node?.status;
    currentPeriodEnd = node?.currentPeriodEnd ?? null;
    createdAt = node?.createdAt ?? null;
    console.log(
      "[PRD-3:billing/callback] subscription status=%s subId=%s shopId=%s",
      status,
      shop.subscriptionId,
      shopRow.id,
    );
  } catch (err: any) {
    console.error("[PRD-3:billing/callback] graphql error:", err?.message);
    return NextResponse.redirect(`${APP_URL}/checkoutlens/billing?error=query_failed`);
  }

  if (status === "ACTIVE") {
    // Mirror trialEndsAt = createdAt + 14 days (Shopify owns the real clock)
    const trialEndsAt = createdAt
      ? new Date(new Date(createdAt).getTime() + 14 * 24 * 60 * 60 * 1000)
      : null;

    await prisma.shop.update({
      where: { id: shopRow.id },
      data: {
        billingPlan: plan,
        subscriptionStatus: "ACTIVE",
        currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : undefined,
        trialEndsAt: trialEndsAt ?? undefined,
        planChangedAt: new Date(),
      },
    });
    console.log("[PRD-3:billing/callback] ACTIVATED plan=%s shopId=%s", plan, shopRow.id);
    return NextResponse.redirect(`${APP_URL}/checkoutlens/billing?welcome=1`);
  }

  // Declined, expired, or other — downgrade
  console.log("[PRD-3:billing/callback] subscription not ACTIVE status=%s shopId=%s", status, shopRow.id);
  await prisma.shop.update({
    where: { id: shopRow.id },
    data: {
      billingPlan: "free",
      subscriptionStatus: status ?? "DECLINED",
      planChangedAt: new Date(),
    },
  });
  return NextResponse.redirect(`${APP_URL}/checkoutlens/billing?error=declined`);
}
