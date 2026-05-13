import { prisma } from "@/lib/prisma";
import { Session } from "@shopify/shopify-api";
import { shopify } from "@/lib/shopify";

const PLAN_QUERY = `{ shop { plan { displayName partnerDevelopment shopifyPlus } } }`;

export type PlusGateResult =
  | { ok: true }
  | { ok: false; reason: "not_plus" | "shop_missing" };

export async function refreshShopPlan(shopId: string): Promise<void> {
  console.log("[PRD-2:plusGate] refreshShopPlan shopId=%s", shopId);

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true, accessToken: true },
  });
  if (!shop?.accessToken) {
    console.warn("[PRD-2:plusGate] refreshShopPlan: shop missing or no token shopId=%s", shopId);
    return;
  }

  const session = new Session({
    id: `offline_${shop.shopDomain}`,
    shop: shop.shopDomain,
    state: "installed",
    isOnline: false,
    accessToken: shop.accessToken,
  });

  try {
    const client = new shopify.clients.Graphql({ session });
    const res = await client.request(PLAN_QUERY);
    const plan = (res.data as any)?.shop?.plan;
    if (!plan) {
      console.warn("[PRD-2:plusGate] refreshShopPlan: no plan in response shopId=%s", shopId);
      return;
    }

    const isPlus: boolean = plan.shopifyPlus === true;
    const planDisplayName: string = plan.displayName ?? "";

    console.log("[PRD-2:plusGate] refreshShopPlan isPlus=%s displayName=%s shopId=%s", isPlus, planDisplayName, shopId);

    // When downgrading from Plus, disable any active recovery rule
    if (!isPlus) {
      await prisma.recoveryRule.updateMany({
        where: { shopId, enabled: true },
        data: { enabled: false },
      });
      console.log("[PRD-2:plusGate] refreshShopPlan: disabled recovery rules on downgrade shopId=%s", shopId);
      // TODO(PRD-3): send plan_downgraded email via Resend
    }

    await prisma.shop.update({
      where: { id: shopId },
      data: { isPlus, planDisplayName, planCheckedAt: new Date() },
    });
    console.log("[PRD-2:plusGate] refreshShopPlan: updated shopId=%s isPlus=%s", shopId, isPlus);
  } catch (err: any) {
    console.error("[PRD-2:plusGate] refreshShopPlan: error shopId=%s", shopId, err?.message);
  }
}

export async function requirePlus(shopId: string): Promise<PlusGateResult> {
  console.log("[PRD-2:plusGate] requirePlus shopId=%s", shopId);

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { isPlus: true, planCheckedAt: true },
  });

  if (!shop) {
    console.warn("[PRD-2:plusGate] requirePlus: shop not found shopId=%s", shopId);
    return { ok: false, reason: "shop_missing" };
  }

  const staleThresholdMs = 24 * 60 * 60 * 1000;
  const needsRefresh =
    !shop.planCheckedAt ||
    Date.now() - shop.planCheckedAt.getTime() > staleThresholdMs;

  if (needsRefresh) {
    console.log("[PRD-2:plusGate] requirePlus: plan stale, refreshing shopId=%s", shopId);
    await refreshShopPlan(shopId);
    // Re-read after refresh
    const fresh = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { isPlus: true },
    });
    if (!fresh?.isPlus) {
      console.log("[PRD-2:plusGate] requirePlus: not_plus after refresh shopId=%s", shopId);
      return { ok: false, reason: "not_plus" };
    }
    console.log("[PRD-2:plusGate] requirePlus: ok after refresh shopId=%s", shopId);
    return { ok: true };
  }

  if (!shop.isPlus) {
    console.log("[PRD-2:plusGate] requirePlus: not_plus (cached) shopId=%s", shopId);
    return { ok: false, reason: "not_plus" };
  }

  console.log("[PRD-2:plusGate] requirePlus: ok (cached) shopId=%s", shopId);
  return { ok: true };
}
