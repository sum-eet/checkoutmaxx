export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { shopify, sessionStorage, registerWebhooks } from "@/lib/shopify";
import prisma from "@/lib/prisma";
import { registerAppPixel, deregisterAppPixel } from "@/lib/pixel-registration";

// GET /api/auth/callback
// Shopify redirects here after merchant grants permissions
export async function GET(req: NextRequest) {
  let session;

  try {
    // web-api adapter: callback returns a Response on redirect, or throws on error
    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
    });
    session = callbackResponse.session;
    await sessionStorage.storeSession(session);
  } catch (err: any) {
    console.error("[auth/callback] OAuth failed:", {
      message: err.message,
      name: err.constructor?.name,
      url: req.url,
      apiKey: process.env.SHOPIFY_API_KEY?.slice(0, 8) + "...",
      secretSet: !!process.env.SHOPIFY_API_SECRET,
    });
    return new Response(`OAuth failed: ${err.message}`, { status: 500 });
  }

  // Register webhooks — fire and forget
  registerWebhooks(session).catch((err) =>
    console.error("[auth/callback] Webhook registration failed:", err)
  );

  // Deregister old pixel (one pixel per shop — Guardrail #9)
  const existingShop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });

  if (existingShop?.pixelId) {
    try {
      await deregisterAppPixel(session.shop, session.accessToken!, existingShop.pixelId);
    } catch (err) {
      console.error("[auth/callback] Failed to deregister old pixel:", err);
    }
  }

  // Register new pixel
  let pixelId: string | undefined;
  try {
    pixelId = await registerAppPixel(session.shop, session.accessToken!);
    console.log(`[auth/callback] Pixel registered: ${pixelId}`);
  } catch (err) {
    console.error("[auth/callback] Pixel registration failed:", err);
  }

  // Upsert Shop record
  await prisma.shop.upsert({
    where: { shopDomain: session.shop },
    update: {
      accessToken: session.accessToken!,
      isActive: true,
      ...(pixelId ? { pixelId } : {}),
    },
    create: {
      shopDomain: session.shop,
      accessToken: session.accessToken!,
      isActive: true,
      ...(pixelId ? { pixelId } : {}),
    },
  });

  // Redirect to install confirmation
  const host = req.nextUrl.searchParams.get("host") || "";
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  return NextResponse.redirect(`${appUrl}/install?shop=${session.shop}&host=${host}`);
}
