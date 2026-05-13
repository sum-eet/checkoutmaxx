export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { getKpis } from "@/lib/analytics/kpis";

// TODO(PRD-3): requireFeature(shopId, "custom_date_range") for non-default date ranges

export async function GET(req: NextRequest) {
  console.log("[PRD-1:analytics/kpis] GET", req.url);

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-1:analytics/kpis] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn("[PRD-1:analytics/kpis] no shop", authed.shopDomain);
    return NextResponse.json({ error: "No shop" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const start = new Date(searchParams.get("start") ?? Date.now() - 30 * 86400 * 1000);
  const end = new Date(searchParams.get("end") ?? Date.now());
  const country = searchParams.get("country") || undefined;
  const device = (searchParams.get("device") as "mobile" | "tablet" | "desktop") || undefined;
  const discountUsage = (searchParams.get("discountUsage") as "used" | "failed" | "none") || undefined;

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  console.log("[PRD-1:analytics/kpis] shopId=%s start=%s end=%s", shop.id, start.toISOString(), end.toISOString());

  try {
    const data = await getKpis({ shopId: shop.id, start, end, country, device, discountUsage });
    console.log("[PRD-1:analytics/kpis] done", data.current);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e: any) {
    console.error("[PRD-1:analytics/kpis] error", e.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
