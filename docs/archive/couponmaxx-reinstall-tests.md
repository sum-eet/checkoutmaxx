# CouponMaxx Reinstall Bug — Test Cases

> Paste these into your test framework or use them as manual QA steps.
> Each test targets one of the three root causes identified in the diagnostic.

---

## Test Suite 1: Auth Callback Deactivation (Bug #1)

### Test 1.1 — Reinstall deactivates ALL previous rows regardless of isActive state

**Setup:**
Manually insert two Shop rows for the same domain — one with `isActive: true`, one already `isActive: false` (simulating a corrupted state where boolean filter previously failed).

```sql
INSERT INTO "Shop" (id, "shopDomain", "accessToken", "isActive", "installedAt", "updatedAt")
VALUES
  ('old-active-111', 'testshop.myshopify.com', 'tok_old_active', true, now() - interval '30 days', now()),
  ('old-inactive-222', 'testshop.myshopify.com', 'tok_old_inactive', false, now() - interval '60 days', now());
```

**Action:**
Trigger the OAuth callback for `testshop.myshopify.com` (simulate reinstall).

**Expected:**
- Both `old-active-111` and `old-inactive-222` have `isActive = false`
- A NEW row exists with `isActive = true` and a fresh UUID
- Total active rows for `testshop.myshopify.com` = exactly 1

**Query to verify:**
```sql
SELECT id, "isActive", "installedAt"
FROM "Shop"
WHERE "shopDomain" = 'testshop.myshopify.com'
ORDER BY "installedAt" DESC;
```

---

### Test 1.2 — Reinstall with Supabase boolean edge case

**Setup:**
Insert a Shop row where `isActive` is stored as the string `"true"` (the PostgREST bug documented in ensure-shop.ts).

```sql
-- If your column is boolean this won't apply directly,
-- but test that the deactivation query handles it:
INSERT INTO "Shop" (id, "shopDomain", "accessToken", "isActive", "installedAt", "updatedAt")
VALUES ('string-bool-333', 'booltest.myshopify.com', 'tok_bool', true, now() - interval '10 days', now());
```

**Action:**
Trigger OAuth callback for `booltest.myshopify.com`.

**Expected:**
- `string-bool-333` is deactivated (`isActive = false`)
- Exactly one active row exists for `booltest.myshopify.com`

---

### Test 1.3 — Fresh install (no prior rows) still works

**Setup:**
Ensure no rows exist for `brandnew.myshopify.com`.

**Action:**
Trigger OAuth callback for `brandnew.myshopify.com`.

**Expected:**
- Exactly one row created with `isActive = true`
- No errors in the deactivation step (it should be a no-op, not a failure)

---

### Test 1.4 — Callback oldShop lookup uses JS filtering, not Supabase boolean filter

**Setup:**
This is a code-level test. In `app/api/auth/callback/route.ts`, the query that finds the old shop for pixel migration should NOT use `.eq("isActive", true)`.

**Verify:**
```
grep -n 'eq.*isActive.*true' app/api/auth/callback/route.ts
```

**Expected:**
Zero matches. The callback should either:
- Not filter by `isActive` at all (fetch all, filter in JS), or
- Deactivate all rows for the domain without checking `isActive`

---

## Test Suite 2: ensureShop Row Ordering (Bug #2)

### Test 2.1 — ensureShop returns the NEWEST active row

**Setup:**
Insert two active rows for the same domain with different `installedAt` timestamps:

```sql
INSERT INTO "Shop" (id, "shopDomain", "accessToken", "isActive", "installedAt", "updatedAt")
VALUES
  ('oldest-aaa', 'ordertest.myshopify.com', 'tok_old', true, '2024-01-01T00:00:00Z', now()),
  ('newest-bbb', 'ordertest.myshopify.com', 'tok_new', true, '2025-04-13T00:00:00Z', now());
```

**Action:**
Call `ensureShop('ordertest.myshopify.com')` (or hit any authenticated API endpoint for this shop).

**Expected:**
- Returns shop ID `newest-bbb`, NOT `oldest-aaa`
- Dashboard analytics query uses `newest-bbb` as the `shopId`

---

### Test 2.2 — ensureShop with single active row (happy path)

**Setup:**
One active row for `singleshop.myshopify.com`.

**Action:**
Call `ensureShop('singleshop.myshopify.com')`.

**Expected:**
- Returns that single row's ID
- No errors

---

### Test 2.3 — ensureShop Supabase query includes ORDER BY

**Verify (code-level):**
```
grep -A5 'from.*Shop.*select' lib/ensure-shop.ts | grep -i 'order'
```

