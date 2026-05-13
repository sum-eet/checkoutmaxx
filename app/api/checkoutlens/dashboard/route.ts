export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { dashboardAggregator, type DashboardPayload } from "@/lib/analytics/dashboardAggregator";
import prisma from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Cached aggregator: TTL 300s, tag per shop
// unstable_cache key must be string[] — shop-scoped tag per PRD-5 §6
// ---------------------------------------------------------------------------

function getCachedDashboard(shopId: string, start: Date, end: Date, timezone: string) {
  const tag = `shop:${shopId}:dashboard`;

  // Inline unstable_cache so the tag includes the shopId at call time
  return unstable_cache(
    (sid: string, s: Date, e: Date, tz: string) => dashboardAggregator(sid, s, e, tz),
    [`dashboard`, shopId],
    { revalidate: 300, tags: [tag] }
  )(shopId, start, end, timezone);
}

// ---------------------------------------------------------------------------
// GET /api/checkoutlens/dashboard?start=...&end=...
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  console.log("[PRD-5:dashboard] GET", url.toString());

  // Auth
  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-5:dashboard] unauthorized — no valid session token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[PRD-5:dashboard] shopDomain=%s", authed.shopDomain);

  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn("[PRD-5:dashboard] no shop record for domain=%s", authed.shopDomain);
    return NextResponse.json({ error: "No shop" }, { status: 400 });
  }

  // Parse params
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  const start = startParam ? new Date(startParam) : new Date(Date.now() - 30 * 86400 * 1000);
  const end = endParam ? new Date(endParam) : new Date();

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    console.warn("[PRD-5:dashboard] invalid date range start=%s end=%s", startParam, endParam);
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  // Fetch shop timezone from DB for timezone-aware sparklines
  let timezone = "UTC";
  try {
    const shopRow = await prisma.shop.findUnique({
      where: { id: shop.id },
      select: { timezone: true },
    });
    timezone = shopRow?.timezone ?? "UTC";
  } catch (err: any) {
    console.warn("[PRD-5:dashboard] could not read shop timezone, defaulting to UTC:", err.message);
  }

  console.log("[PRD-5:dashboard] shopId=%s start=%s end=%s tz=%s", shop.id, start.toISOString(), end.toISOString(), timezone);

  try {
    const payload: DashboardPayload = await getCachedDashboard(shop.id, start, end, timezone);
    console.log("[PRD-5:dashboard] done sessions=%d funnel_steps=%d failed=%d", payload.kpis.sessions, payload.funnel.length, payload.failed.length);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err: any) {
    console.error("[PRD-5:dashboard] aggregator error:", err.message, err.stack);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
