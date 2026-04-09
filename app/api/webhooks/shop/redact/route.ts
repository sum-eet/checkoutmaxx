export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyWebhookHmac } from "@/lib/verifyWebhookHmac";

// Shopify GDPR: shop/redact
// Sent 48 hours after a shop uninstalls the app. We delete all data
// we hold for that shop.
export async function POST(req: NextRequest) {
  const verified = await verifyWebhookHmac(req);
  if (!verified) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = verified.body as Record<string, unknown>;
    console.log("[webhook] shop/redact", JSON.stringify(body));

    const shopDomain = body?.shop_domain as string | undefined;
    if (!shopDomain) {
      return NextResponse.json({ error: "Missing shop_domain" }, { status: 400 });
    }

    // GDPR redact: delete ALL records for this domain (all installs)
    const shops = await prisma.shop.findMany({ where: { shopDomain } });
    for (const shop of shops) {
      await prisma.checkoutEvent.deleteMany({ where: { shopId: shop.id } });
      await prisma.cartEvent.deleteMany({ where: { shopId: shop.id } });
      await prisma.alertLog.deleteMany({ where: { shopId: shop.id } });
      await prisma.baseline.deleteMany({ where: { shopId: shop.id } });
      await prisma.shop.delete({ where: { id: shop.id } });
    }
    if (shops.length > 0) {
      console.log(`[redact] shop/redact completed for ${shopDomain} (${shops.length} records)`);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error("[webhook] shop/redact error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
