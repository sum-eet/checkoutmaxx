export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { deregisterAppPixel } from "@/lib/pixel-registration";
import { verifyWebhookHmac } from "@/lib/verifyWebhookHmac";

export async function POST(req: NextRequest) {
  const verified = await verifyWebhookHmac(req);
  if (!verified) {
    console.error("[app-uninstalled] HMAC verification failed");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = verified.body as Record<string, unknown>;
  const shop = (body?.domain || body?.myshopify_domain) as string | undefined;

  if (!shop) {
    console.error("[app-uninstalled] Missing shop domain in payload");
    return NextResponse.json({ error: "Missing shop" }, { status: 400 });
  }

  console.log("[app-uninstalled] Verified for shop:", shop);

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });

  if (shopRecord) {
    // Guard against the race condition where:
    //   1. merchant uninstalls → Shopify queues this webhook (delayed delivery)
    //   2. merchant immediately reinstalls → auth callback sets isActive=true, updatedAt=now
    //   3. this old webhook finally arrives → would wrongly set isActive=false
    //
    // X-Shopify-Triggered-At tells us when the uninstall actually happened.
    // If the shop's updatedAt is AFTER the webhook trigger time, a reinstall
    // has already happened — do not mark inactive.
    const triggeredAtHeader = req.headers.get("x-shopify-triggered-at");
    if (triggeredAtHeader) {
      const triggeredAt = new Date(triggeredAtHeader).getTime();
      const shopUpdatedAt = new Date(shopRecord.updatedAt).getTime();
      if (shopUpdatedAt > triggeredAt) {
        console.log(`[app-uninstalled] Skipping stale webhook for ${shop} — shop reinstalled at ${shopRecord.updatedAt}, webhook triggered at ${triggeredAtHeader}`);
        return NextResponse.json({ ok: true });
      }
    }

    if (shopRecord.pixelId && shopRecord.accessToken) {
      try {
        await deregisterAppPixel(shop, shopRecord.accessToken, shopRecord.pixelId);
      } catch (err) {
        console.error("[app-uninstalled] Failed to deregister pixel:", err);
      }
    }

    // Mark inactive, keep data — merchant may reinstall
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { isActive: false, pixelId: null },
    });
    console.log(`[app-uninstalled] Marked inactive: ${shop}`);
  }

  return NextResponse.json({ ok: true });
}
