import { supabase } from "./supabase";
import { shopify } from "./shopify";
import { RequestedTokenType } from "@shopify/shopify-api";
import { getShopFromRequest, getSessionTokenFromRequest } from "./verify-session-token";
import { registerAppPixel } from "./pixel-registration";
import { registerWebhooks } from "./shopify";
import { Session } from "@shopify/shopify-api";

const activeShopCache = new Map<string, string>();

/**
 * Ensure a Shop record exists with a valid access token.
 * Uses Shopify SDK's tokenExchange — the official way to get access tokens
 * for embedded apps. Works for fresh installs AND reinstalls identically.
 */
export async function ensureShop(
  req: Request
): Promise<{ shopId: string; shopDomain: string } | null> {
  const shopDomain = getShopFromRequest(req);
  if (!shopDomain) return null;

  // Fast path: cache hit
  const cached = activeShopCache.get(shopDomain);
  if (cached) return { shopId: cached, shopDomain };

  // Check DB for active shop with real token
  const { data: existing } = await supabase
    .from("Shop")
    .select("id, accessToken")
    .eq("shopDomain", shopDomain)
    .eq("isActive", true)
    .maybeSingle();

  if (existing && existing.accessToken && existing.accessToken !== "pending_oauth") {
    activeShopCache.set(shopDomain, existing.id);
    return { shopId: existing.id, shopDomain };
  }

  // Need a real access token — use Shopify SDK token exchange
  console.log("[ensureShop] Need access token for", shopDomain);

  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) {
    console.log("[ensureShop] No session token in request — can't exchange");
    // If shop exists with pending token, still return it so data can flow
    if (existing) {
      activeShopCache.set(shopDomain, existing.id);
      return { shopId: existing.id, shopDomain };
    }
    return null;
  }

  // Exchange session token for offline access token via Shopify SDK
  let accessToken: string | null = null;
  try {
    const { session } = await shopify.auth.tokenExchange({
      shop: shopDomain,
      sessionToken,
      requestedTokenType: RequestedTokenType.OfflineAccessToken,
    });
    accessToken = session.accessToken ?? null;
    console.log("[ensureShop] Token exchange SUCCESS for", shopDomain);

    // Store session for Admin API calls
    try {
      const { sessionStorage } = await import("./shopify");
      await sessionStorage.storeSession(session);
    } catch (err: any) {
      console.error("[ensureShop] Session store failed (non-fatal):", err.message);
    }
  } catch (err: any) {
    console.error("[ensureShop] Token exchange failed:", err.message);
  }

  // If shop exists, update its access token
  if (existing) {
    if (accessToken) {
      await supabase
        .from("Shop")
        .update({ accessToken, updatedAt: new Date().toISOString() })
        .eq("id", existing.id);
      console.log("[ensureShop] Updated access token for", shopDomain);

      // Register pixel + webhooks in background
      registerBackgroundWork(shopDomain, accessToken, existing.id);
    }
    activeShopCache.set(shopDomain, existing.id);
    return { shopId: existing.id, shopDomain };
  }

  // No shop exists — create one
  const newId = crypto.randomUUID();
  const { error: insertError } = await supabase.from("Shop").insert({
    id: newId,
    shopDomain,
    accessToken: accessToken || "pending_oauth",
    isActive: true,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (insertError) {
    // Race condition — another request created it. Fetch it.
    if (insertError.code === "23505") {
      const { data: raceShop } = await supabase
        .from("Shop")
        .select("id")
        .eq("shopDomain", shopDomain)
        .eq("isActive", true)
        .maybeSingle();
      if (raceShop) {
        activeShopCache.set(shopDomain, raceShop.id);
        return { shopId: raceShop.id, shopDomain };
      }
    }
    console.error("[ensureShop] Insert failed:", insertError.message);
    return null;
  }

  console.log("[ensureShop] Shop created:", newId, "hasRealToken:", !!accessToken);
  activeShopCache.set(shopDomain, newId);

  if (accessToken) {
    registerBackgroundWork(shopDomain, accessToken, newId);
  }

  return { shopId: newId, shopDomain };
}

export function clearShopCache(shopDomain: string) {
  activeShopCache.delete(shopDomain);
}

function registerBackgroundWork(shopDomain: string, accessToken: string, shopId: string) {
  // Fire and forget
  (async () => {
    try {
      const pixelId = await registerAppPixel(shopDomain, accessToken);
      if (pixelId) {
        await supabase.from("Shop").update({ pixelId }).eq("id", shopId);
        console.log("[ensureShop:bg] Pixel registered:", pixelId);
      }
    } catch (err: any) {
      console.error("[ensureShop:bg] Pixel registration failed:", err.message);
    }

    try {
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
  })().catch(err => console.error("[ensureShop:bg] Error:", err.message));
}
