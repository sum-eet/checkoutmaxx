export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { supabase } from "@/lib/supabase";
import { getCheckoutTrend } from "@/lib/analytics/checkoutTrend";

// TODO(PRD-3): requireFeature(shopId, "trend_chart")

export async function GET(req: NextRequest) {
  console.log("[PRD-1:analytics/trend] GET", req.url);

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-1:analytics/trend] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn("[PRD-1:analytics/trend] no shop", authed.shopDomain);
    return NextResponse.json({ error: "No shop" }, { status: 400 });
  }

  // Fetch shop timezone for correct bucket boundaries
  const { data: shopRow } = await supabase
    .from("Shop")
    .select("timezone")
    .eq("id", shop.id)
    .maybeSingle();
  const timezone = shopRow?.timezone ?? "UTC";

  const { searchParams } = new URL(req.url);
  const start = new Date(searchParams.get("start") ?? Date.now() - 30 * 86400 * 1000);
  const end = new Date(searchParams.get("end") ?? Date.now());
  const country = searchParams.get("country") || undefined;
  const device = (searchParams.get("device") as "mobile" | "tablet" | "desktop") || undefined;

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  console.log("[PRD-1:analytics/trend] shopId=%s start=%s end=%s tz=%s", shop.id, start.toISOString(), end.toISOString(), timezone);

  try {
    const data = await getCheckoutTrend({ shopId: shop.id, start, end, timezone, country, device });
    console.log("[PRD-1:analytics/trend] done buckets=%d", data.buckets.length);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e: any) {
    console.error("[PRD-1:analytics/trend] error", e.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
