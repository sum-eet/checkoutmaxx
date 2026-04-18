# CouponMaxx Analytics 400 Bug — Senior Developer Diagnostic Brief

**Date:** 2026-04-13  
**Branch:** `couponmaxx-submission`  
**Production URL:** `https://couponmaxx.vercel.app`  
**Vercel Project:** `prj_u62c2wWg65D6uhvOp45kQG4GBcbn`  
**Supabase Project:** `voohvpscahyosapcxbfn.supabase.co`

---

## Symptom

Every request to `/api/couponmaxx/analytics` and `/api/couponmaxx/recovery/stats` returns HTTP 400 with:

```json
{ "error": "Missing shop" }
```

This happens consistently after a Shopify app reinstall. There was **exactly one 200 response** (at 10:51:42 UTC on 2026-04-13) and then every request after that fails.

The frontend shows "Failed to load analytics data" permanently.

---

## What Is NOT the Problem

- **Database is healthy.** Direct SQL confirms one active Shop row exists:
  ```
  id: 277abf96-25c3-4a90-9473-a552e70ed738
  shopDomain: testingstoresumeet.myshopify.com
  isActive: true  (boolean, confirmed via pg_typeof)
  installedAt: 2026-04-13 10:51:43.737
  accessToken: shpat_dbb8...  (real token, not "pending_oauth")
  ```

- **No RLS.** `relrowsecurity: false` on Shop table. No policies. Service role key bypasses RLS anyway.

- **Column type is correct.** `isActive` is `boolean` / `bool` in PostgreSQL.

- **Supabase connection works.** INSERTs reach the DB (evidence: 409 responses in Supabase API logs).

- **RPCs work.** All 4 analytics RPCs (`couponmaxx_funnel_totals`, `couponmaxx_daily_cart_metrics`, etc.) tested directly and return correct data.

- **Shop domain extraction works.** `?shop=testingstoresumeet.myshopify.com` is present in all failing URLs and falls through as the correct value.

---

## The Code Path That Fails

All analytics/recovery routes call `ensureShop(req)` first (`lib/ensure-shop.ts`). If it returns null, the route returns 400.

### `ensureShop` flow (committed HEAD — branch `couponmaxx-submission`):

```typescript
// 1. Extract shopDomain from request
const shopDomain = getShopFromRequest(req);
// → "testingstoresumeet.myshopify.com" ✓

// 2. SELECT all Shop rows for this domain
const { data: allShops } = await supabase
  .from("Shop")
  .select("id, accessToken, isActive")
  .eq("shopDomain", shopDomain);
// NOTE: error is silently discarded (not destructured)

// 3. JS filter for active shops
const activeShops = (allShops ?? []).filter(
  s => s.isActive === true || s.isActive === "true" as any
);
const existing = activeShops[0] ?? null;
// → existing = null  ← THIS IS WRONG. 277abf96 should be found here.

// 4. No active shop found, try token exchange
const sessionToken = getSessionTokenFromRequest(req);
// → null (JWT is expired — exp was ~11pm on April 12)

// 5. No session token → bail
if (!sessionToken) {
  if (existing) return { shopId: existing.id, shopDomain };
  return null;  // ← RETURNS NULL → route returns 400
}
```

---

## The Core Mystery

**`existing` is null even though `277abf96` (isActive=true) is in the DB.**

Two scenarios could cause this:

### Scenario A: SELECT returns rows but JS filter fails (most likely)
`allShops` contains `277abf96` but `s.isActive` is not `=== true` and not `=== "true"`. 

Possible reasons:
- PostgREST returns boolean `true` as something JS doesn't strict-equal to `true` (unlikely for a boolean column but possible with certain Supabase JS client versions or response transformers)
- The Supabase client in production uses different env vars and connects to a different/shadow DB

### Scenario B: SELECT returns 0 rows entirely (silent error)
The `error` from the Supabase SELECT is never logged. If the SELECT fails (wrong credentials, network timeout, permission issue), `data` is null, `allShops ?? []` is `[]`, filter returns `[]`.

The SELECT error goes undetected because the code does `const { data: allShops } = ...` (error silently dropped).

**Supporting evidence for Scenario A:** Supabase API logs show `POST | 409 | /rest/v1/Shop` — a 409 is a 23505 unique constraint violation on the partial index `Shop_shopDomain_active_unique ON Shop(shopDomain) WHERE isActive=true`. This proves `277abf96` (isActive=true) EXISTS in the DB when the INSERT fires. So the SELECT ran and got some result (even if that result missed the active row due to filter failure).

