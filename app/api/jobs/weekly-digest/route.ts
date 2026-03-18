export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getFunnelMetrics } from "@/lib/metrics";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(req: NextRequest) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shops = await prisma.shop.findMany({
    where: { isActive: true, alertEmail: { not: null } },
  });

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const monday = new Date(weekAgo);
  monday.setDate(monday.getDate() - monday.getDay() + 1);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  let sent = 0;
  for (const shop of shops) {
    try {
      const [
        thisWeekStarted,
        thisWeekCompleted,
        lastWeekStarted,
        lastWeekCompleted,
        alerts,
        funnel,
      ] = await Promise.all([
        prisma.checkoutEvent.count({
          where: {
            shopId: shop.id,
            eventType: "checkout_started",
            occurredAt: { gte: weekAgo },
          },
        }),
        prisma.checkoutEvent.count({
          where: {
            shopId: shop.id,
            eventType: "checkout_completed",
            occurredAt: { gte: weekAgo },
          },
        }),
        prisma.checkoutEvent.count({
          where: {
            shopId: shop.id,
            eventType: "checkout_started",
            occurredAt: { gte: twoWeeksAgo, lt: weekAgo },
          },
        }),
        prisma.checkoutEvent.count({
          where: {
            shopId: shop.id,
            eventType: "checkout_completed",
            occurredAt: { gte: twoWeeksAgo, lt: weekAgo },
          },
        }),
        prisma.alertLog.findMany({
          where: { shopId: shop.id, firedAt: { gte: weekAgo } },
        }),
        getFunnelMetrics(shop.id, { start: weekAgo, end: now }),
      ]);

      const cvr =
        thisWeekStarted > 0 ? (thisWeekCompleted / thisWeekStarted) * 100 : 0;
      const prevCvr =
        lastWeekStarted > 0 ? (lastWeekCompleted / lastWeekStarted) * 100 : 0;
      const delta = cvr - prevCvr;
      const deltaStr = (delta >= 0 ? "+" : "") + delta.toFixed(1) + "pts";
      const resolved = alerts.filter((a: any) => a.resolvedAt).length;
      const topDrop = funnel
        .slice(1)
        .sort((a, b) => b.dropPct - a.dropPct)[0];

      const body = [
        "CouponMaxx Weekly Summary",
        `Week of ${fmt(monday)} - ${fmt(sunday)}`,
        "",
        `Checkouts monitored this week: ${thisWeekStarted.toLocaleString()}`,
        `Orders completed: ${thisWeekCompleted.toLocaleString()}`,
        `Checkout CVR: ${cvr.toFixed(1)}%`,
        `vs. prior week: ${deltaStr}`,
        "",
        `Alerts fired this week: ${alerts.length}`,
        `Alerts resolved: ${resolved}`,
        "",
        topDrop
          ? `Top drop-off step: ${topDrop.label} (${topDrop.dropPct}% drop)`
          : "",
        "",
        "--------------------------------------------",
        `View your dashboard: ${process.env.NEXT_PUBLIC_APP_URL}/dashboard/converted?shop=${shop.shopDomain}`,
        "",
        "--------------------------------------------",
        "To stop these emails, go to Settings in the app.",
        "CouponMaxx - Checkout monitoring for Shopify stores.",
      ]
        .filter((l) => l !== undefined)
        .join("\n");

      await resend.emails.send({
        from: "CouponMaxx <alerts@flowymails.com>",
        to: shop.alertEmail!,
        subject: `CouponMaxx Weekly - ${shop.shopDomain}`,
        text: body,
      });
      sent++;
    } catch (err) {
      console.error(`[weekly-digest] failed for ${shop.shopDomain}:`, err);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
