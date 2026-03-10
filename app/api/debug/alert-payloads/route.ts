export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Temporary debug endpoint — delete after investigation
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shopDomain = req.nextUrl.searchParams.get("shop");
  if (!shopDomain) return NextResponse.json({ error: "Missing shop" }, { status: 400 });
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const events = await prisma.checkoutEvent.findMany({
    where: { shopId: shop.id, eventType: "alert_displayed" },
    orderBy: { occurredAt: "desc" },
    take: 5,
    select: { id: true, discountCode: true, errorMessage: true, occurredAt: true, rawPayload: true },
  });

  return NextResponse.json(events);
}
