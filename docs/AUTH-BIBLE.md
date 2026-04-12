# CouponMaxx Auth Bible

**Last updated:** 2026-04-12
**Status:** CANONICAL — do not deviate from this document without understanding every rule.

---

## Architecture Decision: We Use BOTH Auth Flows

CouponMaxx uses a **hybrid approach**:
1. **Legacy OAuth (auth code grant)** — `/api/auth/begin` + `/api/auth/callback`
2. **Token Exchange (managed install)** — `ensureShop()` in API routes

Why both: Shopify's managed install doesn't always trigger the OAuth redirect. For embedded apps, Shopify often opens the app directly in the admin iframe after install. The OAuth callback may never fire. `ensureShop()` handles this case by exchanging the App Bridge session token for an offline access token.

**Source:** https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange

---

## The Two Install Paths

### Path A: OAuth Redirect (when Shopify triggers it)
```
Install → Shopify redirects to /api/auth/begin
  → Redirects to Shopify OAuth screen (merchant approves scopes)
  → Shopify redirects to /api/auth/callback
  → Callback: verify HMAC, exchange code for token, create Shop row, register pixel
  → Redirect to embedded app
```

### Path B: Managed Install / Token Exchange (when Shopify skips OAuth)
```
Install → Shopify opens app directly embedded in admin
  → App loads analytics page
  → Analytics API calls ensureShop()
  → ensureShop: extract session token from request (id_token param or Authorization header)
  → ensureShop: call shopify.auth.tokenExchange() to get offline access token
  → ensureShop: create Shop row with fresh UUID
  → Register pixel + webhooks in background
```

**CRITICAL: Both paths MUST create a fresh Shop row with a new UUID on every install.**

---

## DO — Absolute Rules

### 1. ALWAYS create a new Shop row on install
Every install (first or reinstall) gets a fresh `crypto.randomUUID()`. Never reuse an old Shop record. Old data stays orphaned on the old shopId — that's correct behavior.

### 2. ALWAYS deactivate old records first
Before creating a new Shop row, set `isActive: false` on ALL existing records for that `shopDomain`. This handles the case where the uninstall webhook was delayed.

### 3. EVERY API route must go through ensureShop
Not just analytics — ALL routes that serve the embedded admin UI must call `ensureShop()` so they can handle the managed install case. Routes that only do `getShopFromRequest()` + direct DB lookup will fail on fresh installs where the OAuth callback didn't fire.

**Files that need ensureShop (currently missing):**
- `app/api/couponmaxx/sessions/route.ts`
- `app/api/couponmaxx/coupons/route.ts`
- `app/api/couponmaxx/notifications/route.ts`
- `app/api/couponmaxx/settings/route.ts`
- `app/api/couponmaxx/cart/route.ts`
- `app/api/couponmaxx/cart/activity/route.ts`
- `app/api/couponmaxx/cart/conversion/route.ts`
- `app/api/couponmaxx/recovery/settings/route.ts`
- `app/api/couponmaxx/recovery/stats/route.ts`
- `app/api/couponmaxx/session/route.ts`

**Ingest routes (`/api/pixel/ingest`, `/api/cart/ingest`, `/api/session/ping`) do NOT use ensureShop** — they receive events from the storefront (no session token available), so they do a direct shop lookup by domain. This is correct.

### 4. ALWAYS pass id_token through redirects and fetches
The App Bridge session token (`id_token`) is the key that makes ensureShop work. Every redirect and every fetch call must preserve it.

- `app/page.tsx` — forwards all search params including `id_token` ✓
- `lib/authenticated-fetch.ts` — appends `id_token` from page URL to API calls ✓
- Client-side SWR fetcher — must append `id_token` (analytics page does this) ✓

### 5. ALWAYS register pixel + webhooks after Shop creation
Both install paths must register the Web Pixel and APP_UNINSTALLED webhook as background work after creating the Shop row. Without the pixel, checkout tracking doesn't work.

### 6. ALWAYS store offline tokens, not online tokens
We use `RequestedTokenType.OfflineAccessToken` because we need tokens for background jobs (cron alerts, webhook processing). Offline tokens persist beyond the user session.

**Source:** https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens

### 7. ALWAYS verify session tokens server-side
Use HMAC-SHA256 with `SHOPIFY_API_SECRET` to verify the JWT signature. Check `exp` claim. Extract shop from `dest` or `iss` claim.

**Source:** https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens

---

## DON'T — Things That Have Burned Us

### 1. DON'T reuse old Shop records on reinstall
**Bug:** Auth callback checked for existing active records and just updated the token. Same shopId → old data visible on new install. Users see stale data from a previous installation period.
**Fix (commit 8c9da2e):** Callback now ALWAYS deactivates + creates fresh.

### 2. DON'T cache Shop lookups in memory
**Bug:** `ensureShop` had an in-memory cache. After uninstall, cache served stale shop data. New installs hit the cache and got the old (deactivated) record.
**Fix (commit 909e09b):** Removed in-memory cache. Always hit DB.

### 3. DON'T skip ensureShop on any admin-facing route
**Bug:** Only the analytics route calls `ensureShop()`. All other routes do direct DB lookups. On managed installs (Path B), the analytics page must load first to trigger Shop creation. If the user navigates directly to `/couponmaxx/sessions`, no Shop exists → 404.
**Fix needed:** All admin-facing routes must call `ensureShop()`.

