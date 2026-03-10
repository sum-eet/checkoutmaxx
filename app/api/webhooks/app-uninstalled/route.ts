import { NextRequest, NextResponse } from "next/server";
import shopify from "@/lib/shopify";
import prisma from "@/lib/prisma";
import { deregisterAppPixel } from "@/lib/pixel-registration";

export async function POST(req: NextRequest) {
  // HMAC verification — Guardrail #8
  const { topic, shop, session, payload } = await shopify.authenticate.webhook(req);

  if (topic !== "APP_UNINSTALLED") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });

  if (shopRecord) {
    // Deregister pixel
    if (shopRecord.pixelId && shopRecord.accessToken) {
      try {
        await deregisterAppPixel(shop, shopRecord.accessToken, shopRecord.pixelId);
      } catch (err) {
        console.error("[app-uninstalled] Failed to deregister pixel:", err);
      }
    }

    // Mark shop inactive — do not delete data (merchant may reinstall)
    await prisma.shop.update({
      where: { id: shopRecord.id },
      data: { isActive: false, pixelId: null },
    });
  }

  return NextResponse.json({ ok: true });
}
