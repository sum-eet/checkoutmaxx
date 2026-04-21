# Auth & Pixel — v3 Spec (Source of Truth)

**Status:** Definitive. Supersedes `AUTH-BIBLE-V2.md`, `foundation-17-apr.md`, and every hotfix doc that touches Shop lifecycle or pixel registration.

**Problem it solves:** four days of patches on Shop row lifecycle → still broken. Root cause: multiple code paths share authority over Shop rows. Every read path can also write. Races compound. This spec collapses authority to one place for each concern.

---

## Non-negotiable invariants

1. **Only `auth/callback` creates Shop rows.** No other file. Ever. If you feel the urge, don't.
2. **`lib/shop.ts` is the only module that reads Shop rows.** Every route imports from here.
3. **Row creation is atomic in Postgres.** Deactivate-all + insert happen in ONE transaction via a Supabase RPC. No JS-side "deactivate then insert" with race windows.
4. **Pixel registration never throws.** `ensurePixel` returns `string | null`. Null is a valid outcome. Callers do not block on it.
5. **Diagnostics / admin reads never mutate.** If `getShop` returns null, the route returns 400 with "install required". It does NOT attempt to create, token-exchange, or self-heal.
6. **No background promise tricks.** Side effects after response use `waitUntil` from `@vercel/functions`. Nothing else.

---

## Shop row state machine

```
                ┌────────────────────────────────────────┐
                │                                        │
 [no row]  ──── OAuth install ────▶  [active, token]    │
                                          │             │
                                          │ re-install  │
                                          ▼             │
                                     [inactive]  ◀──────┘
                                          │
                                          │ uninstall webhook
                                          ▼
                                     [inactive, stays]
```

**Rules:**
- `shopDomain` + `isActive=true` is a partial unique index. Exactly zero or one active row per domain at any instant.
- Uninstall sets `isActive=false`. Never deletes.
- Re-install runs the atomic RPC: sets all existing rows for `shopDomain` to `isActive=false`, inserts a new row with a fresh UUID and `isActive=true`.
- Events (`CheckoutEvent`, `CartEvent`, `RecoveryEvent`) reference the row that was active at ingest time. When an install cycle turns a row inactive, historical events stay linked to the (now inactive) row. Admin UI should handle "events under an inactive row" gracefully (post-submission concern).

---

## Pixel state machine

Shopify gives each app **at most one web pixel per store**. The API is inconsistent:
- `webPixel { id }` query sometimes throws `"No web pixel was found for this app"` even when one exists.
- `webPixelCreate` rejects with `"already been set"` when one exists.
- `webPixelUpdate` requires the id.

```
[no pixel]  ── webPixelCreate ──▶  [pixel exists, id known]
                                           │
[ambiguous] ◀── "already set" ─── webPixelCreate
     │
     └── webPixel query ──▶  id?  ──yes──▶  [pixel exists, id known]
                             │
                             no-or-throw
                             │
                             ▼
                    [pixel exists, id unknown]  ← null in DB, accept and move on
```

**Rules:**
- One function: `ensurePixel(shopDomain, accessToken): Promise<string | null>`.
- Flow: try `webPixelCreate`. If success → return id. If `"already been set"` → try `webPixel { id }` query. If id returned → return id. If query throws or returns no id → return null and log.
- NEVER retries more than once.
- NEVER throws. Caller handles null by storing null in `Shop.pixelId` and moving on — the pixel still fires on the storefront.
- Called in exactly two places: `auth/callback` (after shop insert) and a new `/api/couponmaxx/pixel/ensure` admin endpoint (manual re-try button in diagnostics).

---

## Module API

### `lib/shop.ts` (NEW, replaces 4 old files)

