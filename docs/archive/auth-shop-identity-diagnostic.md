# Auth & Shop Identity Flow — Diagnostic Report

> READ-ONLY investigation. No fixes. All findings have exact file paths and line numbers.

---

## 1. Database & Schema

**Stack:** PostgreSQL (Supabase) + Prisma 5.22.0 + Supabase JS client

Two clients coexist:
- **Prisma** — manages schema/migrations
- **Supabase JS** — used for ALL runtime reads/writes (bypasses Prisma on hot path)

**Connection strings** (`.env`):
- Line 12 `DATABASE_URL` — pgBouncer transaction pooler, port 6543
- Line 15 `DIRECT_URL` — direct Postgres port 5432 (Prisma migrations only)

---

### Shop Table — `prisma/schema.prisma` lines 30–77

```prisma
model Shop {
  id          String  @id @default(cuid())   // internal PK — CUID
  shopDomain  String                          // myshop.myshopify.com
  accessToken String
  pixelId     String?
  isActive    Boolean @default(true)
  installedAt DateTime @default(now())
  ...
  @@index([shopDomain])   // ⚠️ INDEX only — NOT UNIQUE at DB level
}
```

**Critical:** `shopDomain` has `@@index` but NO `@@unique`. Multiple rows for the same domain can and do exist simultaneously. Uniqueness is enforced by application logic only (a partial unique index is referenced in comments at `lib/ensure-shop.ts` line 107, but it is not declared in the Prisma schema).

### Session Table — `prisma/schema.prisma` lines 12–28

```prisma
model Session {
  id          String @id    // format: "offline_myshop.myshopify.com"
  shop        String
  accessToken String
  ...
}
```

No FK to Shop table. One row per shop max (PK is deterministic string).

### Analytics Tables — Foreign Key Pattern

All analytics tables use **Shop.id (CUID)** as FK, NOT shopDomain:

| Table | FK Column | File | Lines |
|---|---|---|---|
| `CheckoutEvent` | `shopId String` → `Shop.id` | `prisma/schema.prisma` | 79–107 |
| `CartEvent` | `shopId String` → `Shop.id` | `prisma/schema.prisma` | 123–161 |
| `AlertLog` | `shopId String` → `Shop.id` | `prisma/schema.prisma` | 163–195 |
| `Baseline` | `shopId String` → `Shop.id` | `prisma/schema.prisma` | 109–121 |
| `RecoveryEvent` | `shopId TEXT` (no enforced FK) | `supabase/recovery-functions.sql` | 9–27 |
| `SessionPing` | `shopDomain TEXT` (no FK, uses domain not ID) | `supabase/sessionping-table.sql` | 1–20 |

**Note:** `RecoveryEvent.shopId` and `SessionPing.shopDomain` live in Supabase-only tables with no Prisma FK enforcement.

---

## 2. Install Flow (OAuth Callback)

**File:** `app/api/auth/callback/route.ts`

**Route:** `GET /api/auth/callback`

### Steps:

1. **CSRF check** (lines 29–33) — validates `shopify_oauth_state` cookie vs `state` param
2. **HMAC validation** (lines 35–55) — SHA-256 HMAC of all query params
3. **Token exchange** (lines 62–81) — POST to `https://${shop}/admin/oauth/access_token`
4. **Session store** (lines 86–98) — writes `Session` row with id `offline_${shop}` via Prisma session storage
5. **Shop record** (lines 101–169):

```typescript
// Line 108–113: find old active shop
const { data: oldShop } = await supabase
  .from("Shop").select("id, pixelId")
  .eq("shopDomain", shop).eq("isActive", true).maybeSingle();

// Line 119–123: deactivate ALL active records for this domain
await supabase.from("Shop")
  .update({ isActive: false, pixelId: null })
  .eq("shopDomain", shop).eq("isActive", true);

// Line 130–143: INSERT brand new row with fresh UUID
const newShopId = crypto.randomUUID();
await supabase.from("Shop").insert({
  id: newShopId,
  shopDomain: shop,
  accessToken,
  isActive: true,
  installedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
```

