/**
 * PRD-3 — Server-side feature gating.
 * Two-layer mandatory: API (here) + Client (FeatureGate component).
 */

import { prisma } from "@/lib/prisma";

export type Tier = "free" | "standard" | "plus";

/**
 * Returns the shop's effective tier based on billing state.
 * Only ACTIVE subscriptions grant paid tier access.
 */
export async function getEffectiveTier(shopId: string): Promise<Tier> {
  console.log("[PRD-3:gate] getEffectiveTier shopId=%s", shopId);
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { billingPlan: true, subscriptionStatus: true },
  });
  if (!shop) {
    console.warn("[PRD-3:gate] getEffectiveTier: shop not found shopId=%s → free", shopId);
    return "free";
  }
  if (shop.subscriptionStatus !== "ACTIVE") {
    console.log(
      "[PRD-3:gate] getEffectiveTier: status=%s (not ACTIVE) → free shopId=%s",
      shop.subscriptionStatus,
      shopId,
    );
    return "free";
  }
  if (shop.billingPlan === "plus") {
    console.log("[PRD-3:gate] getEffectiveTier: plus shopId=%s", shopId);
    return "plus";
  }
  if (shop.billingPlan === "standard") {
    console.log("[PRD-3:gate] getEffectiveTier: standard shopId=%s", shopId);
    return "standard";
  }
  console.log("[PRD-3:gate] getEffectiveTier: billingPlan=%s → free shopId=%s", shop.billingPlan, shopId);
  return "free";
}

/**
 * Returns true if the shop has access to the given feature.
 * Checks overrides first (with expiry), then tier.
 * Unknown flags → open by default (fail-safe).
 */
export async function hasFeature(shopId: string, featureKey: string): Promise<boolean> {
  console.log("[PRD-3:gate] hasFeature shopId=%s featureKey=%s", shopId, featureKey);

  // 1. Check override
  const override = await prisma.featureFlagOverride.findUnique({
    where: { featureKey_shopId: { featureKey, shopId } },
  });
  if (override) {
    if (override.expiresAt && override.expiresAt < new Date()) {
      console.log("[PRD-3:gate] hasFeature: override expired featureKey=%s shopId=%s", featureKey, shopId);
      // fall through to tier check
    } else {
      console.log(
        "[PRD-3:gate] hasFeature: override enabled=%s featureKey=%s shopId=%s",
        override.enabled,
        featureKey,
        shopId,
      );
      return override.enabled;
    }
  }

  // 2. Tier check
  const flag = await prisma.featureFlag.findUnique({ where: { featureKey } });
  if (!flag) {
    console.log("[PRD-3:gate] hasFeature: unknown flag featureKey=%s → open", featureKey);
    return true; // unknown flag = open by default
  }

  const tier = await getEffectiveTier(shopId);
  const order: Tier[] = ["free", "standard", "plus"];
  const tierIdx = order.indexOf(tier);
  const requiredIdx = order.indexOf(flag.tierRequired as Tier);
  const allowed = tierIdx >= requiredIdx;

  console.log(
    "[PRD-3:gate] hasFeature: tier=%s required=%s allowed=%s featureKey=%s shopId=%s",
    tier,
    flag.tierRequired,
    allowed,
    featureKey,
    shopId,
  );
  return allowed;
}

/**
 * Throws a 402 Response if the shop does not have access to featureKey.
 * Use as line 1 of every gated API route (after auth + shop resolution).
 */
export async function requireFeature(shopId: string, featureKey: string): Promise<void> {
  console.log("[PRD-3:gate] requireFeature shopId=%s featureKey=%s", shopId, featureKey);
  if (!(await hasFeature(shopId, featureKey))) {
    const flag = await prisma.featureFlag.findUnique({ where: { featureKey } });
    const currentTier = await getEffectiveTier(shopId);
    console.log(
      "[PRD-3:gate] requireFeature: DENIED shopId=%s featureKey=%s currentTier=%s required=%s",
      shopId,
      featureKey,
      currentTier,
      flag?.tierRequired,
    );
    throw Response.json(
      {
        error: "upgrade_required",
        required_tier: flag?.tierRequired ?? "standard",
        current_tier: currentTier,
      },
      { status: 402 },
    );
  }
}
