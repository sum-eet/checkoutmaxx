import { supabase } from "./supabase";

/**
 * Canonical "find the active Shop row for a domain" lookup.
 * Avoids Supabase PostgREST boolean-coercion bug that makes
 * `.eq("isActive", true)` match inactive rows after reinstall.
 *
 * Same JS-filter pattern as ensureShop + provisionShop.
 */
export async function getActiveShop(
  shopDomain: string,
  columns: string = "id"
): Promise<Record<string, any> | null> {
  const selectCols = columns.includes("isActive") ? columns : `${columns}, isActive`;
  const { data: rows, error } = await supabase
    .from("Shop")
    .select(selectCols)
    .eq("shopDomain", shopDomain)
    .order("installedAt", { ascending: false });

  if (error) {
    console.error("[getActiveShop] SELECT failed:", error.code, error.message);
    return null;
  }
  const active = (rows ?? []).find(
    (r: any) => r.isActive === true || r.isActive === "true"
  );
  return active ?? null;
}
