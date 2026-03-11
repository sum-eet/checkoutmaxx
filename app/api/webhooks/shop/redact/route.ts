export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Shopify GDPR: shop/redact
// Sent 48 hours after a shop uninstalls the app. We delete all data
// we hold for that shop.
export async function POST(req: NextRequest) {
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!hmac) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    console.log("[webhook] shop/redact", JSON.stringify(body));

    const shopDomain: string | undefined = body?.shop_domain;
    if (!shopDomain) {
      return NextResponse.json({ error: "Missing shop_domain" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({ where: { shopDomain } });
    if (shop) {
      // Delete in dependency order
      await prisma.checkoutEvent.deleteMany({ where: { shopId: shop.id } });
      await prisma.alertLog.deleteMany({ where: { shopId: shop.id } });
      await prisma.baseline.deleteMany({ where: { shopId: shop.id } });
      await prisma.shop.delete({ where: { id: shop.id } });
      console.log(`[redact] shop/redact completed for ${shopDomain}`);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    console.error("[webhook] shop/redact error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
