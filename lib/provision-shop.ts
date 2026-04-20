import { supabase } from "./supabase";
import { isTruthyActive } from "./is-active";

export interface ProvisionShopResult {
  shopId: string;
}

/**
 * THE canonical Shop-provisioning function.
 * Called by auth/callback AND ensureShop — nowhere else creates Shop rows.
 *
 * Contract:
 *   1. Deactivate ALL active rows for shopDomain.
 *   2. Insert fresh UUID row with supplied accessToken.
 *   3. On 23505 race: re-query and return the winner.
 *   4. Always returns { shopId } or throws — no silent failures.
 *
 * Note: ensureShop passes "pending_oauth" as accessToken when no active shop
 * exists and token exchange hasn't completed yet. provisionShop creates the
 * row normally. The upgrade (pending_oauth → real token) happens in ensureShop
 * via in-place update on the existing row.
 */
export async function provisionShop(
  shopDomain: string,
  accessToken: string
): Promise<ProvisionShopResult> {
  console.log(`[provisionShop] START shop=${shopDomain}`);

  // Step 1: deactivate all existing rows for this domain (handles delayed uninstall webhook)
  const { error: deactivateError } = await supabase
    .from("Shop")
    .update({ isActive: false, updatedAt: new Date().toISOString() })
    .eq("shopDomain", shopDomain);

  if (deactivateError) {
    // Non-fatal — old rows may already be inactive; proceed with insert
    console.warn(`[provisionShop] deactivate warning shop=${shopDomain}: ${deactivateError.message}`);
  }

  // Step 2: insert fresh row
  const newId = crypto.randomUUID();
  const { data, error: insertError } = await supabase
    .from("Shop")
    .insert({
      id: newId,
      shopDomain,
      accessToken,
      isActive: true,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (!insertError && data) {
    console.log(`[provisionShop] shop=${shopDomain} outcome=created id=${data.id}`);
    return { shopId: data.id };
  }

  // Step 3: 23505 = unique constraint violation — race condition, re-query the winner.
  // Filter isActive in JS — Supabase PostgREST boolean coercion can stringify "true",
  // causing .eq("isActive", true) to miss the row. Same pattern as auth/callback.
  if (insertError?.code === "23505") {
    console.log(`[provisionShop] shop=${shopDomain} outcome=race_resolved — re-querying`);
    const { data: rows, error: raceErr } = await supabase
      .from("Shop")
      .select("id, isActive")
      .eq("shopDomain", shopDomain)
      .order("installedAt", { ascending: false });

    if (raceErr) {
      throw new Error(`[provisionShop] race re-query failed shop=${shopDomain}: ${raceErr.message}`);
    }
    const winner = (rows ?? []).find((r) => isTruthyActive(r.isActive)) ?? null;
    if (winner?.id) {
      console.log(`[provisionShop] shop=${shopDomain} outcome=race_resolved id=${winner.id}`);
      return { shopId: winner.id };
    }
  }

  throw new Error(
    `[provisionShop] INSERT FAILED shop=${shopDomain}: ${insertError?.message ?? "unknown error"}`
  );
}
