export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  console.log("[PRD-1:analytics/filter-options] GET", req.url);

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-1:analytics/filter-options] unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn("[PRD-1:analytics/filter-options] no shop", authed.shopDomain);
    return NextResponse.json({ error: "No shop" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const start = new Date(searchParams.get("start") ?? Date.now() - 30 * 86400 * 1000);
  const end = new Date(searchParams.get("end") ?? Date.now());

  console.log("[PRD-1:analytics/filter-options] shopId=%s", shop.id);

  try {
    // Top countries by session volume
    const countryRows = await prisma.$queryRaw<{ country: string; cnt: bigint }[]>`
      SELECT "country", COUNT(DISTINCT "sessionId") AS cnt
      FROM "CheckoutEvent"
      WHERE "shopId" = ${shop.id}
        AND "occurredAt" BETWEEN ${start} AND ${end}
        AND "country" IS NOT NULL
      GROUP BY "country"
      ORDER BY cnt DESC
      LIMIT 20;
    `;

    const countries = countryRows.map((r) => ({
      label: r.country,
      value: r.country,
    }));

    console.log("[PRD-1:analytics/filter-options] done countries=%d", countries.length);
    return NextResponse.json({ countries }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e: any) {
    console.error("[PRD-1:analytics/filter-options] error", e.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}
