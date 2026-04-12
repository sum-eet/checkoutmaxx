import { supabase } from "./supabase";
import { shopify } from "./shopify";
import { RequestedTokenType } from "@shopify/shopify-api";
import { getShopFromRequest, getSessionTokenFromRequest } from "./verify-session-token";
import { registerAppPixel } from "./pixel-registration";
import { registerWebhooks } from "./shopify";
import { Session } from "@shopify/shopify-api";

/**
 * Ensure a Shop record exists with a valid access token.
 * No in-memory cache — always hits DB to avoid stale data after uninstall/reinstall.
 */
export async function ensureShop(
  req: Request
): Promise<{ shopId: string; shopDomain: string } | null> {
  const url = new URL(req.url);
  console.log("[ensureShop] START url=%s", url.pathname + url.search);
  console.log("[ensureShop] headers: auth=%s, id_token=%s, shop=%s",
    req.headers.get("authorization")?.slice(0, 20) ?? "NONE",
    url.searchParams.get("id_token")?.slice(0, 20) ?? "NONE",
    url.searchParams.get("shop") ?? "NONE"
  );

  const shopDomain = getShopFromRequest(req);
  console.log("[ensureShop] shopDomain=%s", shopDomain ?? "NULL");
  if (!shopDomain) {
    console.error("[ensureShop] BAIL: no shopDomain from request");
    return null;
  }

  // Check DB for active shop with real token
  const { data: existing, error: existingError } = await supabase
    .from("Shop")
    .select("id, accessToken")
    .eq("shopDomain", shopDomain)
    .eq("isActive", true)
    .maybeSingle();

  console.log("[ensureShop] DB lookup: existing=%s, error=%s",
    existing ? `${existing.id} (token=${existing.accessToken?.slice(0, 10)}...)` : "NULL",
    existingError ? existingError.message : "none"
  );

  if (existing && existing.accessToken && existing.accessToken !== "pending_oauth") {
    console.log("[ensureShop] RETURNING existing active shop:", existing.id);
    return { shopId: existing.id, shopDomain };
  }

  // Need a real access token — use Shopify SDK token exchange
  console.log("[ensureShop] No active shop with real token. Attempting token exchange...");

  const sessionToken = getSessionTokenFromRequest(req);
  console.log("[ensureShop] sessionToken=%s", sessionToken ? `${sessionToken.slice(0, 30)}...` : "NULL");
  if (!sessionToken) {
    console.log("[ensureShop] BAIL: no session token. existing=%s", existing ? existing.id : "NULL");
    if (existing) return { shopId: existing.id, shopDomain };
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

    try {
      const { sessionStorage } = await import("./shopify");
      await sessionStorage.storeSession(session);
    } catch (err: any) {
      console.error("[ensureShop] Session store failed (non-fatal):", err.message);
    }
  } catch (err: any) {
    console.error("[ensureShop] Token exchange FAILED:", err.message, err.stack?.slice(0, 200));
  }

  console.log("[ensureShop] After token exchange: accessToken=%s, existing=%s",
    accessToken ? `${accessToken.slice(0, 10)}...` : "NULL",
    existing ? existing.id : "NULL"
  );

  // If shop exists (with pending token), update it
  if (existing) {
    if (accessToken) {
      await supabase
        .from("Shop")
        .update({ accessToken, updatedAt: new Date().toISOString() })
        .eq("id", existing.id);
      console.log("[ensureShop] Updated access token for", shopDomain);
      registerBackgroundWork(shopDomain, accessToken, existing.id);
    }
    return { shopId: existing.id, shopDomain };
  }

  // No active shop — deactivate any old records, then create fresh
  // This handles reinstalls where the uninstall webhook may not have fired yet
  await supabase
    .from("Shop")
    .update({ isActive: false, pixelId: null })
    .eq("shopDomain", shopDomain)
    .eq("isActive", true);

  const newId = crypto.randomUUID();
  console.log("[ensureShop] Creating fresh Shop row:", newId, "for", shopDomain, "hasToken:", !!accessToken);
  const { error: insertError } = await supabase.from("Shop").insert({
    id: newId,
    shopDomain,
    accessToken: accessToken || "pending_oauth",
    isActive: true,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (insertError) {
    console.error("[ensureShop] INSERT FAILED: code=%s message=%s", insertError.code, insertError.message);
    if (insertError.code === "23505") {
      const { data: raceShop } = await supabase
        .from("Shop")
        .select("id")
        .eq("shopDomain", shopDomain)
        .eq("isActive", true)
        .maybeSingle();
      console.log("[ensureShop] Race condition recovery: raceShop=%s", raceShop?.id ?? "NULL");
      if (raceShop) return { shopId: raceShop.id, shopDomain };
    }
    return null;
  }

  console.log("[ensureShop] SUCCESS: Shop created with id=%s, hasRealToken=%s", newId, !!accessToken);

  if (accessToken) {
    registerBackgroundWork(shopDomain, accessToken, newId);
  }

  return { shopId: newId, shopDomain };
}

function registerBackgroundWork(shopDomain: string, accessToken: string, shopId: string) {
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
