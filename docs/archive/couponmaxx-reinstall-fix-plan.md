# CouponMaxx — Reinstall Bug: Complete Fix Plan

## The Problem

When a shop uninstalls and reinstalls the app, old analytics from the previous installation appear in the dashboard. This happens despite the system creating a new Shop row with a new UUID on every reinstall.

---

## Root Cause Analysis

Three bugs work together to produce this behavior.

### Bug #1: Auth Callback Deactivation Silently Fails (PRIMARY)

**File:** `app/api/auth/callback/route.ts` lines 119–123

The callback deactivates old Shop rows using `.eq("isActive", true)` as a Supabase filter. But this project has a documented bug where Supabase's `.eq("isActive", true)` is unreliable — sometimes returning or matching against stringified booleans incorrectly. The `ensureShop` function already works around this with JS-side filtering (lines 32–33 of `lib/ensure-shop.ts`), but the auth callback does not.

**Result:** On reinstall, old rows are NOT deactivated. Multiple active rows coexist for the same domain.

### Bug #2: ensureShop Returns the Wrong Row

**File:** `lib/ensure-shop.ts` around line 40

When multiple active rows exist (caused by Bug #1), `activeShops[0]` returns whichever row Postgres returns first — typically the oldest by heap order. No `ORDER BY installedAt DESC` is applied.

**Result:** The embedded app resolves the OLD shopId. All dashboard analytics queries use the old shopId, pulling up old data.

### Bug #3: Cart Ingest Cache Never Expires

**File:** `app/api/cart/ingest/route.ts` lines 6–24

The `shopCache` is a plain `Map<shopDomain, shopId>` with no TTL. After reinstall, warm Vercel function instances continue mapping the domain to the old shopId until the instance is recycled.

**Result:** New cart events get written to the old shopId, inflating old analytics and starving the new install of data.

### How They Chain Together

```
Reinstall triggers OAuth callback
  → Bug #1: deactivation fails silently, old row stays active
  → Two active rows now exist for same domain
  → Bug #2: ensureShop picks the older row (no ORDER BY)
  → Dashboard queries use old shopId → old analytics appear
  → Bug #3: cart ingest cache also holds old shopId
  → New events written to old shopId → problem compounds
```

---

## Fixes

### Fix 1: Auth Callback — Remove isActive filter from deactivation

**File:** `app/api/auth/callback/route.ts`

**Before (lines 119–123):**
```typescript
await supabase.from("Shop")
  .update({ isActive: false, pixelId: null })
  .eq("shopDomain", shop).eq("isActive", true);
```

**After:**
```typescript
await supabase.from("Shop")
  .update({ isActive: false, pixelId: null })
  .eq("shopDomain", shop);
```

This deactivates ALL rows for the domain — active, inactive, or ambiguously-stored boolean. Safe because a fresh active row is inserted immediately after.

**Also fix the oldShop lookup (lines 108–113):**

**Before:**
```typescript
const { data: oldShop } = await supabase
  .from("Shop").select("id, pixelId")
  .eq("shopDomain", shop).eq("isActive", true).maybeSingle();
```

**After:**
```typescript
const { data: allShops } = await supabase
  .from("Shop").select("id, pixelId, isActive")
  .eq("shopDomain", shop);
const oldShop = (allShops ?? []).find(
  s => s.isActive === true || s.isActive === "true"
) ?? null;
```

### Fix 2: ensureShop — Sort by installedAt DESC

**File:** `lib/ensure-shop.ts`

**Before (lines 34–37):**
```typescript
const { data: allShops } = await supabase.from("Shop")
  .select("id, accessToken, isActive").eq("shopDomain", shopDomain);
```

**After:**
```typescript
const { data: allShops } = await supabase.from("Shop")
  .select("id, accessToken, isActive, installedAt")
  .eq("shopDomain", shopDomain)
  .order("installedAt", { ascending: false });
```

Now `activeShops[0]` after JS filtering is always the most recently installed shop.

### Fix 3: Cart Ingest — Add TTL to cache

**File:** `app/api/cart/ingest/route.ts`

**Before (lines 6–24):**
```typescript
const shopCache = new Map<string, string>();

async function resolveShopId(shopDomain: string): Promise<string | null> {
  if (shopCache.has(shopDomain)) return shopCache.get(shopDomain)!;
  const { data } = await supabase.from("Shop").select("id")
    .eq("shopDomain", shopDomain).eq("isActive", true).maybeSingle();
  if (data?.id) {
    shopCache.set(shopDomain, data.id);
    return data.id;
  }
  return null;
}
```

**After:**
```typescript
const CACHE_TTL_MS = 60_000;
const shopCache = new Map<string, { id: string; cachedAt: number }>();

async function resolveShopId(shopDomain: string): Promise<string | null> {
  const cached = shopCache.get(shopDomain);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.id;
  }
  shopCache.delete(shopDomain);
  const { data } = await supabase.from("Shop").select("id")
    .eq("shopDomain", shopDomain).eq("isActive", true)
    .order("installedAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id) {
    shopCache.set(shopDomain, { id: data.id, cachedAt: Date.now() });
    return data.id;
  }
  return null;
}
```

### Fix 4 (Bonus): Add the missing partial unique index

**Create migration file** or run directly in Supabase SQL editor:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopDomain_active_unique"
ON "Shop" ("shopDomain")
WHERE "isActive" = true;
```

This makes the bug impossible at the database level — two active rows for the same domain will throw a constraint violation.

---

## Shopify Docs Verification

All fixes were cross-checked against Shopify's official developer documentation (shopify.dev):

**OAuth on reinstall** — Confirmed: Shopify fires a fresh OAuth flow on every reinstall. The callback always fires. Our fix of deactivating old rows and inserting a new one on each callback is correct.

**app/uninstalled webhook is NOT guaranteed** — Shopify explicitly states webhook delivery isn't guaranteed and can be delayed up to a day. This means the uninstall handler might never fire, so the callback deactivation (Fix 1) is the critical safety net. The app should NOT assume old rows were already soft-deleted by the uninstall webhook. Removing the `.eq("isActive", true)` filter handles this — it deactivates everything regardless.

**Offline access tokens** — Shopify issues a fresh token on each OAuth. The app correctly replaces the session via `storeSession()` with the deterministic `offline_{shop}` key.

**Shop identity** — Shopify provides a persistent numeric `shop.id` (e.g., `548380009`, GID `gid://shopify/Shop/548380009`) that survives across uninstall/reinstall. The current architecture intentionally does NOT use this as the PK because the app wants each install to be a clean slate for analytics. This is a valid design choice — using a new UUID per install is correct for this use case.

**HMAC verification** — SHA-256 HMAC with base64 encoding (`X-Shopify-Hmac-Sha256` header) is confirmed as the current standard.

**Web pixels** — Pixels are NOT auto-deregistered on uninstall. The app already re-registers the pixel post-callback (lines 177–219 of the callback route). No change needed.

---

## Known Limitation: SessionPing

The `SessionPing` table uses `shopDomain` (not `shopId`) as its identifier. The `couponmaxx_utm_sessions` RPC filters by `p_shop_domain`. This means UTM session data leaks across installs by design.

**Not in current fix scope** but should be addressed by:
1. Adding a `shopId` column to `SessionPing`
2. Updating the RPC to filter by `shopId`
3. Backfilling existing rows if needed

---

## Additional Recommendation: Reconciliation Job

Shopify docs explicitly say: *"Your app shouldn't rely solely on receiving data from Shopify webhooks."* Since `app/uninstalled` can be delayed or missed entirely, consider adding a lightweight reconciliation job that runs periodically (e.g., daily cron):

```typescript
// Pseudocode — check if shops are still installed
for each activeShop in Shop WHERE isActive = true:
  try:
    response = GET /admin/api/2024-10/shop.json (using shop's accessToken)
    if response.status === 401 or 403:
      // Token revoked = app was uninstalled
      deactivate(activeShop)
  catch:
    // Network error — skip, retry next run
```

This catches the case where uninstall webhook was missed and prevents ghost active rows from accumulating.

---

## Deployment Order

1. **Deploy the partial unique index first** — run the SQL migration. If it fails because duplicates already exist, clean them up first:
   ```sql
   -- Find domains with multiple active rows
   SELECT "shopDomain", COUNT(*)
   FROM "Shop"
   WHERE "isActive" = true
   GROUP BY "shopDomain"
   HAVING COUNT(*) > 1;

   -- For each duplicate: keep the newest, deactivate the rest
   WITH ranked AS (
     SELECT id, "shopDomain",
       ROW_NUMBER() OVER (PARTITION BY "shopDomain" ORDER BY "installedAt" DESC) as rn
     FROM "Shop"
     WHERE "isActive" = true
   )
   UPDATE "Shop" SET "isActive" = false
   WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
   ```
2. **Deploy code changes** (Fixes 1–3) in a single release
3. **Run the E2E test suite** from `couponmaxx-reinstall-tests.md`
4. **Monitor** for 24h — check that no new duplicate active rows appear

---

## Files Changed

| File | Change | Lines |
|---|---|---|
| `app/api/auth/callback/route.ts` | Remove `.eq("isActive", true)` from deactivation; JS-filter oldShop lookup | ~108–123 |
| `lib/ensure-shop.ts` | Add `.order("installedAt", { ascending: false })` to query | ~34–37 |
| `app/api/cart/ingest/route.ts` | Replace `Map<string,string>` with TTL cache; add `.order()` and `.limit(1)` | ~6–24 |
| Supabase migration (new) | Add partial unique index on `Shop(shopDomain) WHERE isActive = true` | New file |

---

## Claude Code Prompt

Copy-paste this into Claude Code to apply all fixes:

```
Apply the following four fixes to resolve the reinstall analytics bug. Make each change exactly as specified.

**Fix 1 — app/api/auth/callback/route.ts:**
- Lines ~119–123: Remove `.eq("isActive", true)` from the deactivation query. Change it to `.eq("shopDomain", shop)` only (no isActive filter). We want to deactivate ALL rows for this domain.
- Lines ~108–113: Replace the oldShop lookup. Instead of `.eq("isActive", true).maybeSingle()`, fetch all rows for the domain and filter in JS:
  ```
  const { data: allShops } = await supabase.from("Shop").select("id, pixelId, isActive").eq("shopDomain", shop);
  const oldShop = (allShops ?? []).find(s => s.isActive === true || s.isActive === "true") ?? null;
  ```

**Fix 2 — lib/ensure-shop.ts:**
- Lines ~34–37: Add `.order("installedAt", { ascending: false })` to the Supabase query. Also add `installedAt` to the select list.

**Fix 3 — app/api/cart/ingest/route.ts:**
- Lines ~6–24: Replace the shopCache with a TTL-based cache (60 second TTL). Store `{ id: string, cachedAt: number }` instead of plain string. On lookup, delete stale entries. Also add `.order("installedAt", { ascending: false }).limit(1)` to the resolveShopId query.

**Fix 4 — New Supabase migration:**
- Create a SQL migration that adds a partial unique index: `CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopDomain_active_unique" ON "Shop" ("shopDomain") WHERE "isActive" = true;`

After making changes, verify:
1. No `.eq("isActive", true)` remains in the callback deactivation
2. ensureShop query has ORDER BY
3. Cart cache has TTL
4. Migration file exists
```
