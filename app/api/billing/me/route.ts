export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PRD-3 — GET /api/billing/me
 * Returns current shop's effective tier + per-flag access map.
 * Consumed by hooks/useFeatures.ts (SWR, deduped 5min client-side).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { prisma } from "@/lib/prisma";
import { getEffectiveTier, hasFeature } from "@/lib/billing/gate";

export async function GET(req: NextRequest) {
  console.log("[PRD-3:billing/me] GET");

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-3:billing/me] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn("[PRD-3:billing/me] shop not found domain=%s", authed.shopDomain);
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }

  const shopRow = await prisma.shop.findUnique({
    where: { id: shop.id },
    select: {
      billingPlan: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      isPlus: true,
    },
  });

  const tier = await getEffectiveTier(shop.id);
  const flags = await prisma.featureFlag.findMany();

  const features: Record<string, boolean> = {};
  for (const flag of flags) {
    features[flag.featureKey] = await hasFeature(shop.id, flag.featureKey);
  }

  console.log(
    "[PRD-3:billing/me] shopId=%s tier=%s plan=%s features=%j",
    shop.id,
    tier,
    shopRow?.billingPlan,
    features,
  );

  return NextResponse.json(
    {
      tier,
      plan: shopRow?.billingPlan ?? "free",
      subscriptionStatus: shopRow?.subscriptionStatus ?? null,
      trialEndsAt: shopRow?.trialEndsAt ?? null,
      currentPeriodEnd: shopRow?.currentPeriodEnd ?? null,
      isPlus: shopRow?.isPlus ?? false,
      features,
    },
    {
      headers: {
        "Cache-Control": "private, max-age=60",
      },
    },
  );
}
