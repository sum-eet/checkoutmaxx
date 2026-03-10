export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { sessionStorage, registerWebhooks } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";
import prisma from "@/lib/prisma";
import { registerAppPixel, deregisterAppPixel } from "@/lib/pixel-registration";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const shop = params.get("shop");
  const code = params.get("code");
  const state = params.get("state");
  const hmac = params.get("hmac");

  // --- 1. Validate state (CSRF) ---
  const storedState = req.cookies.get("shopify_oauth_state")?.value;
  if (!state || state !== storedState) {
    console.error("[callback] State mismatch", { state, storedState });
    return new Response("State mismatch — possible CSRF", { status: 403 });
  }

  // --- 2. Validate HMAC ---
  if (!hmac || !shop || !code) {
    return new Response("Missing required OAuth params", { status: 400 });
  }

  const secret = process.env.SHOPIFY_API_SECRET!;

  // Build param string from the RAW query string to avoid URLSearchParams decoding issues
  const rawSearch = req.nextUrl.search.slice(1); // remove leading ?
  const rawPairs = rawSearch
    .split("&")
    .map((pair) => pair.split("=") as [string, string])
    .filter(([key]) => decodeURIComponent(key) !== "hmac")
    .sort(([a], [b]) => decodeURIComponent(a).localeCompare(decodeURIComponent(b)))
    .map(([k, v]) => `${decodeURIComponent(k)}=${decodeURIComponent(v ?? "")}`)
    .join("&");

  const digest = createHmac("sha256", secret).update(rawPairs).digest("hex");

  console.log("[callback] HMAC check", {
    paramString: rawPairs,
    expected: digest.slice(0, 8) + "...",
    received: hmac?.slice(0, 8) + "...",
    match: digest === hmac,
  });

  if (digest !== hmac) {
    return new Response("HMAC validation failed", { status: 403 });
  }

  // --- 3. Exchange code for access token ---
  let accessToken: string;
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

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("[callback] Token exchange failed:", body);
      return new Response(`Token exchange failed: ${body}`, { status: 500 });
    }

    const data = await tokenRes.json() as { access_token: string };
    accessToken = data.access_token;
  } catch (err: any) {
    console.error("[callback] Token exchange error:", err.message);
    return new Response("Token exchange error", { status: 500 });
  }

  // --- 4. Store session ---
  const sessionId = `offline_${shop}`;
  const session = new Session({ id: sessionId, shop, state: state!, isOnline: false });
  session.accessToken = accessToken;
  session.scope = "read_orders,read_checkouts,write_pixels,read_analytics";
  await sessionStorage.storeSession(session);

  // --- 5. Register webhooks (fire and forget) ---
  registerWebhooks(session).catch((err) =>
    console.error("[callback] Webhook registration failed:", err)
  );

  // --- 6. Register pixel (one per shop) ---
  const existingShop = await prisma.shop.findUnique({ where: { shopDomain: shop } });

  if (existingShop?.pixelId) {
    try {
      await deregisterAppPixel(shop, accessToken, existingShop.pixelId);
    } catch (err) {
      console.error("[callback] Failed to deregister old pixel:", err);
    }
  }

  let pixelId: string | undefined;
  try {
    pixelId = await registerAppPixel(shop, accessToken);
    console.log(`[callback] Pixel registered: ${pixelId}`);
  } catch (err) {
    console.error("[callback] Pixel registration failed:", err);
  }

  // --- 7. Upsert Shop record ---
  await prisma.shop.upsert({
    where: { shopDomain: shop },
    update: { accessToken, isActive: true, ...(pixelId ? { pixelId } : {}) },
    create: { shopDomain: shop, accessToken, isActive: true, ...(pixelId ? { pixelId } : {}) },
  });

  // --- 8. Clear state cookie and redirect to install screen ---
  const host = params.get("host") || "";
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const response = NextResponse.redirect(`${appUrl}/install?shop=${shop}&host=${host}`);
  response.cookies.set("shopify_oauth_state", "", { maxAge: 0 });
  return response;
}
