export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { prisma } from "@/lib/prisma";

// TODO(PRD-3): add requireFeature guard if needed.

/**
 * POST /api/checkoutlens/onboarding/dismiss
 * Sets server-side dismissedAt for users who opt out of the banner forever.
 * Does NOT stop steps from being checked — recompute still runs on GET /state.
 */
export async function POST(req: NextRequest) {
  console.log("[PRD-4:onboarding/dismiss] POST entry");

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-4:onboarding/dismiss] POST: no authenticated shop");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const shopRow = await ensureShop(authed.shopDomain, authed.token);
  if (!shopRow) {
    console.warn("[PRD-4:onboarding/dismiss] POST: shop not found domain=%s", authed.shopDomain);
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }
  const shopId = shopRow.id;

  try {
    const state = await prisma.onboardingState.upsert({
      where: { shopId },
      update: { dismissedAt: new Date() },
      create: { shopId, dismissedAt: new Date() },
    });
    console.log("[PRD-4:onboarding/dismiss] POST: set dismissedAt=%s shopId=%s stateId=%s", state.dismissedAt?.toISOString(), shopId, state.id);
    return NextResponse.json({ ok: true, dismissedAt: state.dismissedAt });
  } catch (err: any) {
    console.error("[PRD-4:onboarding/dismiss] POST: error", err.message);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
