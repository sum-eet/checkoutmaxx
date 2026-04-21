import { supabase } from "./supabase";

export async function getShop(
  shopDomain: string
): Promise<{ id: string; accessToken: string; pixelId: string | null } | null> {
  console.log("[shop] getShop shopDomain=%s", shopDomain);

  const { data: rows, error } = await supabase
    .from("Shop")
    .select("id, accessToken, pixelId, isActive")
    .eq("shopDomain", shopDomain)
    .eq("isActive", true)
    .order("installedAt", { ascending: false });

  if (error) {
    console.error("[shop] getShop SELECT failed:", error.code, error.message);
    return null;
  }

  // Primary: trust .eq("isActive", true). Fallback: JS filter handles Supabase boolean coercion.
  let match = (rows ?? []).find((r: any) => r.isActive === true) ?? null;
  if (!match && rows && rows.length > 0) {
    match = rows.find((r: any) =>
      r.isActive === "true" || r.isActive === 1 || r.isActive === "1"
    ) ?? null;
    if (match) console.log("[shop] getShop: JS boolean fallback matched for %s", shopDomain);
  }

  if (!match) {
    console.log("[shop] getShop: no active shop found for %s", shopDomain);
    return null;
  }

  console.log("[shop] getShop → %s", match.id);
  return { id: match.id, accessToken: match.accessToken, pixelId: match.pixelId ?? null };
}

export async function createShop(
  shopDomain: string,
  accessToken: string
): Promise<{ id: string }> {
  console.log("[shop] createShop shopDomain=%s", shopDomain);

  const { data, error } = await supabase
    .rpc("create_shop", { p_shop_domain: shopDomain, p_access_token: accessToken })
    .single();

  if (!error && data) {
    const id = (data as any).id as string;
    console.log("[shop] createShop created id=%s", id);
    return { id };
  }

  // 23505 = unique constraint violation — concurrent install race, re-read winner
  if (error?.code === "23505") {
    console.log("[shop] createShop 23505 race — re-reading winner for %s", shopDomain);
    const { data: rows } = await supabase
      .from("Shop")
      .select("id, isActive")
      .eq("shopDomain", shopDomain)
      .order("installedAt", { ascending: false });
    const winner = (rows ?? []).find(
      (r: any) => r.isActive === true || r.isActive === "true" || r.isActive === 1 || r.isActive === "1"
    );
    if (winner?.id) {
      console.log("[shop] createShop race_resolved id=%s", winner.id);
      return { id: winner.id };
    }
  }

  throw new Error(
    `[shop] createShop failed shopDomain=${shopDomain}: ${error?.message ?? "unknown"}`
  );
}

export async function upgradeToken(
  shopId: string,
  accessToken: string
): Promise<void> {
  console.log("[shop] upgradeToken shopId=%s", shopId);
  const { error } = await supabase
    .from("Shop")
    .update({ accessToken, updatedAt: new Date().toISOString() })
    .eq("id", shopId);
  if (error) {
    console.error("[shop] upgradeToken failed:", error.code, error.message);
  }
}
