export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { recomputeOnboarding } from "@/lib/onboarding/recompute";

// PRD-3: onboarding is a free feature — no feature gate required.

export async function POST(req: NextRequest) {
  console.log("[PRD-4:onboarding/recompute] POST entry");

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-4:onboarding/recompute] POST: no authenticated shop");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const shopRow = await ensureShop(authed.shopDomain, authed.token);
  if (!shopRow) {
    console.warn("[PRD-4:onboarding/recompute] POST: shop not found domain=%s", authed.shopDomain);
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }
  const shopId = shopRow.id;

  try {
    const result = await recomputeOnboarding(shopId);
    console.log("[PRD-4:onboarding/recompute] POST: ok shopId=%s allComplete=%s", shopId, result.allComplete);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[PRD-4:onboarding/recompute] POST: error", err.message);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
