export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { Session } from "@shopify/shopify-api";
import { sessionStorage } from "@/lib/shopify";
import { supabase } from "@/lib/supabase";
import { registerAppPixel, deregisterAppPixel } from "@/lib/pixel-registration";
import { registerWebhooks } from "@/lib/shopify";
import { provisionShop } from "@/lib/provision-shop";
import { isTruthyActive } from "@/lib/is-active";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  console.log("[AUTH] ====== CALLBACK START ======", new Date().toISOString());

  const params = req.nextUrl.searchParams;
  const shop = params.get("shop");
  const code = params.get("code");
  const hmac = params.get("hmac");
  const state = params.get("state");
  // host param not used — redirect goes to admin.shopify.com canonical URL
  params.get("host");

  if (!shop || !code || !hmac) {
    console.error("[AUTH] MISSING PARAMS:", { shop: !!shop, code: !!code, hmac: !!hmac });
    return new Response("Missing required OAuth params", { status: 400 });
  }

  // ── STEP 0: STATE VALIDATION (CSRF) ──
  const storedState = req.cookies.get("shopify_oauth_state")?.value;
  if (!state || !storedState || state !== storedState) {
    console.error("[AUTH] STATE MISMATCH — possible CSRF attack");
    return new Response("State validation failed", { status: 403 });
  }

  // ── STEP 1: HMAC ──
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

  // ── STEP 2: TOKEN EXCHANGE ──
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

  // ── STEP 3: STORE SESSION ──
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
    // Don't return 500 — shop upsert is more important
  }
  console.log(`[AUTH] STEP 3 SESSION OK (${Date.now() - t0}ms):`, shop);

  // ── STEP 4: PROVISION SHOP (canonical path via provisionShop) ──
  // Fetch old pixelId before provisioning so BG work can deregister it.
  const { data: allOldShops } = await supabase
    .from("Shop")
    .select("id, pixelId, isActive")
    .eq("shopDomain", shop);
  const oldShop = (allOldShops ?? []).find((s) => isTruthyActive(s.isActive)) ?? null;
  const oldPixelId = oldShop?.pixelId ?? null;
  if (oldShop) {
    console.log(`[AUTH] STEP 4 found old shop record:`, oldShop.id);
  }

  let shopRecord: { id: string } | null = null;
  try {
    const result = await provisionShop(shop, accessToken);
    shopRecord = { id: result.shopId };
    console.log(`[AUTH] STEP 4 SHOP PROVISIONED (${Date.now() - t0}ms): ${result.shopId} (old: ${oldShop?.id ?? "none"})`);
  } catch (err: any) {
    console.error("[AUTH] STEP 4 provisionShop FAILED:", err.message);
    return new Response(
      `Shop provisioning failed. Please try reinstalling the app.\n${err.message}`,
      { status: 500 }
    );
  }

  // ── STEP 5: REDIRECT ──
  const shopHandle = shop.replace(".myshopify.com", "");
  const redirectUrl = `https://admin.shopify.com/store/${shopHandle}/apps/${process.env.SHOPIFY_API_KEY}`;
  console.log(`[AUTH] STEP 5 REDIRECTING (${Date.now() - t0}ms):`, redirectUrl);

  // ── STEP 6: BACKGROUND WORK ──
  const backgroundWork = async () => {
    const bgStart = Date.now();

    if (oldPixelId) {
      try {
        await deregisterAppPixel(shop, accessToken, oldPixelId);
        console.log(`[AUTH] BG: old pixel deregistered (${Date.now() - bgStart}ms)`);
      } catch (err: any) {
        console.error("[AUTH] BG: deregister pixel error:", err.message);
      }
    }

    try {
      const newPixelId = await registerAppPixel(shop, accessToken);
      if (newPixelId && shopRecord) {
        await supabase
          .from("Shop")
          .update({ pixelId: newPixelId })
          .eq("id", shopRecord.id);
        console.log(`[AUTH] BG: pixel registered (${Date.now() - bgStart}ms):`, newPixelId);
      }
    } catch (err: any) {
      console.error("[AUTH] BG: pixel registration error:", err.message);
    }

    try {
      const session = new Session({
        id: `offline_${shop}`,
        shop,
        state: "installed",
        isOnline: false,
      });
      session.accessToken = accessToken;
      await registerWebhooks(session);
      console.log(`[AUTH] BG: webhooks registered (${Date.now() - bgStart}ms)`);
    } catch (err: any) {
      console.error("[AUTH] BG: webhook registration error:", err.message);
    }

    console.log(`[AUTH] BG: all background work done (${Date.now() - bgStart}ms)`);
  };

  backgroundWork().catch((err) => console.error("[AUTH] BG: uncaught error:", err));

  console.log(`[AUTH] ====== CALLBACK DONE (${Date.now() - t0}ms) ======`);
  const finalResponse = NextResponse.redirect(redirectUrl);
  finalResponse.cookies.delete("shopify_oauth_state");
  return finalResponse;
}