```ts
// ---------- Read ----------
export async function getShop(
  shopDomain: string
): Promise<{ id: string; accessToken: string; pixelId: string | null } | null>
// READ-ONLY. Returns the active Shop row or null. No writes.
// Uses .eq("shopDomain", X).eq("isActive", true) — trusts Postgres boolean
// (the partial unique index guarantees at most one match).
// If Supabase coerces booleans (seen historically), the fallback is a JS
// filter over installedAt DESC. Keep both paths; log which one matched.

// ---------- Write: install path only ----------
export async function createShop(
  shopDomain: string,
  accessToken: string
): Promise<{ id: string }>
// CALLED ONLY FROM auth/callback. Atomic via Supabase RPC 'create_shop'.
// Inside the RPC: BEGIN → UPDATE Shop SET isActive=false WHERE shopDomain=X
//                       → INSERT new row (isActive=true) → COMMIT.
// Returns { id } of the new row. Throws only on DB connectivity errors.
// Idempotency: if called twice concurrently, partial unique index fires 23505
// on the loser; loser re-reads and returns the winner's id.

// ---------- Write: token refresh path only ----------
export async function upgradeToken(
  shopId: string,
  accessToken: string
): Promise<void>
// In-place UPDATE of accessToken + updatedAt. Does NOT create rows,
// does NOT flip isActive. Called from ensureShop-replacement in routes
// that need token exchange (admin API calls).
```

**No other exports.** No `provisionShop`, no `getActiveShop`, no `isTruthyActive`, no `ensureShop`. Callers that need "get the shop for this request" use `getShop(shopDomain)` — if null, they return 400.

### `lib/pixel.ts` (NEW, replaces `lib/pixel-registration.ts`)

```ts
export async function ensurePixel(
  shopDomain: string,
  accessToken: string
): Promise<string | null>
// Idempotent pixel registration. Never throws. See "Pixel state machine" above.

export async function deletePixel(
  shopDomain: string,
  accessToken: string,
  pixelId: string
): Promise<void>
// Called from app-uninstalled webhook only. Fire-and-forget-safe.
```

### `supabase/create-shop.sql` (NEW)

```sql
CREATE OR REPLACE FUNCTION create_shop(p_shop_domain TEXT, p_access_token TEXT)
RETURNS TABLE(id UUID) AS $$
DECLARE new_id UUID := gen_random_uuid();
BEGIN
  UPDATE "Shop" SET "isActive" = false, "updatedAt" = now()
  WHERE "shopDomain" = p_shop_domain AND "isActive" = true;

  INSERT INTO "Shop" (id, "shopDomain", "accessToken", "isActive", "installedAt", "updatedAt")
  VALUES (new_id, p_shop_domain, p_access_token, true, now(), now());

  RETURN QUERY SELECT new_id;
END;
$$ LANGUAGE plpgsql;
```

Atomic. No race possible because the UPDATE and INSERT share a single transaction. The partial unique index still enforces the invariant. Must be applied to Supabase before the new code deploys.

### `app/api/auth/callback/route.ts` (REWRITE)

Linear flow, no background-promise tricks:

```
1. Verify HMAC + exchange code for offline access token (unchanged)
2. Store session (unchanged)
3. shopId = await createShop(shopDomain, accessToken)
4. waitUntil(Promise.all([
     ensurePixel(shopDomain, accessToken).then(pid => {
       if (pid) supabase.from("Shop").update({ pixelId: pid }).eq("id", shopId)
     }),
     registerWebhooks(session),
     // optional: deregister old pixel if the previous row had one (best effort)
   ]))
5. Redirect to admin app URL
```

No `oldShop` lookup. No `provisionShop`. No manual deactivate. The RPC handles it.

---

## Caller migration (~15 files)

Every file that currently imports `ensureShop`, `provisionShop`, `getActiveShop`, `registerAppPixel`, or `deregisterAppPixel`:

```ts
// OLD
import { ensureShop } from "@/lib/ensure-shop";
const result = await ensureShop(req);
if (!result) return NextResponse.json({ error: "Missing shop" }, { status: 400 });
const { shopId, shopDomain } = result;

// NEW
import { getShop } from "@/lib/shop";
import { getShopFromRequest } from "@/lib/verify-session-token";
const shopDomain = getShopFromRequest(req);
if (!shopDomain) return NextResponse.json({ error: "Missing shop" }, { status: 400 });
const shop = await getShop(shopDomain);
if (!shop) return NextResponse.json({ error: "Install required" }, { status: 400 });
const { id: shopId } = shop;
```

**Ingest routes** (`cart/ingest`, `pixel/ingest`) — same pattern. Drop the `shopCache` map — `getShop` is a single indexed query, fast enough.

