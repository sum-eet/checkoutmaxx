export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import {
  getShopByDomain,
  getKpiMetrics,
  getFunnelMetrics,
  getLiveEventFeed,
  getTopErrors,
  getDroppedProducts,
  getStatusBannerState,
  getDistinctCountries,
} from "@/lib/metrics";

function rangeFromParams(params: URLSearchParams): { start: Date; end: Date } {
  const start = params.get("start");
  const end = params.get("end");
  const now = new Date();
  return {
    start: start ? new Date(start) : new Date(now.getTime() - 24 * 60 * 60 * 1000),
    end: end ? new Date(end) : now,
  };
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const shopDomain = params.get("shop");
  const metric = params.get("metric");

  if (!shopDomain || !metric) {
    return NextResponse.json({ error: "Missing shop or metric" }, { status: 400 });
  }

  const shop = await getShopByDomain(shopDomain);
  if (!shop || !shop.isActive) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  const range = rangeFromParams(params);
  const device = params.get("device") || undefined;
  const country = params.get("country") || undefined;

  try {
    switch (metric) {
      case "kpi":
        return NextResponse.json(await getKpiMetrics(shop.id, range));

      case "funnel":
        return NextResponse.json(await getFunnelMetrics(shop.id, range, device, country));

      case "live-feed":
        return NextResponse.json(await getLiveEventFeed(shop.id, 50));

      case "errors":
        return NextResponse.json(await getTopErrors(shop.id, range));

      case "dropped-products":
        return NextResponse.json(await getDroppedProducts(shop.id, range));

      case "status":
        return NextResponse.json(await getStatusBannerState(shop.id));

      case "countries":
        return NextResponse.json(await getDistinctCountries(shop.id, range));

      default:
        return NextResponse.json({ error: "Unknown metric" }, { status: 400 });
    }
  } catch (err) {
    console.error(`[metrics/${metric}]`, err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
