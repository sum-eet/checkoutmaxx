export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { requirePlus } from "@/lib/billing/plusGate";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  console.log("[PRD-2:recovery/stats] GET entry");

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-2:recovery/stats] GET: no authenticated shop");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const shopRow = await ensureShop(authed.shopDomain, authed.token);
  if (!shopRow) {
    console.warn("[PRD-2:recovery/stats] GET: shop not found domain=%s", authed.shopDomain);
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }
  const shopId = shopRow.id;

  // TODO(PRD-3): requireFeature(shopId, "recovery")
  const gate = await requirePlus(shopId);
  if (!gate.ok) {
    console.log("[PRD-2:recovery/stats] GET: plus gate fail shopId=%s reason=%s", shopId, gate.reason);
    return NextResponse.json(
      { error: "plus_only", upgrade_url: "https://www.shopify.com/plus" },
      { status: 402 }
    );
  }

  const { searchParams } = new URL(req.url);
  const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const start = new Date(searchParams.get("start") ?? defaultStart.toISOString());
  const end = new Date(searchParams.get("end") ?? new Date().toISOString());

  console.log("[PRD-2:recovery/stats] shopId=%s start=%s end=%s", shopId, start.toISOString(), end.toISOString());

  // TODO(PRD-2-merge): remove cast once RecoveryIssue model is in schema
  const issues: Array<{ claimedAt: Date | null; redeemedAt: Date | null; redeemedTotal: number | null }> =
    await (prisma as any).recoveryIssue.findMany({
      where: { shopId, issuedAt: { gte: start, lte: end } },
      select: { claimedAt: true, redeemedAt: true, redeemedTotal: true },
    });

  const issued = issues.length;
  const claimed = issues.filter((i: { claimedAt: Date | null }) => i.claimedAt !== null).length;
  const redeemed = issues.filter((i: { redeemedAt: Date | null }) => i.redeemedAt !== null).length;
  const revenue = issues.reduce((sum: number, i: { redeemedTotal: number | null }) => sum + (i.redeemedTotal ?? 0), 0);

  const claimRate = issued > 0 ? Math.round((claimed / issued) * 100) : 0;

  console.log("[PRD-2:recovery/stats] issued=%d claimed=%d redeemed=%d revenue=%d shopId=%s", issued, claimed, redeemed, revenue, shopId);
  return NextResponse.json({ issued, claimed, claimRate, redeemed, revenue });
}