**Token-refresh case** (admin API calls that need a fresh access token) — handled in one place by optionally calling `upgradeToken(shopId, newToken)` AFTER `getShop` succeeds. But: for submission, we don't need this — the accessToken stored at install time is valid until uninstall. Leave the token-exchange logic out entirely in v3. Add it back post-submission if a scope ever changes.

---

## What dies

| File | Status | Reason |
|---|---|---|
| `lib/ensure-shop.ts` | **DELETE** | Overlapping authority with provisionShop; dual read+write. |
| `lib/provision-shop.ts` | **DELETE** | Replaced by atomic `create_shop` RPC + `createShop()`. |
| `lib/get-active-shop.ts` | **DELETE** | Replaced by `getShop`. |
| `lib/is-active.ts` | **DELETE** | No longer needed — trust the boolean column + index. |
| `lib/pixel-registration.ts` | **DELETE** | Replaced by `lib/pixel.ts`. |

Scripts that reference a hardcoded shopId (`scripts/check-funnel.ts`) — leave alone, just mark deprecated.

---

## Files NOT TOUCHED (proven working, out of scope)

- `extensions/checkout-recovery/*` — the Shopify checkout extension. Separate runtime. Works.
- `app/api/cart/ingest/route.ts` — just repoint imports to new module. No logic change.
- `app/api/pixel/ingest/route.ts` — same.
- `app/api/couponmaxx/cx/route.ts` — claim button. Confirmed working (coupon test landed correctly on `a14e3137` at 11:25 on 2026-04-20). Repoint imports only.
- All admin UI pages — read layers. Repoint imports only.
- Supabase schema (tables) — unchanged.
- Existing RPCs in `supabase/cart-page-rpcs.sql` — unchanged.
- `app/api/webhooks/app-uninstalled/route.ts` — repoint imports (now uses `lib/shop.ts` for lookup + `lib/pixel.ts` for deletePixel). Keep the intentional `.eq("isActive", true)` on the UPDATE — it's the one place we want to scope to the active row.

---

## Migration / ship order

1. Apply `supabase/create-shop.sql` in Supabase SQL editor. Verify:
   ```sql
   SELECT create_shop('dummy.myshopify.com', 'dummy_token');
   -- Then: SELECT * FROM "Shop" WHERE "shopDomain" = 'dummy.myshopify.com';
   -- Then: DELETE FROM "Shop" WHERE "shopDomain" = 'dummy.myshopify.com';
   ```
2. Land `lib/shop.ts`, `lib/pixel.ts`, new `auth/callback/route.ts` in one commit.
3. In same commit, repoint all caller imports. Do NOT keep the old files as shims.
4. Delete the 5 old files in the same commit.
5. `npx tsc --noEmit` — must pass.
6. Push. Vercel deploys.
7. On test store: uninstall, then:
   ```sql
   DELETE FROM "Shop" WHERE "shopDomain" = 'testingstoresumeet.myshopify.com';
   -- events referencing deleted rows become orphan FKs; this is fine on the test store.
   -- If a FK constraint blocks the delete, set isActive=false on all rows instead.
   ```
8. Reinstall via partner dashboard.
9. Verify in Vercel logs:
   - ONE `[AUTH] createShop` entry.
   - `[pixel] ensurePixel → <id>` or `[pixel] ensurePixel → null (logged reason)`.
   - Every subsequent `/api/couponmaxx/*` request: `[shop] getShop → <id>`.
   - ZERO `createShop` calls from anywhere except auth/callback.
10. Smoke test diagnostics: all streams green, Fire test pixel + Fire test claim work.
11. Submit.

---

## What this spec explicitly forbids

- Adding a "self-heal" branch that creates a Shop row from any read path.
- Adding a cache layer in front of `getShop` (30-second Map etc). The index is fast; caching causes the "wrong shopId after reinstall" class of bug.
- Widening `isTruthyActive` or its descendants. If Supabase returns a non-boolean for `isActive`, file a bug and fix at the schema layer, not with JS filtering.
- Catching and retrying pixel errors more than once inside `ensurePixel`. The Shopify API is inconsistent enough that one retry is the max; beyond that it's noise.
- Any code path that writes to Shop outside `createShop`, `upgradeToken`, and the uninstall webhook's `isActive=false` update.

If a future fix tempts you to break one of these, re-read this section before coding.

---

## Open questions resolved (so we don't re-debate)

