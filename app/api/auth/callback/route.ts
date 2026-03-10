export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { shopify, sessionStorage, registerWebhooks } from "@/lib/shopify";
import prisma from "@/lib/prisma";
import { registerAppPixel, deregisterAppPixel } from "@/lib/pixel-registration";

export async function GET(req: NextRequest) {
  console.log("[auth/callback] incoming:", req.url);

  let session;
  try {
    const result = await shopify.auth.callback({ rawRequest: req });
    session = result.session;
    await sessionStorage.storeSession(session);
    console.log("[auth/callback] session stored for:", session.shop);
  } catch (err: any) {
    console.error("[auth/callback] failed:", err.constructor?.name, err.message);
    return new Response(`Auth failed: ${err.message}`, { status: 500 });
  }

  registerWebhooks(session).catch(console.error);

  const existingShop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (existingShop?.pixelId) {
    deregisterAppPixel(session.shop, session.accessToken!, existingShop.pixelId).catch(console.error);
  }

  let pixelId: string | undefined;
  try {
    pixelId = await registerAppPixel(session.shop, session.accessToken!);
    console.log("[auth/callback] pixel registered:", pixelId);
  } catch (err) {
    console.error("[auth/callback] pixel registration failed:", err);
  }

  await prisma.shop.upsert({
    where: { shopDomain: session.shop },
    update: { accessToken: session.accessToken!, isActive: true, ...(pixelId ? { pixelId } : {}) },
    create: { shopDomain: session.shop, accessToken: session.accessToken!, isActive: true, ...(pixelId ? { pixelId } : {}) },
  });

  const host = req.nextUrl.searchParams.get("host") || "";
  const appUrl = process.env.SHOPIFY_APP_URL || `https://${req.nextUrl.host}`;
  return NextResponse.redirect(`${appUrl}/install?shop=${session.shop}&host=${host}`);
}
