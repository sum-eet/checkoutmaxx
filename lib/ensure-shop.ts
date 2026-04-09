import { supabase } from "./supabase";
import { getShopFromRequest, getSessionTokenFromRequest } from "./verify-session-token";
import { registerAppPixel } from "./pixel-registration";
import { registerWebhooks } from "./shopify";
import { Session } from "@shopify/shopify-api";

const activeShopCache = new Map<string, string>();

export async function ensureShop(
  req: Request
): Promise<{ shopId: string; shopDomain: string } | null> {
  console.log("[ensureShop] ====== START ======");

  const shopDomain = getShopFromRequest(req);
  console.log("[ensureShop] shopDomain from request:", shopDomain);
  if (!shopDomain) {
    console.error("[ensureShop] FAIL: no shopDomain in request");
    return null;
  }

  // Fast path: in-memory cache
  const cached = activeShopCache.get(shopDomain);
  if (cached) {
    console.log("[ensureShop] HIT cache:", shopDomain, "→", cached);
    return { shopId: cached, shopDomain };
  }

  // Check Supabase for active shop
  console.log("[ensureShop] Checking Supabase for active shop:", shopDomain);
  const { data: existing, error: lookupError } = await supabase
    .from("Shop")
    .select("id")
    .eq("shopDomain", shopDomain)
    .eq("isActive", true)
    .maybeSingle();

  console.log("[ensureShop] Supabase lookup result:", JSON.stringify(existing), "error:", lookupError?.message ?? "none");

  if (existing) {
    activeShopCache.set(shopDomain, existing.id);
    console.log("[ensureShop] FOUND existing shop:", existing.id);
    return { shopId: existing.id, shopDomain };
  }

  // Shop doesn't exist — need to provision via token exchange
  console.log("[ensureShop] No active shop found. Starting token exchange provisioning...");

  const sessionToken = getSessionTokenFromRequest(req);
  console.log("[ensureShop] Session token present:", !!sessionToken, "length:", sessionToken?.length ?? 0);
  if (sessionToken) {
    // Decode JWT payload (no verification, just to log what we're sending)
    try {
      const parts = sessionToken.split(".");
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      console.log("[ensureShop] JWT payload: iss:", payload.iss, "dest:", payload.dest, "exp:", payload.exp, "now:", Math.floor(Date.now() / 1000), "expired:", payload.exp < Math.floor(Date.now() / 1000));
    } catch {}
  }
  if (!sessionToken) {
    const url = new URL(req.url);
    const authHeader = req.headers.get("authorization");
    const idToken = url.searchParams.get("id_token");
    console.error("[ensureShop] FAIL: no session token. URL params:", url.searchParams.toString().slice(0, 200));
    console.error("[ensureShop] auth header present:", !!authHeader, "id_token param present:", !!idToken);
    return null;
  }

  // Try token exchange for access token (best effort — not required for data flow)
  console.log("[ensureShop] Attempting token exchange for", shopDomain, "...");
  const accessToken = await exchangeToken(shopDomain, sessionToken);
  console.log("[ensureShop] Token exchange result:", accessToken ? "SUCCESS" : "FAILED (will create Shop without access token)");

  // Create Shop record — with or without access token.
  // Data flow (cart events → DB → dashboard) works without it.
  // Access token is only needed for Admin API calls (pixel, discounts).
  const newId = crypto.randomUUID();
  console.log("[ensureShop] Creating Shop record:", newId, "for", shopDomain, "hasAccessToken:", !!accessToken);
  const { error: insertError } = await supabase.from("Shop").insert({
    id: newId,
    shopDomain,
    accessToken: accessToken || "pending_oauth",
    isActive: true,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (insertError) {
    console.error("[ensureShop] FAIL: Shop insert error:", insertError.message, insertError.code, insertError.details);
    return null;
  }

  console.log("[ensureShop] SUCCESS: Shop created:", newId);
  activeShopCache.set(shopDomain, newId);

  // Store session for Admin API calls (only if we have a real access token)
  if (accessToken) {
    try {
      const { PrismaSessionStorage } = await import("./session-storage");
      const storage = new PrismaSessionStorage();
      const session = new Session({
        id: `offline_${shopDomain}`,
        shop: shopDomain,
        state: "installed",
        isOnline: false,
      });
      session.accessToken = accessToken;
      await storage.storeSession(session);
      console.log("[ensureShop] Session stored for", shopDomain);
    } catch (err: any) {
      console.error("[ensureShop] Session store failed (non-fatal):", err.message);
    }
  }

  // Background: register pixel + webhooks (only if we have a real access token)
  if (accessToken) {
    registerBackgroundWork(shopDomain, accessToken, newId).catch((err) =>
      console.error("[ensureShop] Background work failed:", err.message)
    );
  } else {
    console.log("[ensureShop] Skipping pixel/webhook registration — no access token yet. Will be done when OAuth completes.");
  }

  console.log("[ensureShop] ====== DONE ======");
  return { shopId: newId, shopDomain };
}

export function clearShopCache(shopDomain: string) {
  activeShopCache.delete(shopDomain);
}

async function exchangeToken(
  shopDomain: string,
  sessionToken: string
): Promise<string | null> {
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  console.log("[exchangeToken] clientId present:", !!clientId, "clientSecret present:", !!clientSecret);
  if (!clientId || !clientSecret) {
    console.error("[exchangeToken] FAIL: missing env vars");
    return null;
  }

  const endpoint = `https://${shopDomain}/admin/oauth/access_token`;
  console.log("[exchangeToken] POST", endpoint);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: sessionToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id-token",
        requested_token_type:
          "urn:shopify:params:oauth:token-type:offline-access-token",
      }).toString(),
    });

    console.log("[exchangeToken] Response status:", res.status);
    const rawText = await res.text();
    console.log("[exchangeToken] Raw response (first 1000 chars):", rawText.slice(0, 1000));
    console.log("[exchangeToken] Raw response (1000-2000):", rawText.slice(1000, 2000));

    let body: any;
    try {
      body = JSON.parse(rawText);
    } catch {
      console.error("[exchangeToken] FAIL: response is not JSON. Status:", res.status);
      return null;
    }

    console.log("[exchangeToken] Response body keys:", Object.keys(body).join(", "));

    if (!res.ok || !body.access_token) {
      console.error("[exchangeToken] FAIL: status", res.status, "body:", JSON.stringify(body).slice(0, 500));
      return null;
    }

    console.log("[exchangeToken] SUCCESS: scope:", body.scope);
    return body.access_token;
  } catch (err: any) {
    console.error("[exchangeToken] FAIL: exception:", err.message);
    return null;
  }
}

async function registerBackgroundWork(
  shopDomain: string,
  accessToken: string,
  shopId: string
) {
  console.log("[ensureShop:bg] Starting background work for", shopDomain);

  try {
    console.log("[ensureShop:bg] Registering pixel...");
    const pixelId = await registerAppPixel(shopDomain, accessToken);
    if (pixelId) {
      await supabase.from("Shop").update({ pixelId }).eq("id", shopId);
      console.log("[ensureShop:bg] Pixel registered:", pixelId);
    } else {
      console.warn("[ensureShop:bg] registerAppPixel returned no pixelId");
    }
  } catch (err: any) {
    console.error("[ensureShop:bg] Pixel registration failed:", err.message);
  }

  try {
    console.log("[ensureShop:bg] Registering webhooks...");
    const session = new Session({
      id: `offline_${shopDomain}`,
      shop: shopDomain,
      state: "installed",
      isOnline: false,
    });
    session.accessToken = accessToken;
    await registerWebhooks(session);
    console.log("[ensureShop:bg] Webhooks registered");
  } catch (err: any) {
    console.error("[ensureShop:bg] Webhook registration failed:", err.message);
  }

  console.log("[ensureShop:bg] Background work complete for", shopDomain);
}
