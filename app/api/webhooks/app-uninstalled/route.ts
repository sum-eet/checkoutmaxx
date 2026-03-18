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
    // Skip deactivation if the shop was installed within the last 60 seconds —
    // Shopify fires app/uninstalled during reinstall sequences (uninstall+reinstall
    // back-to-back), which would immediately flip isActive back to false.
    const secondsSinceInstall = (Date.now() - new Date(shopRecord.installedAt).getTime()) / 1000;
    if (secondsSinceInstall < 60) {
      console.log(`[app-uninstalled] skipping deactivation for ${shop} — reinstall in progress (${secondsSinceInstall.toFixed(0)}s since install)`);
      return NextResponse.json({ ok: true });
    }

    if (shopRecord.pixelId && shopRecord.accessToken) {
      try {
        await deregisterAppPixel(shop, shopRecord.accessToken, shopRecord.pixelId);
      } catch (err) {
        console.error("[app-uninstalled] Failed to deregister pixel:", err);
      }
    }

    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { isActive: false, pixelId: null },
    });
    console.log(`[app-uninstalled] Marked inactive: ${shop}`);
  }

  return NextResponse.json({ ok: true });
}
