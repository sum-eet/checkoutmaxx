import { supabase } from "./supabase";
import { Session } from "@shopify/shopify-api";
import { sessionStorage, registerWebhooks } from "./shopify";
import { exchangeTokenForOffline } from "./token-exchange";
import { registerAppPixel } from "./pixel";
import { waitUntil } from "@vercel/functions";

export async function getShop(
  shopDomain: string
): Promise<{ id: string; accessToken: string; pixelId: string | null } | null> {
  console.log("[shop] getShop shopDomain=%s", shopDomain);

  const { data, error } = await supabase
    .from("Shop")
    .select("id, accessToken, pixelId, isActive")
    .eq("shopDomain", shopDomain)
    .maybeSingle();

  if (error) {
    console.error("[shop] getShop SELECT failed", error.code, error.message);
    return null;
  }
  if (!data) {
    console.log("[shop] getShop: no row for %s", shopDomain);
    return null;
  }
  if (data.isActive !== true && data.isActive !== "true" && data.isActive !== 1) {
    console.log("[shop] getShop: row inactive for %s", shopDomain);
    return null;
  }
  if (!data.accessToken) {
    console.log("[shop] getShop: row has no accessToken (uninstalled) for %s", shopDomain);
    return null;
  }
  console.log("[shop] getShop → %s", data.id);
  return { id: data.id, accessToken: data.accessToken, pixelId: data.pixelId ?? null };
}

export async function ensureShop(
  shopDomain: string,
  sessionToken: string
): Promise<{ id: string; accessToken: string; pixelId: string | null } | null> {
  const existing = await getShop(shopDomain);
  if (existing) return existing;

  console.log("[shop] ensureShop provisioning via token-exchange for %s", shopDomain);
  let accessToken: string;
  try {
    accessToken = await exchangeTokenForOffline(shopDomain, sessionToken);
  } catch (e: any) {
    console.error("[shop] ensureShop token-exchange failed", e.message);
    return null;
  }

  // Persist offline session so billing/callback + webhooks still work.
  try {
    const session = new Session({
      id: `offline_${shopDomain}`, shop: shopDomain, state: "installed", isOnline: false,
    });
    session.accessToken = accessToken;
    await sessionStorage.storeSession(session);
  } catch (e: any) {
    console.error("[shop] ensureShop session store failed", e.message);
  }

  let created;
  try {
    created = await createShop(shopDomain, accessToken);
  } catch (e: any) {
    console.error("[shop] ensureShop createShop failed", e.message);
    return null;
  }

  const shopCap = shopDomain, tokCap = accessToken, idCap = created.id;
  waitUntil(Promise.all([
    (async () => {
      try {
        const pid = await registerAppPixel(shopCap, tokCap);
        if (pid) await supabase.from("Shop").update({ pixelId: pid }).eq("id", idCap);
        console.log("[shop] ensureShop pixel bg ok", pid);
      } catch (e: any) { console.error("[shop] ensureShop pixel bg", e?.message); }
    })(),
    (async () => {
      try {
        const s = new Session({ id: `offline_${shopCap}`, shop: shopCap, state: "installed", isOnline: false });
        s.accessToken = tokCap;
        await registerWebhooks(s);
        console.log("[shop] ensureShop webhooks bg ok");
      } catch (e: any) { console.error("[shop] ensureShop webhook bg", e?.message); }
    })(),
  ]));

  console.log("[shop] ensureShop ok id=%s shop=%s", created.id, shopDomain);
  return { id: created.id, accessToken, pixelId: null };
}

export async function createShop(
  shopDomain: string,
  accessToken: string
): Promise<{ id: string; prevPixelId: string | null }> {
  console.log("[shop] createShop shopDomain=%s", shopDomain);
  const { data, error } = await supabase
    .rpc("create_shop", { p_shop_domain: shopDomain, p_access_token: accessToken })
    .single();
  if (error || !data) {
    throw new Error(`[shop] createShop failed for ${shopDomain}: ${error?.message ?? "unknown"}`);
  }
  const id = (data as any).id as string;
  const prev = ((data as any).prev_pixel_id as string | null) ?? null;
  console.log("[shop] createShop id=%s prevPixel=%s", id, prev);
  return { id, prevPixelId: prev };
}