- **"Should ensureShop self-heal on missing active row?"** No. It should return null. Caller returns 400 "Install required".
- **"What if the DB has residual inactive rows after cleanup?"** Fine — they're inert. `getShop` ignores them.
- **"What about read replica lag?"** Not an issue anymore because `getShop` is called AFTER `createShop` has committed (via the RPC, which returns only after COMMIT). Vercel edge → Supabase primary for writes; reads hit primary too on this project.
- **"What if Shopify's pixel API is temporarily broken?"** `ensurePixel` returns null; diagnostics shows "Has pixel ID: No"; storefront pixel still fires because it was registered on a previous install. Admin can click "Re-register pixel" to retry manually.
- **"Do we need the partial unique index?"** Yes. It enforces the invariant even if application code has a bug. Already applied per `supabase/shop-domain-unique-index.sql`.

---

---

## Shopify App Store compliance hardening (merged into v3 scope)

A compliance review flagged three items. One requires code changes in this rewrite, two are verification-only.

### Fix 1 (code) — Remove `?shop` query-param fallback for authenticated admin routes

**Finding:** `lib/verify-session-token.ts:81` falls through to `url.searchParams.get("shop")` when no session token is present. That means every `/api/couponmaxx/*` admin endpoint is reachable with just a plain `?shop=...` URL, no App Bridge token required. Shopify review flags this as a session-token-auth bypass.

**Rule going forward:** `?shop` is NEVER trusted for authenticated routes. Only a valid signed `id_token` (App Bridge session token) OR a valid `Authorization: Bearer` proves shop identity.

**Change:** split `getShopFromRequest` into two functions in `lib/verify-session-token.ts`:

```ts
// For authenticated admin routes — requires a valid session token.
// Returns shopDomain ONLY if Authorization header or id_token query param verifies.
// Never falls back to ?shop.
export function getAuthenticatedShop(req: Request): string | null {
  // existing auth header + id_token verification logic, no ?shop fallback
}

// For public ingest endpoints — trusts ?shop in the body or query because
// the endpoint itself is public (pixel events, cart beacons). Separate
// validation (rate limiting, sanitization) lives in the ingest route.
export function getShopFromPublicRequest(req: Request): string | null {
  // body/url shop extraction, no token verification
}
```

**Caller split:**
- Every route under `app/api/couponmaxx/**` → uses `getAuthenticatedShop`. If null → 401.
- `app/api/pixel/ingest/route.ts` and `app/api/cart/ingest/route.ts` → use `getShopFromPublicRequest`.
- `app/api/auth/**` → uses its own OAuth-specific flow (unchanged).
- `app/api/webhooks/**` → HMAC verification (unchanged).
- `app/api/billing/**` → uses `getAuthenticatedShop`.
- `app/api/session/ping` → uses `getShopFromPublicRequest` (it's called from storefront).

### Verify 2 (no code) — Billing plan count matches App Store listing

**Finding:** `lib/billing.ts` has a single `PRO_PLAN` at $49/30 days. If the App Store listing advertises multiple paid plans or tiers, reviewers expect in-app switching. If the listing shows one paid plan + free tier only, this is N/A.

**Action for Sumeet:** confirm the App Store listing shows ONE paid plan. No code change unless listing disagrees.

### Verify 3 (no code, check schema) — Billing reinstall path after decline

**Finding:** if a merchant installs → declines → uninstalls → reinstalls, a prior `subscriptionStatus='DECLINED'` row could interfere.

**Why v3 already handles this:** `createShop` inserts a brand-new row with a fresh UUID on every install. The new row has default `subscriptionStatus = NULL` (or whatever the column default is). The old DECLINED row stays inactive and is ignored by `getShop`. Billing flow calls `createSubscription` fresh. No stale status leaks.

**Action for Sumeet:** verify the `Shop.subscriptionStatus` column has a sensible default (`NULL` or `'PENDING'`, NOT `'ACTIVE'`). One-liner SQL:
```sql
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_name = 'Shop' AND column_name = 'subscriptionStatus';
```
If default is missing or wrong, add `ALTER TABLE "Shop" ALTER COLUMN "subscriptionStatus" SET DEFAULT NULL;` (or equivalent).

---

**Last updated:** 2026-04-21. When anything in this doc changes, bump the date and note the change in `docs/CHANGELOG.md`.
