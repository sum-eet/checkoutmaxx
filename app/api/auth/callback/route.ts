export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { Session } from "@shopify/shopify-api";
import { sessionStorage, registerWebhooks } from "@/lib/shopify";
import { waitUntil } from "@vercel/functions";
import { supabase } from "@/lib/supabase";
import { createShop } from "@/lib/shop";
import { ensurePixel } from "@/lib/pixel";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  console.log("[AUTH] ====== CALLBACK START ======", new Date().toISOString());

  const params = req.nextUrl.searchParams;
  const shop = params.get("shop");
  const code = params.get("code");
  const hmac = params.get("hmac");
  const state = params.get("state");
  params.get("host");

  if (!shop || !code || !hmac) {
    console.error("[AUTH] MISSING PARAMS:", { shop: !!shop, code: !!code, hmac: !!hmac });
    return new Response("Missing required OAuth params", { status: 400 });
  }

  // CSRF
  const storedState = req.cookies.get("shopify_oauth_state")?.value;
  if (!state || !storedState || state !== storedState) {
    console.error("[AUTH] STATE MISMATCH — possible CSRF attack");
    return new Response("State validation failed", { status: 403 });
  }

  // HMAC
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("[AUTH] NO SHOPIFY_API_SECRET ENV VAR");
    return new Response("Server misconfiguration", { status: 500 });
  }

  const pairs: string[] = [];
  params.forEach((v, k) => { if (k !== "hmac") pairs.push(`${k}=${v}`); });
  pairs.sort();
  const expected = createHmac("sha256", secret).update(pairs.join("&")).digest("hex");

  try {
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"))) {
      console.error("[AUTH] HMAC MISMATCH");
      return new Response("HMAC validation failed", { status: 403 });
    }
  } catch {
    console.error("[AUTH] HMAC COMPARISON ERROR");
    return new Response("Invalid HMAC", { status: 403 });
  }
  console.log(`[AUTH] STEP 1 HMAC OK (${Date.now() - t0}ms):`, shop);

  // Token exchange
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
      console.error("[AUTH] TOKEN EXCHANGE FAILED:", JSON.stringify(body));
      return new Response("Token exchange failed", { status: 500 });
    }
    accessToken = body.access_token;
    scope = body.scope ?? "";
  } catch (err: any) {
    console.error("[AUTH] TOKEN EXCHANGE ERROR:", err.message);
    return new Response("Token exchange error", { status: 500 });
  }
  console.log(`[AUTH] STEP 2 TOKEN OK (${Date.now() - t0}ms):`, shop);

  // Store session
  try {
    const session = new Session({
      id: `offline_${shop}`,
      shop,
      state: "installed",
      isOnline: false,
    });
    session.accessToken = accessToken;
    session.scope = scope;
    await sessionStorage.storeSession(session);
  } catch (err: any) {
    console.error("[AUTH] SESSION STORE FAILED:", err.message);
  }
  console.log(`[AUTH] STEP 3 SESSION OK (${Date.now() - t0}ms):`, shop);

  // Create shop row via atomic RPC
  let shopId: string;
  try {
    const result = await createShop(shop, accessToken);
    shopId = result.id;
    console.log(`[AUTH] STEP 4 createShop OK (${Date.now() - t0}ms): ${shopId}`);
  } catch (err: any) {
    console.error("[AUTH] STEP 4 createShop FAILED:", err.message);
    return new Response(
      `Shop provisioning failed. Please try reinstalling the app.\n${err.message}`,
      { status: 500 }
    );
  }

  // Background: pixel registration + webhook registration
  const shopIdCapture = shopId;
  const accessTokenCapture = accessToken;
  const shopCapture = shop;
  waitUntil(Promise.all([
    ensurePixel(shopCapture, accessTokenCapture).then(async (pid) => {
      if (pid) {
        const { error } = await supabase
          .from("Shop")
          .update({ pixelId: pid })
          .eq("id", shopIdCapture);
        if (error) console.error("[AUTH] BG: pixelId update failed:", error.message);
        else console.log("[AUTH] BG: pixel registered pixelId=%s", pid);
      } else {
        console.log("[AUTH] BG: ensurePixel → null; pixel may be live without stored id");
      }
    }),
    (async () => {
      try {
        const session = new Session({
          id: `offline_${shopCapture}`,
          shop: shopCapture,
          state: "installed",
          isOnline: false,
        });
        session.accessToken = accessTokenCapture;
        await registerWebhooks(session);
        console.log("[AUTH] BG: webhooks registered");
      } catch (err: any) {
        console.error("[AUTH] BG: webhook registration error:", err.message);
      }
    })(),
  ]));

  // Redirect
  const shopHandle = shop.replace(".myshopify.com", "");
  const redirectUrl = `https://admin.shopify.com/store/${shopHandle}/apps/${process.env.SHOPIFY_API_KEY}`;
  console.log(`[AUTH] STEP 5 REDIRECTING (${Date.now() - t0}ms):`, redirectUrl);

  const finalResponse = NextResponse.redirect(redirectUrl);
  finalResponse.cookies.delete("shopify_oauth_state");
  return finalResponse;
}
