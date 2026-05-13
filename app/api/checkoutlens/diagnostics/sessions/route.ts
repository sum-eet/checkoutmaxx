export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { prisma } from "@/lib/prisma";

// TODO(PRD-3): add requireFeature guard if sessions diagnostic becomes gated.

/**
 * GET /api/checkoutlens/diagnostics/sessions?window=1h
 *
 * Returns a real count of distinct sessionIds in CartEvent for the last hour.
 * Used by SetupGuide step 3 polling — NEVER fakes success.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const windowParam = url.searchParams.get("window") ?? "1h";
  console.log("[PRD-4:diagnostics/sessions] GET entry window=%s", windowParam);

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-4:diagnostics/sessions] GET: no authenticated shop");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const shopRow = await ensureShop(authed.shopDomain, authed.token);
  if (!shopRow) {
    console.warn("[PRD-4:diagnostics/sessions] GET: shop not found domain=%s", authed.shopDomain);
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }
  const shopId = shopRow.id;

  // Parse window — currently only "1h" is used by the UI
  const windowMs = windowParam === "1h" ? 60 * 60 * 1000 : 60 * 60 * 1000;
  const since = new Date(Date.now() - windowMs);

  try {
    // Distinct sessionIds in the window — uses CartEvent (cart-monitor data)
    const rows = await prisma.cartEvent.findMany({
      where: {
        shopId,
        occurredAt: { gte: since },
      },
      distinct: ["sessionId"],
      select: { sessionId: true, occurredAt: true },
      orderBy: { occurredAt: "desc" },
    });

    const count = rows.length;
    const lastSeenAt = rows[0]?.occurredAt ?? null;

    console.log("[PRD-4:diagnostics/sessions] GET: ok shopId=%s count=%d since=%s", shopId, count, since.toISOString());
    return NextResponse.json({ count, lastSeenAt, windowParam });
  } catch (err: any) {
    console.error("[PRD-4:diagnostics/sessions] GET: error", err.message);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
