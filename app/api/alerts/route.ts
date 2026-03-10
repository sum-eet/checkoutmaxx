export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get("shop");
  const tab = req.nextUrl.searchParams.get("tab") || "active";

  if (!shopDomain) return NextResponse.json({ error: "Missing shop" }, { status: 400 });

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  if (tab === "active") {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const alerts = await prisma.alertLog.findMany({
      where: { shopId: shop.id, resolvedAt: null, firedAt: { gte: twoHoursAgo } },
      orderBy: { firedAt: "desc" },
      select: {
        id: true,
        alertType: true,
        severity: true,
        title: true,
        body: true,
        actionUrl: true,
        actionLabel: true,
        sentEmail: true,
        sentSlack: true,
        firedAt: true,
      },
    });
    return NextResponse.json(alerts);
  }

  // history tab
  const alerts = await prisma.alertLog.findMany({
    where: { shopId: shop.id },
    orderBy: { firedAt: "desc" },
    take: 50,
    select: {
      id: true,
      alertType: true,
      title: true,
      sentEmail: true,
      sentSlack: true,
      firedAt: true,
      resolvedAt: true,
      roiEstimatedUsd: true,
    },
  });
  return NextResponse.json(alerts);
}
