import { supabase } from "./supabase";
import { getShopFromRequest, getSessionTokenFromRequest } from "./verify-session-token";
import { registerAppPixel } from "./pixel-registration";
import { registerWebhooks } from "./shopify";
import { Session } from "@shopify/shopify-api";

// In-memory cache: shopDomain → shopId for the ACTIVE shop.
// Only caches successful lookups. Cleared on cold start.
const activeShopCache = new Map<string, string>();

/**
 * Ensure a Shop record exists for the authenticated merchant.
 *
 * Fast path: Shop exists in cache or Supabase → return shopId.
 * Slow path: Shop missing → exchange App Bridge JWT for offline access token
 *            → create new Shop record → register pixel + webhooks → return shopId.
 *
 * This is the SINGLE source of truth for Shop provisioning.
 * Called from dashboard API routes (shop-status, analytics, etc.).
 * Safe because the request is authenticated via App Bridge JWT.
 */
export async function ensureShop(
  req: Request
): Promise<{ shopId: string; shopDomain: string } | null> {
  const shopDomain = getShopFromRequest(req);
  if (!shopDomain) return null;

  // Fast path: in-memory cache
  const cached = activeShopCache.get(shopDomain);
  if (cached) return { shopId: cached, shopDomain };

  // Check Supabase for active shop
  const { data: existing } = await supabase
    .from("Shop")
    .select("id")
    .eq("shopDomain", shopDomain)
    .eq("isActive", true)
    .maybeSingle();

  if (existing) {
    activeShopCache.set(shopDomain, existing.id);
    return { shopId: existing.id, shopDomain };
  }

  // Shop doesn't exist — provision it via token exchange
  console.log("[ensureShop] No active shop for", shopDomain, "— provisioning via token exchange");

  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) {
    console.error("[ensureShop] No session token available for token exchange");
    return null;
  }

  // Exchange App Bridge JWT for offline access token
  const accessToken = await exchangeToken(shopDomain, sessionToken);
  if (!accessToken) {
    console.error("[ensureShop] Token exchange failed for", shopDomain);
    return null;
  }

  // Create new Shop record with fresh cuid
  const newId = crypto.randomUUID();
  const { error: insertError } = await supabase.from("Shop").insert({
    id: newId,
    shopDomain,
    accessToken,
    isActive: true,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (insertError) {
    console.error("[ensureShop] Shop insert failed:", insertError.message);
    return null;
  }

  console.log("[ensureShop] Shop created:", newId, "for", shopDomain);
  activeShopCache.set(shopDomain, newId);

  // Store session for Admin API calls (Prisma session storage)
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
    console.error("[ensureShop] Session store failed:", err.message);
  }

  // Background: register pixel + webhooks (don't block the response)
  registerBackgroundWork(shopDomain, accessToken, newId).catch((err) =>
    console.error("[ensureShop] Background work failed:", err.message)
  );

  return { shopId: newId, shopDomain };
}

/**
 * Clear the cache for a shop (e.g., on uninstall).
 */
export function clearShopCache(shopDomain: string) {
  activeShopCache.delete(shopDomain);
}

/**
 * Exchange an App Bridge session token (JWT) for an offline access token.
 * Uses Shopify's RFC 8693 token exchange endpoint.
 */
async function exchangeToken(
  shopDomain: string,
  sessionToken: string
): Promise<string | null> {
  const clientId = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[exchangeToken] Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET");
    return null;
  }

  try {
    const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
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

    const body = await res.json();
    if (!res.ok || !body.access_token) {
      console.error("[exchangeToken] Failed:", JSON.stringify(body));
      return null;
    }

    console.log("[exchangeToken] Success for", shopDomain, "scope:", body.scope);
    return body.access_token;
  } catch (err: any) {
    console.error("[exchangeToken] Error:", err.message);
    return null;
  }
}

async function registerBackgroundWork(
  shopDomain: string,
  accessToken: string,
  shopId: string
) {
  // Register app pixel
  try {
    const pixelId = await registerAppPixel(shopDomain, accessToken);
    if (pixelId) {
      await supabase
        .from("Shop")
        .update({ pixelId })
        .eq("id", shopId);
      console.log("[ensureShop] Pixel registered:", pixelId);
    }
  } catch (err: any) {
    console.error("[ensureShop] Pixel registration failed:", err.message);
  }

  // Register webhooks
  try {
    const session = new Session({
      id: `offline_${shopDomain}`,
      shop: shopDomain,
      state: "installed",
      isOnline: false,
    });
    session.accessToken = accessToken;
    await registerWebhooks(session);
    console.log("[ensureShop] Webhooks registered");
  } catch (err: any) {
    console.error("[ensureShop] Webhook registration failed:", err.message);
  }
}
