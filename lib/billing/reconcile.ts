/**
 * PRD-3 — Reinstall billing reconciliation.
 * Called from app/api/auth/callback/route.ts after shop row work.
 * Queries Shopify for active subscriptions and syncs local state.
 */

import { prisma } from "@/lib/prisma";
import { shopify } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";

const ACTIVE_SUBSCRIPTIONS_QUERY = `
  query {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
      }
    }
  }
`;

export async function reconcileOnInstall(shopId: string): Promise<void> {
  console.log("[PRD-3:reconcile] reconcileOnInstall shopId=%s", shopId);

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      shopDomain: true,
      accessToken: true,
      subscriptionId: true,
      subscriptionStatus: true,
    },
  });

  if (!shop?.accessToken) {
    console.warn("[PRD-3:reconcile] reconcileOnInstall: shop missing or no token shopId=%s", shopId);
    return;
  }

  try {
    const session = new Session({
      id: `offline_${shop.shopDomain}`,
      shop: shop.shopDomain,
      state: "installed",
      isOnline: false,
      accessToken: shop.accessToken,
    });
    const client = new shopify.clients.Graphql({ session });
    const res = await client.request(ACTIVE_SUBSCRIPTIONS_QUERY);
    const activeSubscriptions: Array<{
      id: string;
      name: string;
      status: string;
      currentPeriodEnd: string | null;
    }> = (res.data as any)?.currentAppInstallation?.activeSubscriptions ?? [];

    console.log(
      "[PRD-3:reconcile] reconcileOnInstall: activeSubscriptions=%d shopId=%s",
      activeSubscriptions.length,
      shopId,
    );

    if (activeSubscriptions.length === 0) {
      // No active subscription on Shopify → downgrade to free
      console.log("[PRD-3:reconcile] reconcileOnInstall: no active sub → downgrade shopId=%s", shopId);
      await prisma.shop.update({
        where: { id: shopId },
        data: {
          subscriptionStatus: "CANCELLED",
          billingPlan: "free",
          planChangedAt: new Date(),
        },
      });
      return;
    }

    const sub = activeSubscriptions[0];
    const subGid = sub.id; // already gid://shopify/AppSubscription/...

    if (shop.subscriptionId && shop.subscriptionId === subGid) {
      // Matching — keep state, update if drifted
      console.log("[PRD-3:reconcile] reconcileOnInstall: matching sub, updating status shopId=%s", shopId);
      await prisma.shop.update({
        where: { id: shopId },
        data: {
          subscriptionStatus: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : undefined,
        },
      });
    } else {
      // Different or missing subscription ID — adopt it
      console.log(
        "[PRD-3:reconcile] reconcileOnInstall: adopting new sub id=%s shopId=%s",
        subGid,
        shopId,
      );
      await prisma.shop.update({
        where: { id: shopId },
        data: {
          subscriptionId: subGid,
          subscriptionStatus: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : undefined,
          planChangedAt: new Date(),
        },
      });
    }
  } catch (err: any) {
    console.error("[PRD-3:reconcile] reconcileOnInstall: error shopId=%s", shopId, err?.message);
    // Non-fatal — don't throw, let install proceed
  }
}
