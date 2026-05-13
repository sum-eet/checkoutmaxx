export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { getFailedDiscounts } from "@/lib/analytics/failedDiscounts";

export async function GET(req: NextRequest) {
  console.log("[PRD-1:analytics/failed-discounts] GET", req.url);

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-1:analytics/failed-discounts] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn("[PRD-1:analytics/failed-discounts] no shop", authed.shopDomain);
    return NextResponse.json({ error: "No shop" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const start = new Date(searchParams.get("start") ?? Date.now() - 30 * 86400 * 1000);
  const end = new Date(searchParams.get("end") ?? Date.now());
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = 25;
  const offset = (page - 1) * limit;

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  console.log("[PRD-1:analytics/failed-discounts] shopId=%s start=%s end=%s page=%d",
    shop.id, start.toISOString(), end.toISOString(), page);

  try {
    const data = await getFailedDiscounts({ shopId: shop.id, start, end, limit, offset });
    console.log("[PRD-1:analytics/failed-discounts] done rows=%d total=%d", data.rows.length, data.total);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e: any) {
    console.error("[PRD-1:analytics/failed-discounts] error", e.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
