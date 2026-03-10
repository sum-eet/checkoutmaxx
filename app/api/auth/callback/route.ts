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
    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: new Response(),
    });
    session = callbackResponse.session;

    // Persist session
    await sessionStorage.storeSession(session);
  } catch (err: any) {
    console.error("[auth/callback] OAuth failed:", err.message);
    return NextResponse.json({ error: "OAuth failed" }, { status: 500 });
  }

  // Register webhooks (fire and forget — don't block redirect)
  registerWebhooks(session).catch((err) =>
    console.error("[auth/callback] Webhook registration failed:", err)
  );

  // Deregister old pixel if one exists (one pixel per shop — Guardrail #9)
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

  // Redirect to install confirmation screen
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const host = req.nextUrl.searchParams.get("host") || "";
  return NextResponse.redirect(`${appUrl}/install?shop=${session.shop}&host=${host}`);
}
