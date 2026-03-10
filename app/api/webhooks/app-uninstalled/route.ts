export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { shopify } from "@/lib/shopify";
import prisma from "@/lib/prisma";
import { deregisterAppPixel } from "@/lib/pixel-registration";

export async function POST(req: NextRequest) {
  // HMAC verification — Guardrail #8: all webhooks must be verified
  let topic: string;
  let shop: string;

  try {
    const result = await shopify.webhooks.validate({
      rawBody: await req.text(),
      rawRequest: req,
    });

    if (!result.valid) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    topic = result.topic;
    shop = result.domain;
  } catch (err) {
    console.error("[app-uninstalled] Webhook validation error:", err);
    return NextResponse.json({ error: "Webhook validation failed" }, { status: 401 });
  }

  if (topic !== "APP_UNINSTALLED") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const shopRecord = await prisma.shop.findUnique({ where: { shopDomain: shop } });

  if (shopRecord) {
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
  }

  return NextResponse.json({ ok: true });
}
