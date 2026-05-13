export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { getCheckoutFunnel } from "@/lib/analytics/checkoutFunnel";
import { requireFeature } from "@/lib/billing/gate";

export async function GET(req: NextRequest) {
  console.log("[PRD-1:analytics/funnel] GET", req.url);

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-1:analytics/funnel] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn("[PRD-1:analytics/funnel] no shop", authed.shopDomain);
    return NextResponse.json({ error: "No shop" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const start = new Date(searchParams.get("start") ?? Date.now() - 30 * 86400 * 1000);
  const end = new Date(searchParams.get("end") ?? Date.now());
  const country = searchParams.get("country") || undefined;
  const device = (searchParams.get("device") as "mobile" | "tablet" | "desktop") || undefined;
  const discountUsage = (searchParams.get("discountUsage") as "used" | "failed" | "none") || undefined;

  // PRD-3: only gate segmentation params — base funnel (no filters) is free
  const hasSegmentation = !!(country || device || discountUsage);
  if (hasSegmentation) {
    try {
      await requireFeature(shop.id, "segmentation_filters");
    } catch (gateResponse) {
      return gateResponse as Response;
    }
  }

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  console.log("[PRD-1:analytics/funnel] shopId=%s start=%s end=%s country=%s device=%s discountUsage=%s",
    shop.id, start.toISOString(), end.toISOString(), country, device, discountUsage);

  try {
    const steps = await getCheckoutFunnel({ shopId: shop.id, start, end, country, device, discountUsage });
    console.log("[PRD-1:analytics/funnel] done steps=%d", steps.length);
    return NextResponse.json({ steps }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e: any) {
    console.error("[PRD-1:analytics/funnel] error", e.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