**It is a plain INSERT, not an upsert.** Every OAuth completion creates a NEW Shop row with a new UUID. Old rows are soft-deleted first.

**Fallback** (lines 149–168): If Supabase insert fails, falls back to `prisma.shop.create()` which generates a CUID instead of a UUID.

6. **Background work** (lines 177–219): re-registers pixel + webhooks asynchronously after redirect

---

## 3. Uninstall Flow

**File:** `app/api/webhooks/app-uninstalled/route.ts`

### Steps:

1. **HMAC verification** (lines 10–24) — SHA-256 HMAC against raw body, base64 encoded
2. **Find active shop** (lines 43–48):
   ```typescript
   await supabase.from("Shop").select("id, pixelId, accessToken")
     .eq("shopDomain", shop).eq("isActive", true).maybeSingle();
   ```
3. **Deregister pixel** (lines 58–67) — calls Shopify API; non-fatal if fails
4. **SOFT DELETE** (lines 71–74):
   ```typescript
   await supabase.from("Shop")
     .update({ isActive: false, pixelId: null })
     .eq("id", shopRecord.id);
   ```
5. **Session deleted** (lines 83–88):
   ```typescript
   await prisma.session.delete({ where: { id: `offline_${shop}` } });
   ```

**What is NOT cleaned up on uninstall:** `CartEvent`, `CheckoutEvent`, `AlertLog`, `Baseline`, `RecoveryEvent`, `SessionPing` — all orphaned in place, still referencing the now-inactive `shopId`.

---

## 4. Reinstall Flow

On reinstall, Shopify sends a new OAuth request → hits `GET /api/auth/callback` again.

**Same code path as a fresh install** (lines 101–169 of callback route).

The callback:
1. Finds old active Shop row (if any — uninstall webhook may have already soft-deleted it)
2. Deactivates all active rows for that domain
3. Creates a **NEW Shop row with a NEW UUID**

**Key implication:** Every reinstall generates a new `Shop.id`. All old `CartEvent`/`CheckoutEvent` rows still reference the OLD `shopId`. The new install starts with zero analytics history in the dashboard because all queries filter by the new `shopId`.

---

## 5. `ensureShop` — Runtime Shop Resolver

**File:** `lib/ensure-shop.ts` (178 lines)

Called on every authenticated API request (not the install flow — this is for the embedded app UI).

### Logic:

```typescript
// Line 34–37: fetch ALL rows for domain, filter in JS
const { data: allShops } = await supabase.from("Shop")
  .select("id, accessToken, isActive").eq("shopDomain", shopDomain);

// Line 40: filter active — handles boolean AND string "true" from PostgREST bug
const activeShops = (allShops ?? []).filter(
  s => s.isActive === true || s.isActive === "true"
);
const existing = activeShops[0] ?? null;
```

**Why JS filter instead of `.eq("isActive", true)` in the query:** Comment at lines 32–33 says Supabase `.eq("isActive", true)` was unreliable in production (returning inactive records). This is an existing known workaround.

**If no active shop with real token:** attempts Shopify token exchange (lines 70–86), then:
- If existing row found: updates `accessToken` in place (lines 96–103)
- If NO existing row: INSERTs new Shop row (lines 113–120)

**Race condition protection** (lines 122–137): If INSERT fails with `23505` (unique constraint violation), looks up the winner row and returns it.

**Comment at lines 106–110** explicitly states: "Do NOT deactivate existing records here — that causes race conditions where concurrent requests deactivate each other's records. The auth callback handles deactivation on reinstall."

---

## 6. Analytics Data Association

**Primary identifier for all queries:** `shopId` (the CUID `Shop.id`)

**All dashboard RPC calls** (`app/api/couponmaxx/analytics/route.ts` lines 49–78):
```sql
-- All RPCs use this WHERE pattern:
WHERE "shopId" = p_shop_id
  AND "occurredAt" >= p_start
  AND "occurredAt" <= p_end
```

RPCs called in parallel (lines 75–78):
- `couponmaxx_daily_cart_metrics`
- `couponmaxx_daily_checkout_sessions`
- `couponmaxx_attributed_sales_daily`
- `couponmaxx_funnel_totals`

