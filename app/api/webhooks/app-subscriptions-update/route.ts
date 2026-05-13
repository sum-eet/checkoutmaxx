export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PRD-3 — POST /api/webhooks/app-subscriptions-update
 * Handles all APP_SUBSCRIPTIONS_UPDATE events from Shopify.
 * Verifies HMAC first. Syncs subscription status and billing plan.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  console.log("[PRD-3:webhook/app-subscriptions-update] ====== HIT ======");

  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) {
    console.error("[PRD-3:webhook/app-subscriptions-update] NO HMAC HEADER");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.text();
  const secret = process.env.SHOPIFY_API_SECRET!;
  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  if (computed !== hmacHeader) {
    console.error("[PRD-3:webhook/app-subscriptions-update] HMAC MISMATCH");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("[PRD-3:webhook/app-subscriptions-update] INVALID JSON");
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const shopDomain = (req.headers.get("x-shopify-shop-domain") ?? body?.shop_domain) as string | undefined;
  const appSub = body?.app_subscription;
  const status = appSub?.status as string | undefined;
  const adminGraphqlApiId = appSub?.admin_graphql_api_id as string | undefined;
  const currentPeriodEnd = appSub?.current_period_end as string | undefined;

  if (!shopDomain || !status) {
    console.error(
      "[PRD-3:webhook/app-subscriptions-update] MISSING FIELDS shop=%s status=%s",
      shopDomain,
      status,
    );
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  console.log(
    "[PRD-3:webhook/app-subscriptions-update] shop=%s status=%s adminGid=%s",
    shopDomain,
    status,
    adminGraphqlApiId,
  );

  // Build the GID from the numeric id Shopify sends
  const gid = adminGraphqlApiId
    ? `gid://shopify/AppSubscription/${adminGraphqlApiId}`
    : null;

  // Find shop
  const shop = await prisma.shop.findFirst({
    where: { shopDomain },
    select: { id: true, subscriptionId: true, billingPlan: true },
  });

  if (!shop) {
    console.warn("[PRD-3:webhook/app-subscriptions-update] shop not found domain=%s", shopDomain);
    // Return 200 — Shopify retries on 4xx/5xx
    return NextResponse.json({ ok: true, warn: "shop_not_found" });
  }

  // Build update payload based on status
  let updateData: Record<string, unknown> = {};

  switch (status) {
    case "ACTIVE":
      updateData = {
        subscriptionStatus: "ACTIVE",
        currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : undefined,
        // DO NOT change billingPlan here — /callback already set the correct value.
        // If billingPlan is still "pending_*", it means callback hasn't run yet;
        // leave it so the first /api/billing/me poll after redirect still sees the correct plan.
      };
      break;

    case "CANCELLED":
      updateData = {
        subscriptionStatus: "CANCELLED",
        // Keep billingPlan — merchant retains access until EXPIRED fires.
      };
      break;

    case "EXPIRED":
    case "DECLINED":
    case "FROZEN":
    case "PAUSED":
      // Downgrade to free, preserve all data
      updateData = {
        subscriptionStatus: status,
        billingPlan: "free",
        planChangedAt: new Date(),
      };
      break;

    case "PENDING":
      // No-op
      console.log("[PRD-3:webhook/app-subscriptions-update] PENDING no-op shopId=%s", shop.id);
      return NextResponse.json({ ok: true });

    default:
      console.warn("[PRD-3:webhook/app-subscriptions-update] unknown status=%s shopId=%s", status, shop.id);
      updateData = { subscriptionStatus: status };
  }

  // Adopt the subscription GID if it matches or if we had none
  if (gid && (!shop.subscriptionId || shop.subscriptionId === gid)) {
    updateData.subscriptionId = gid;
  }

  await prisma.shop.update({
    where: { id: shop.id },
    data: updateData,
  });

  console.log(
    "[PRD-3:webhook/app-subscriptions-update] done shopId=%s status=%s billingPlan=%s",
    shop.id,
    status,
    updateData.billingPlan ?? "(unchanged)",
  );

  return NextResponse.json({ ok: true });
}