### 4. DON'T assume the OAuth callback will fire
Shopify may skip the OAuth redirect on:
- Reinstalls where scopes haven't changed
- Managed installs for embedded apps
- Installs from the Partner Dashboard

The auth callback is NOT guaranteed. `ensureShop()` via token exchange is the reliable fallback.

### 5. DON'T use session tokens as access tokens
Session tokens (JWTs from App Bridge) are short-lived (~60s) and cannot call the Shopify Admin API. They must be exchanged for an access token via `shopify.auth.tokenExchange()`.

### 6. DON'T ignore token exchange failures
If `shopify.auth.tokenExchange()` fails, the Shop record gets created with `accessToken: "pending_oauth"`. This means:
- Ingest endpoints work (they don't need the access token)
- Smart Recovery DOESN'T work (needs Admin API access)
- Pixel registration DOESN'T work (needs Admin API access)

Log the error prominently. The pending_oauth state should resolve on next request when token exchange succeeds.

### 7. DON'T delete data on uninstall
Uninstall webhook sets `isActive: false` (soft delete). Do NOT delete CartEvents, CheckoutEvents, etc. The `shop/redact` GDPR webhook (fires 48h later) is the signal to actually delete data.

**Source:** https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance

### 8. DON'T hardcode scopes in multiple places
Scopes must match everywhere:
- `shopify.app.toml` — what Shopify Partner Dashboard knows
- `lib/shopify.ts` — SDK configuration
- `app/api/auth/begin/route.ts` — hardcoded OAuth URL

If these diverge, token exchange may return tokens with wrong scopes, or OAuth may request scopes the TOML doesn't declare.

**Current scopes (all 4 locations must match):**
```
read_orders, read_checkouts, write_pixels, read_customer_events, read_analytics, write_discounts
```

---

## Uninstall/Reinstall Flow

### Uninstall
```
1. Merchant clicks "Uninstall" in Shopify admin
2. Shopify fires APP_UNINSTALLED webhook to /api/webhooks/app-uninstalled
3. Webhook handler:
   a. Verify HMAC signature
   b. Find active Shop record for this domain
   c. Deregister Web Pixel (if registered)
   d. Set Shop.isActive = false (soft delete)
   e. Delete Prisma Session record
4. Access token is revoked by Shopify (our stored token no longer works)
```

### Reinstall
```
1. Merchant installs app again
2. Path A or Path B fires (see above)
3. ALWAYS: deactivate ALL existing records for this shopDomain
4. ALWAYS: create new Shop row with fresh UUID
5. ALWAYS: register pixel + webhooks in background
6. Result: fresh shopId, zero data, clean slate
```

### Race Condition: Uninstall Webhook Delayed
If the merchant uninstalls and reinstalls quickly, the uninstall webhook may arrive AFTER the new Shop row is created. The webhook handler only deactivates records matching the old shop's ID, so this is safe — the new record is untouched.

---

## Scope Configuration

All 4 locations must declare the same scopes:

| Location | File | Purpose |
|----------|------|---------|
| TOML (production) | `shopify.app.toml` | Shopify Partner Dashboard — source of truth for managed install |
| TOML (dev) | `shopify.app.checkoutmaxx.toml` | Dev store app |
| SDK config | `lib/shopify.ts` | Shopify API client initialization |
| Hardcoded OAuth | `app/api/auth/begin/route.ts` | Legacy OAuth redirect URL |

After changing scopes: run `shopify app deploy` to push to Partner Dashboard.

---

## Environment Variables

| Variable | Purpose | Must Match |
|----------|---------|------------|
| `SHOPIFY_API_KEY` | App client ID | Must match the app's client_id in the TOML |
| `SHOPIFY_API_SECRET` | App secret | Used for HMAC verification, JWT signing, token exchange |
| `SHOPIFY_APP_URL` | App URL | Must match `application_url` in TOML and Vercel deployment URL |

**CRITICAL:** If `SHOPIFY_API_SECRET` doesn't match the app the store has installed, ALL session token verification fails silently (HMAC mismatch → `verifySessionToken` returns null → `getShopFromRequest` falls back to query param → `getSessionTokenFromRequest` returns null → token exchange impossible).

---

## Key Source Files

| File | Responsibility |
|------|---------------|
| `lib/verify-session-token.ts` | JWT verification, shop extraction from request |
| `lib/ensure-shop.ts` | Shop auto-provisioning via token exchange |
| `lib/shopify.ts` | Shopify SDK init, webhook registration |
| `lib/session-storage.ts` | Prisma-backed session storage |
| `lib/pixel-registration.ts` | Web Pixel register/deregister via GraphQL |
| `app/api/auth/begin/route.ts` | Legacy OAuth initiation |
| `app/api/auth/callback/route.ts` | Legacy OAuth callback + Shop creation |
| `app/api/webhooks/app-uninstalled/route.ts` | Uninstall handler |

---

## Shopify Documentation References

| Topic | URL |
|-------|-----|
| Auth overview | https://shopify.dev/docs/apps/build/authentication-authorization |
| Token exchange | https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange |
| Managed installation | https://shopify.dev/docs/apps/build/authentication-authorization/app-installation |
| Session tokens | https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens |
| Offline tokens | https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens |
| Auth code grant | https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant |
| GDPR compliance | https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance |
| Webhook reference | https://shopify.dev/docs/api/webhooks/latest |
| Expiring tokens (Apr 2026) | https://shopify.dev/changelog/expiring-offline-access-tokens-required-for-public-apps-april-1-2026 |
