export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendAlertEmail } from "@/lib/send-email";
import { sendSlackMessage } from "@/lib/send-slack";

// Test-only endpoint — bypasses all guards (48h, cooldown, thresholds)
// Remove or gate this before App Store submission
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shopDomain = req.nextUrl.searchParams.get("shop");
  if (!shopDomain) return NextResponse.json({ error: "Missing shop" }, { status: 400 });

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const results: Record<string, string> = {};

  if (shop.alertEmail && shop.alertEmailEnabled) {
    try {
      await sendAlertEmail({
        to: shop.alertEmail,
        title: "Test alert — CheckoutMaxx is working",
        body: "This is a test alert fired from the CheckoutMaxx test endpoint.\n\nIf you received this, email alerts are configured correctly.",
        actionUrl: `https://${shopDomain}/admin/settings/payments`,
        actionLabel: "Example deep link (Check payment settings)",
        shopDomain,
      });
      results.email = "sent";
    } catch (err: unknown) {
      results.email = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    results.email = shop.alertEmail ? "disabled" : "no email configured — set it in Settings first";
  }

  if (shop.slackWebhookUrl && shop.alertSlackEnabled) {
    try {
      await sendSlackMessage({
        webhookUrl: shop.slackWebhookUrl,
        title: "Test alert — CheckoutMaxx is working",
        body: "This is a test alert. If you see this, Slack alerts are configured correctly.",
        shopDomain,
      });
      results.slack = "sent";
    } catch (err: unknown) {
      results.slack = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    results.slack = "not configured";
  }

  return NextResponse.json({ ok: true, results });
}
