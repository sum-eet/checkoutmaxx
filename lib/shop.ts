import { supabase } from "./supabase";

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
