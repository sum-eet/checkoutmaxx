export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { Session } from "@shopify/shopify-api";
import { sessionStorage } from "@/lib/shopify";
import prisma from "@/lib/prisma";
import { registerAppPixel, deregisterAppPixel } from "@/lib/pixel-registration";
import { registerWebhooks } from "@/lib/shopify";

/**
 * Manual OAuth callback — no state/cookie dependency.
 * Validates HMAC (proves Shopify signed this), exchanges code for access token,
 * stores session and upserts shop row.
 */
export async function GET(req: NextRequest) {
  console.log("!!!!!!! AUTH CALLBACK HIT !!!!!!!", new Date().toISOString(), req.url);
  console.log("[auth/callback] incoming:", req.url);

  const params = req.nextUrl.searchParams;
  const shop = params.get("shop");
  const code = params.get("code");
  const hmac = params.get("hmac");
  const host = params.get("host") ?? "";

  if (!shop || !code || !hmac) {
    console.error("[auth/callback] missing params:", { shop, code: !!code, hmac: !!hmac });
    return new Response("Missing required OAuth params", { status: 400 });
  }

  // 1. Validate HMAC — proves Shopify sent this request
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("[auth/callback] SHOPIFY_API_SECRET not set");
    return new Response("Server misconfiguration", { status: 500 });
  }

  const pairs: string[] = [];
  params.forEach((v, k) => {
    if (k !== "hmac") pairs.push(`${k}=${v}`);
  });
  pairs.sort();
  const message = pairs.join("&");
  const expected = createHmac("sha256", secret).update(message).digest("hex");

  try {
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"))) {
      console.error("[auth/callback] HMAC mismatch");
      return new Response("HMAC validation failed", { status: 403 });
    }
  } catch {
    console.error("[auth/callback] HMAC comparison error (likely bad hmac format)");
    return new Response("Invalid HMAC", { status: 403 });
  }

  console.log("!!!! STEP 1 HMAC OK:", shop);
  console.log("[auth/callback] HMAC valid for shop:", shop);

  // 2. Exchange code for access token
  let accessToken: string;
  let scope: string;
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });
    const body = await tokenRes.json();
    if (!tokenRes.ok || !body.access_token) {
      console.error("[auth/callback] token exchange failed:", body);
      return new Response(`Token exchange failed: ${JSON.stringify(body)}`, { status: 500 });
    }
    accessToken = body.access_token;
    scope = body.scope ?? "";
    console.log("!!!! STEP 2 TOKEN OK:", shop);
    console.log("[auth/callback] token received for:", shop);
  } catch (err: any) {
    console.error("[auth/callback] token exchange error:", err.message);
    return new Response(`Token exchange error: ${err.message}`, { status: 500 });
  }

  // 3. Store Shopify session (so the rest of the app can use shopify API clients)
  const sessionId = `offline_${shop}`;
  const session = new Session({ id: sessionId, shop, state: "installed", isOnline: false });
  session.accessToken = accessToken;
  session.scope = scope;
  await sessionStorage.storeSession(session);
  console.log("!!!! STEP 3 SESSION STORED:", shop);
  console.log("[auth/callback] session stored for:", shop);

  // 4. Register webhooks (fire and forget)
  registerWebhooks(session).catch(console.error);

  // 5. Register pixel (deregister old one first if exists)
  console.log("!!!! STEP 4 PIXEL START:", shop);
  const existingShop = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (existingShop?.pixelId) {
    deregisterAppPixel(shop, accessToken, existingShop.pixelId).catch(console.error);
  }

  let pixelId: string | undefined;
  try {
    pixelId = await registerAppPixel(shop, accessToken);
    console.log("!!!! STEP 4 PIXEL DONE:", shop, "pixelId:", pixelId);
    console.log("[auth/callback] pixel registered:", pixelId);
  } catch (err) {
    console.error("[auth/callback] pixel registration failed:", err);
  }

  // 6. Upsert shop row
  console.log("!!!! STEP 5 UPSERT START:", shop);
  try {
    await prisma.shop.upsert({
      where: { shopDomain: shop },
      update: { accessToken, isActive: true, ...(pixelId ? { pixelId } : {}) },
      create: { shopDomain: shop, accessToken, isActive: true, ...(pixelId ? { pixelId } : {}) },
    });
    console.log("!!!! STEP 5 UPSERT DONE:", shop);
    console.log("[auth/callback] shop upserted:", shop);
    // Verify what's actually in the DB right now
    const verify = await prisma.shop.findUnique({ where: { shopDomain: shop }, select: { id: true, isActive: true, pixelId: true, updatedAt: true } });
    console.log("!!!! STEP 5 DB VERIFY:", JSON.stringify(verify));
  } catch (err: any) {
    console.error("[auth/callback] DB upsert failed:", err.message);
    return new Response(`DB write failed: ${err.message}`, { status: 500 });
  }

  // 7. Redirect into the embedded app (must go via Shopify admin URL so App Bridge initialises)
  // host = base64("admin.shopify.com/store/{handle}") → redirect to admin-framed app URL
  console.log("!!!! STEP 6 REDIRECTING:", shop);
  const apiKey = process.env.SHOPIFY_API_KEY!;
  let redirectUrl: string;
  try {
    const hostDecoded = Buffer.from(host, "base64").toString("utf8"); // e.g. admin.shopify.com/store/testingstoresumeet
    redirectUrl = `https://${hostDecoded}/apps/${apiKey}/welcome`;
  } catch {
    // Fallback: legacy /admin/apps path
    redirectUrl = `https://${shop}/admin/apps/${apiKey}/welcome`;
  }
  return NextResponse.redirect(redirectUrl);
}