**Revenue at risk** (lines 259–262) — raw Supabase query:
```typescript
.from("CartEvent")
.select(...)
.eq("shopId", shopId)
.eq("eventType", "cart_coupon_failed")
.gte("occurredAt", start).lte("occurredAt", end)
```

**Exception:** `SessionPing` table uses `shopDomain` (not `shopId`). UTM RPC `couponmaxx_utm_sessions` filters by `p_shop_domain` parameter.

**Cache headers** (`app/api/couponmaxx/analytics/route.ts` line 298):
```typescript
'Cache-Control': 'no-store, no-cache, must-revalidate'
```
Analytics fully bypasses CDN.

---

## 7. Session Storage

**Implementation:** `@shopify/app-session-storage-prisma` — writes to Postgres `Session` table.

**Session ID format:** `offline_${shopDomain}` (string PK, deterministic).

**On uninstall:** Session row explicitly deleted (`app/api/webhooks/app-uninstalled/route.ts` line 84).

**On reinstall:** Auth callback creates a new `Session` row with the same ID `offline_${shop}`, overwriting via `sessionStorage.storeSession()` (`app/api/auth/callback/route.ts` lines 86–94).

**Stale session risk:** If the uninstall webhook fails or is delayed, the old `Session` row with the old access token persists until the reinstall callback overwrites it. The `ensureShop` function uses the Shopify session JWT from the request header (not the Prisma session) for token exchange, so stale Prisma sessions don't directly contaminate new installs — but any code that loads the session via Prisma session storage could get an old token.

---

## 8. Caching Layer

### In-memory shop cache — `app/api/cart/ingest/route.ts` lines 6–24

```typescript
const shopCache = new Map<string, string>();  // shopDomain → shopId (CUID)

async function resolveShopId(shopDomain: string): Promise<string | null> {
  if (shopCache.has(shopDomain)) return shopCache.get(shopDomain)!;
  const { data } = await supabase.from("Shop").select("id")
    .eq("shopDomain", shopDomain).eq("isActive", true).maybeSingle();
  if (data?.id) {
    shopCache.set(shopDomain, data.id);  // only cache successes
    return data.id;
  }
  return null;  // null NOT cached — allows newly-installed shops to resolve
}
```

**Cache key:** `shopDomain` string → `shopId` CUID

**Scope:** Process-lifetime (single Vercel function instance). No Redis, no Edge Config, no shared cache across instances.

**Staleness risk on reinstall:** If a Vercel function instance cached `shopDomain → old_shopId` before uninstall, it will route new cart events to the OLD (now inactive) `shopId` until the instance is recycled. New cart events would be stored under the old Shop record and appear in the old install's analytics (if that data were ever queried by old shopId).

**`ensureShop` has no cache** — comment at `lib/ensure-shop.ts` line 11 confirms: "No in-memory cache — always hits DB to avoid stale data after uninstall/reinstall."

No Redis, no Vercel KV, no CDN-level caching anywhere in the codebase.

---

## Summary Table

| Question | Answer |
|---|---|
| Database | PostgreSQL (Supabase) |
| ORM | Prisma 5.22.0 |
| Shop PK | CUID string — NOT the shop URL |
| Shop URL column | `shopDomain` — indexed, NOT unique at DB level |
| Unique enforcement | Application logic + partial unique index (referenced in comments, not in Prisma schema) |
| Install DB write | Plain `INSERT` — new UUID row every OAuth completion |
| Reinstall DB write | Deactivate all old rows → plain `INSERT` new row with new UUID |
| Uninstall DB write | Soft-delete only (`isActive: false`). No cascade delete of analytics. |
| Analytics FK | `shopId` (CUID) on all tables except `SessionPing` (uses `shopDomain`) |
| Session storage | Prisma → Postgres `Session` table, key `offline_${shop}` |
| Session on uninstall | Explicitly deleted |
| Session on reinstall | Overwritten with same key |
| In-memory cache | `Map<shopDomain, shopId>` in cart ingest only. Stale across reinstalls until instance recycled. |
| Redis | None |
| CDN cache for analytics | Explicitly disabled (`no-store`) |