**Supporting evidence for Scenario B:** The "INSERT FAILED" log string (from the final `console.error` in `ensureShop`) appears in logs for most failing requests. This log is only reached if INSERT fails with a non-23505 error. If the SELECT returned 0 rows (data=null due to silent error), INSERT would be attempted AND might fail with a different error if there's a constraint other than the partial unique index.

---

## The One Success (10:51:42)

The one 200 response happened milliseconds before the shop was created by the auth callback. At that moment:
- Session token JWT was still valid (not yet expired)
- `ensureShop` found no active shop (auth callback hadn't finished yet)
- Token exchange succeeded
- A new Shop row was created by `ensureShop` itself
- Returns that new shopId → analytics returns 200

Then 1 second later, the auth callback also created `277abf96` (deactivating whatever `ensureShop` just created).

After that: JWT is expired, `sessionToken = null`, JS filter finds nothing, `existing = null`, returns null → 400.

---

## What Was Tried / Prior Art

From `git log --oneline`:
- `54f7708` — "fix: handle isActive as string from PostgREST + no-cache headers" — added `|| s.isActive === "true"` to the JS filter
- `6f97887` — "fix: stop ensureShop from deactivating records on every request" — removed a deactivation call
- `110225b` — "fix: bypass broken Supabase .eq(isActive, true) filter in ensureShop" — replaced direct Supabase filter with JS-side filtering (this commit says `.eq("isActive", true)` was returning INACTIVE records too, i.e., false positives)

The JS filter approach was introduced to fix false-positives from `.eq("isActive", true)`. But now the JS filter itself fails, suggesting the underlying `isActive` value comparison is not working in production.

---

## Recommended Investigation Steps

### 1. Add raw logging to `ensureShop` (immediate)

Add these two lines after the SELECT:

```typescript
const { data: allShops, error: selectError } = await supabase...
console.error("[ensureShop] selectError:", selectError?.code, selectError?.message);
console.log("[ensureShop] raw allShops:", JSON.stringify(
  (allShops ?? []).map(s => ({ id: s.id?.slice(0, 8), isActive: s.isActive, typeof: typeof s.isActive }))
));
```

Deploy and check Vercel logs. This will show exactly what PostgREST returns.

### 2. Verify Vercel env vars match .env

Check that Vercel has the correct `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. If these differ from the local `.env`, the app may be hitting a different Supabase project entirely.

Local `.env` values:
```
SUPABASE_URL=https://voohvpscahyosapcxbfn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvb2h2cHNjYWh5b3NhcGN4YmZuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzEzNTAyNCwiZXhwIjoyMDg4NzExMDI0fQ...
```

### 3. Add a dual-strategy fallback (fix)

When JS filter finds nothing, retry with direct `.eq("isActive", true)` before giving up:

```typescript
// If JS filter found nothing, try direct Supabase filter as fallback
if (!existing) {
  const { data: directActive } = await supabase
    .from("Shop")
    .select("id, accessToken, isActive")
    .eq("shopDomain", shopDomain)
    .eq("isActive", true)
    .order("installedAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (directActive?.id) existing = directActive;
}
```

Note: `resolveShopId()` in `app/api/cart/ingest/route.ts` uses `.eq("isActive", true)` directly and works correctly — so this pattern is viable.

### 4. Fix the `if (!sessionToken)` early-exit

Currently when `sessionToken = null` AND `existing = null`, the function returns null immediately. A more resilient approach: after the early exit path, add one final Supabase `.eq("isActive", true)` call as last resort before returning null.

### 5. Check `ensureShop` conflict handler

When INSERT returns 23505, the conflict handler does a second SELECT with JS filter. If the same filter bug applies, it also returns null. The conflict handler should use `.eq("isActive", true)` directly.

---

## Files to Review

| File | Issue |
|------|-------|
| `lib/ensure-shop.ts` | JS filter for isActive, silent SELECT error, conflict handler |
| `lib/supabase.ts` | Verify service role key is correct in Vercel |
| `app/api/couponmaxx/analytics/route.ts` | Only 400 path is `!shopResult` — fix is in ensureShop |
| `app/api/couponmaxx/recovery/stats/route.ts` | Same |

---

## Quick Win / Hotfix

The most targeted fix with lowest risk: in `ensureShop`, after the JS filter returns nothing, add a direct `.eq("isActive", true)` Supabase call. This mirrors what `resolveShopId` does and should correctly find `277abf96`. Commit and push to `couponmaxx-submission` — Vercel auto-deploys in ~90 seconds.
