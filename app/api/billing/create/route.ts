export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PRD-3 — POST /api/billing/create
 * Body: { plan: "standard" | "plus" }
 * Creates (or replaces) a Shopify app subscription and returns { confirmationUrl }.
 */

import { NextRequest, NextResponse } from "next/server";
import { Session } from "@shopify/shopify-api";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { prisma } from "@/lib/prisma";
import { shopify } from "@/lib/shopify";
import { shouldUseTestMode } from "@/lib/billing/testMode";

const APP_URL = process.env.SHOPIFY_APP_URL ?? "https://couponmaxx.vercel.app";

const CREATE_SUBSCRIPTION_MUTATION = `
  mutation appSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $test: Boolean!
    $trialDays: Int!
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
      lineItems: $lineItems
    ) {
      userErrors { field message }
      confirmationUrl
      appSubscription { id status }
    }
  }
`;

const CANCEL_SUBSCRIPTION_MUTATION = `
  mutation appSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      userErrors { field message }
      appSubscription { id status }
    }
  }
`;

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
  if (plan !== "standard" && plan !== "plus") {
    return NextResponse.json({ error: "invalid_plan", valid: ["standard", "plus"] }, { status: 400 });
  }

  // Load full shop row for isPlus + testMode check
  const shop = await prisma.shop.findUnique({
    where: { id: shopRow.id },
    select: {
      isPlus: true,
      partnerDevelopment: true,
      planDisplayName: true,
      subscriptionId: true,
      subscriptionStatus: true,
    },
  });

  if (!shop) {
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }

  if (plan === "plus" && !shop.isPlus) {
    console.log("[PRD-3:billing/create] plus requires Shopify Plus shopId=%s", shopRow.id);
    return NextResponse.json(
      { error: "plus_required", message: "This plan requires a Shopify Plus subscription." },
      { status: 400 },
    );
  }

  const useTestMode =
    shouldUseTestMode({
      partnerDevelopment: shop.partnerDevelopment,
      planDisplayName: shop.planDisplayName,
    }) || process.env.NODE_ENV !== "production";

  console.log("[PRD-3:billing/create] plan=%s testMode=%s shopId=%s", plan, useTestMode, shopRow.id);

  const session = new Session({
    id: `offline_${authed.shopDomain}`,
    shop: authed.shopDomain,
    state: "installed",
    isOnline: false,
    accessToken: shopRow.accessToken,
  });
  const client = new shopify.clients.Graphql({ session });

  // Cancel any existing active subscription
  if (shop.subscriptionId && shop.subscriptionStatus === "ACTIVE") {
    console.log(
      "[PRD-3:billing/create] cancelling existing sub id=%s shopId=%s",
      shop.subscriptionId,
      shopRow.id,
    );
    try {
      const cancelRes = await (client as any).request(CANCEL_SUBSCRIPTION_MUTATION, {
        variables: { id: shop.subscriptionId },
      });
      const cancelErrors = (cancelRes.data as any)?.appSubscriptionCancel?.userErrors ?? [];
      if (cancelErrors.length > 0) {
        console.warn("[PRD-3:billing/create] cancel userErrors:", JSON.stringify(cancelErrors));
      }
    } catch (err: any) {
      console.error("[PRD-3:billing/create] cancel error (non-fatal):", err?.message);
    }
  }

  const planName = plan === "plus" ? "Checkout Lens Plus" : "Checkout Lens Standard";
  const amount = plan === "plus" ? 39.0 : 10.0;
  const returnUrl = `${APP_URL}/api/billing/callback?plan=${plan}`;

  const variables = {
    name: planName,
    returnUrl,
    test: useTestMode,
    trialDays: 14,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            interval: "EVERY_30_DAYS",
            price: { amount, currencyCode: "USD" },
          },
        },
      },
    ],
  };

  console.log("[PRD-3:billing/create] running mutation plan=%s test=%s", plan, useTestMode);

  let confirmationUrl: string;
  let subId: string;
  try {
    const res = await (client as any).request(CREATE_SUBSCRIPTION_MUTATION, { variables });
    const data = (res.data as any)?.appSubscriptionCreate;
    const userErrors = data?.userErrors ?? [];
    if (userErrors.length > 0) {
      console.error("[PRD-3:billing/create] userErrors:", JSON.stringify(userErrors));
      return NextResponse.json({ error: "shopify_error", details: userErrors }, { status: 500 });
    }
    confirmationUrl = data?.confirmationUrl;
    subId = data?.appSubscription?.id;
    if (!confirmationUrl) {
      console.error("[PRD-3:billing/create] no confirmationUrl in response");
      return NextResponse.json({ error: "no_confirmation_url" }, { status: 500 });
    }
  } catch (err: any) {
    console.error("[PRD-3:billing/create] graphql error:", err?.message);
    return NextResponse.json({ error: "graphql_error", message: err?.message }, { status: 500 });
  }

  // Persist PENDING state — do NOT activate until /callback confirms
  await prisma.shop.update({
    where: { id: shopRow.id },
    data: {
      subscriptionId: subId,
      subscriptionStatus: "PENDING",
      billingPlan: `pending_${plan}`,
      planChangedAt: new Date(),
    },
  });

  console.log("[PRD-3:billing/create] done subId=%s plan=%s shopId=%s", subId, plan, shopRow.id);

  return NextResponse.json({ confirmationUrl });
}