**Expected:**
The query includes `.order("installedAt", { ascending: false })`.

---

## Test Suite 3: Cart Ingest Cache TTL (Bug #3)

### Test 3.1 — Cache expires after TTL

**Setup:**
1. Ensure `testcache.myshopify.com` has an active Shop row with ID `cache-old-id`
2. Send a cart event for `testcache.myshopify.com` (populates cache)
3. Deactivate `cache-old-id`, insert new row with ID `cache-new-id` (simulating reinstall)
4. Wait > 60 seconds (or whatever CACHE_TTL_MS is set to)

**Action:**
Send another cart event for `testcache.myshopify.com`.

**Expected:**
- The event is stored with `shopId = cache-new-id` (the new row)
- NOT `cache-old-id`

---

### Test 3.2 — Cache serves valid entries within TTL

**Setup:**
1. Active Shop row for `fastshop.myshopify.com` with ID `fast-id`
2. Send first cart event (populates cache)

**Action:**
Immediately send a second cart event.

**Expected:**
- Second event resolves `shopId` from cache (no DB query)
- Event stored with `shopId = fast-id`

---

### Test 3.3 — Cache miss triggers fresh DB lookup

**Setup:**
No prior cart events for `newshop.myshopify.com`. Active row exists with ID `new-id`.

**Action:**
Send a cart event for `newshop.myshopify.com`.

**Expected:**
- DB lookup occurs
- Event stored with `shopId = new-id`
- Subsequent events within TTL served from cache

---

### Test 3.4 — resolveShopId query uses ORDER BY and LIMIT

**Verify (code-level):**
```
grep -A10 'resolveShopId' app/api/cart/ingest/route.ts | grep -E 'order|limit'
```

**Expected:**
Query includes `.order("installedAt", { ascending: false }).limit(1)`.

---

## Test Suite 4: End-to-End Reinstall Flow

### Test 4.1 — Full reinstall: old analytics do NOT appear

**Steps:**
1. Install app on `e2e-test.myshopify.com` → note the `shopId` (call it `id-v1`)
2. Generate some cart/checkout events → verify analytics show data
3. Uninstall the app → verify `isActive = false` on shop row
4. Reinstall the app → note the NEW `shopId` (call it `id-v2`)
5. Open the analytics dashboard

**Expected:**
- Dashboard shows ZERO events (clean slate)
- `id-v1 !== id-v2`
- Old events still exist in DB under `id-v1` but are not queried
- No `SessionPing` data leaks across (since it uses `shopDomain` — see Bonus below)

---

### Test 4.2 — Reinstall: new events go to new shopId

**Steps:**
1. After Test 4.1 reinstall, generate new cart events
2. Query `CartEvent` table

**Expected:**
- New events have `shopId = id-v2`
- No new events have `shopId = id-v1`

---

### Test 4.3 — Partial unique index enforcement

**Setup:**
After applying the `Shop_shopDomain_active_unique` partial unique index.

**Action:**
Try to insert two rows with the same `shopDomain` and `isActive = true`.

**Expected:**
- Second insert fails with error code `23505` (unique constraint violation)
- Confirms the database now prevents the bug at the schema level

---

## Test Suite 5: SessionPing Cross-Install Leakage (Known Limitation)

### Test 5.1 — SessionPing uses shopDomain, leaks across installs

**Setup:**
1. Install, generate SessionPing events, uninstall
2. Reinstall

**Action:**
Query `couponmaxx_utm_sessions` RPC with the shop domain.

**Expected (current behavior — known issue):**
- UTM session data from the previous install IS visible (because `SessionPing` uses `shopDomain`, not `shopId`)

**Recommended future fix:**
- Add `shopId` FK to `SessionPing` table
- Filter UTM queries by `shopId` instead of `shopDomain`
- This is NOT part of the current fix scope but should be tracked

---

## Verification Checklist (run after deploying fixes)

```
[ ] No .eq("isActive", true) in auth callback deactivation query
[ ] Auth callback oldShop lookup uses JS filtering or no isActive filter
[ ] ensureShop query has .order("installedAt", { ascending: false })
[ ] Cart ingest cache has TTL (not indefinite Map)
[ ] Cart ingest resolveShopId has .order() and .limit(1)
[ ] Partial unique index exists on Shop(shopDomain) WHERE isActive = true
[ ] E2E: reinstall produces new shopId
[ ] E2E: dashboard shows zero analytics after reinstall
[ ] E2E: new events after reinstall go to new shopId
[ ] E2E: no stale cache serving old shopId after 60s
```
