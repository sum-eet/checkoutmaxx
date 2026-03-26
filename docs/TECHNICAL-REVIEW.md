# Technical Review — CouponMaxx / CheckoutMaxx
**Date:** 2026-03-24
**Reviewer:** Claude (claude-sonnet-4-6)
**Skills Applied:** shopify-apps, shopify-expert, shopify-development
**Scope:** Security · Shopify Compliance · Architecture · Performance · Code Quality · Extensions · Database

---

## Overall Scores

| Area | Score | Notes |
|------|-------|-------|
| Security | 7/10 | Good foundation, 2 significant gaps |
| Shopify Compliance | 7/10 | GDPR mostly done, CartEvent missing from redact |
| Architecture | 8/10 | Async patterns solid, minor N+1 risks |
| Performance | 8/10 | Good async/caching, some query efficiency issues |
| Code Quality | 7/10 | Mostly strong TypeScript, some `any` usage |
| Extensions | 9/10 | Well-structured, correct Pixel API usage |
| Database | 7/10 | Dual ORM approach carries sync risk |

---

## Blockers (Fix Before App Store Submission)

| # | Severity | Issue | File |
|---|----------|-------|------|
| 1 | CRITICAL | OAuth state generated but never validated → CSRF risk | `app/api/auth/begin/route.ts`, `app/api/auth/callback/route.ts` |
| 2 | CRITICAL | CartEvent not deleted on shop redact → GDPR failure | `app/api/webhooks/shop/redact/route.ts:27-30` |
| 3 | CRITICAL | Test alert endpoint still live in production | `app/api/jobs/test-alert/route.ts` |
| 4 | HIGH | No data retention policy — CheckoutEvent/CartEvent grow unbounded | N/A |

---

## 1. Security

### 1.1 OAuth State Not Validated — HIGH

`app/api/auth/begin/route.ts:17` generates `crypto.randomBytes(8).toString("hex")` as an OAuth state parameter but `app/api/auth/callback/route.ts` never reads or compares it. This means the CSRF protection that Shopify's OAuth flow provides is inactive. An attacker could craft a malicious redirect and complete OAuth against an arbitrary shop.

**Fix required:** Store state in a short-lived session/cookie at `/auth/begin`, read and compare in `/auth/callback`, reject if mismatched.

---

### 1.2 Non-Timing-Safe HMAC in app-uninstalled — MEDIUM

`lib/verifyWebhookHmac.ts` correctly uses `timingSafeEqual`. However `app/api/webhooks/app-uninstalled/route.ts:21` has its own inline HMAC check using simple string equality (`===`), which is vulnerable to timing attacks.

**Fix required:** Replace with the shared `verifyWebhookHmac` utility.

---

### 1.3 Test Endpoint Accessible in Production — CRITICAL

`app/api/jobs/test-alert/route.ts` is protected only by `CRON_SECRET`. If that secret is ever leaked, an attacker can spam merchants with test emails and Slack messages, and probe for valid shop identifiers. The file even has a comment acknowledging it should be removed before App Store submission — but it's still there.

**Fix required:** Delete the route entirely, or at minimum gate it behind an `NODE_ENV === "development"` guard.

---

### 1.4 Supabase Service Role Key — MEDIUM (Needs Verification)

`lib/supabase.ts:4-5` initialises the client with `SUPABASE_SERVICE_ROLE_KEY`. This key bypasses Row Level Security. Confirm it is only imported in server-side modules and never bundled into client-side code. Next.js does not automatically tree-shake server-only code from client components if imported incorrectly.

---

### 1.5 X-Frame-Options Too Permissive — MEDIUM

`next.config.mjs:19` sets `X-Frame-Options: ALLOWALL` on all routes. This is necessary for Shopify Admin embedding but should be scoped to `https://admin.shopify.com`. Allowing arbitrary origins to frame the app increases clickjacking exposure for pages that don't need embedding.

---

### 1.6 Cron Secret Protection — GOOD

All three job endpoints (`evaluate-alerts`, `compute-baselines`, `test-alert`) correctly validate a Bearer token against `CRON_SECRET`. No issues here.

---

### 1.7 Webhook HMAC (main library) — GOOD

`lib/verifyWebhookHmac.ts` uses `crypto.timingSafeEqual` correctly. GDPR webhooks use this shared utility.

---

### 1.8 Session Token Verification — GOOD

`lib/verify-session-token.ts` validates HMAC-SHA256 signatures, checks token expiration (line 23), and extracts shop domain with regex validation. Three-tier fallback (Authorization header → id_token param → shop param) is well-structured.

---

### 1.9 Sensitive Data in Logs — LOW

`app/api/auth/callback/route.ts` logs the OAuth `code` parameter. Codes are short-lived but log aggregation systems (Vercel logs) could expose them. Consider redacting.

---

## 2. Shopify Compliance

### 2.1 CartEvent Missing from Shop Redact — HIGH (GDPR)

`app/api/webhooks/shop/redact/route.ts:27-30` deletes `CheckoutEvent`, `AlertLog`, `Baseline`, and `Shop` records, but **does not delete `CartEvent` records**. Cart events are stored in the `cart_events` table and contain shop-linked data. This is a GDPR compliance gap.

---

### 2.2 Customer Redact — COMPLIANT

`app/api/webhooks/customers/redact/route.ts` correctly acknowledges the request and notes that no PII is stored (only session-level data linked to shop, not individuals). This is acceptable if true.

---

### 2.3 Customer Data Request — COMPLIANT

`app/api/webhooks/customers/data-request/route.ts` returns HTTP 200 and logs the request. If the app truly stores no individual PII, this is compliant.

---

### 2.4 API Version Inconsistency — MEDIUM

Three different API versions are in use:

| Location | Version |
|----------|---------|
| `shopify.app.toml` (webhooks) | `2025-04` |
| `lib/shopify.ts` (ApiVersion enum) | `January25` (2025-01) |
| `extensions/cart-monitor/shopify.extension.toml` | `2024-01` |

The cart-monitor extension is 2 major versions behind. If `2024-01` enters the deprecation window it will break without warning. All three should align.

---

### 2.5 Scopes Mismatch — MEDIUM

`lib/shopify.ts:10` declares 4 scopes. `shopify.app.toml:7` declares 5 (adds `read_customer_events`). The actual scopes granted at install depend on which source Shopify reads. These must match exactly.

---

### 2.6 App Bridge — MOSTLY GOOD

`hooks/useShop.ts` reads `window.shopify.config.shop` (correct App Bridge pattern). However the embedded layout (`app/(embedded)/couponmaxx/layout.tsx`) has no explicit App Bridge provider initialisation — this works only because Shopify auto-initialises App Bridge from the script tag. Adding explicit initialisation would make the dependency explicit and reduce fragility.

---

## 3. Architecture

### 3.1 Async Webhook Processing — EXCELLENT

`app/api/pixel/ingest/route.ts` and `app/api/cart/ingest/route.ts` both use Vercel's `waitUntil()` to return HTTP 200 immediately and process asynchronously. This is the correct pattern per Shopify's anti-pattern guide (no processing before response).

### 3.2 app-uninstalled Synchronous Cascade — LOW

`app/api/webhooks/app-uninstalled/route.ts:67-96` awaits a full deletion cascade synchronously. For large stores this could timeout. Moving to a background job or using a database cascade delete would be safer.

---

### 3.3 GraphQL vs REST — GOOD

GraphQL is used for pixel registration (`lib/pixel-registration.ts`) and billing (`lib/billing.ts`). REST is used only for OAuth token exchange — appropriate, as that endpoint is REST-only.

---

### 3.4 Rate Limiting — GOOD (with caveat)

Both ingest endpoints implement per-shop rate limiting (500 req/min) using in-memory Maps. The caveat: these Maps reset on every cold start. In a serverless environment with many concurrent instances, the effective limit is `500 × instance_count`. This is acceptable for abuse prevention but not for strict quotas.

---

### 3.5 Error Handling Consistency — MIXED

Good in auth and webhook routes. Silent `catch {}` blocks appear in:
- `hooks/useShop.ts:70,79,87,99,100` — localStorage errors swallowed with no fallback logging
- `app/api/webhooks/app-uninstalled/route.ts:74-76,89` — deletion errors logged but execution continues, so partial cleanup may succeed silently

---

## 4. Performance

### 4.1 N+1 Query in Alert Engine — MEDIUM

`lib/alert-engine.ts:46-52` checks cooldown for each failing discount code with a separate `findFirst()` per code. If a merchant has many failing codes, this fires many sequential DB queries. A single query fetching all recent alerts for the shop, then filtering in memory, would be more efficient.

---

### 4.2 Parallel Queries — GOOD

`lib/metrics.ts:72-92` correctly uses `Promise.all()` to run all metric queries in parallel.

---

### 4.3 Shop ID Cache — GOOD

`app/api/cart/ingest/route.ts:6-16` uses a module-level Map to cache `shopDomain → shopId` lookups, preventing repeated DB queries on hot paths.

---

### 4.4 Prisma Singleton — GOOD

`lib/prisma.ts` uses the standard global singleton pattern to prevent connection pool exhaustion during development HMR.

---

### 4.5 Bundle Size — LOW CONCERN

`@shopify/polaris@12.9.0` is a large UI library. If any API routes accidentally import a Polaris component, it will inflate the serverless function bundle and increase cold start time. No direct evidence of this, but worth auditing with `next build --debug`.

---

## 5. Code Quality

### 5.1 Unsafe Type Casting — MEDIUM

`lib/alert-engine.ts:38`:
```typescript
const threshold = (shop as Record<string, unknown>).discountFailureMin as number ?? 3;
```
Double `as` cast bypasses TypeScript's type system. The `Shop` Prisma type should be extended with proper field definitions rather than cast at call sites.

---

### 5.2 `any` Types in metrics.ts — LOW

`lib/metrics.ts:97,98,133,192,221` uses `any` for Supabase response rows. Supabase generates TypeScript types via `supabase gen types` — using them would make these safe.

---

### 5.3 Dead / Commented-Out Code — LOW

`app/api/pixel/ingest/route.ts:1-138` contains ~138 lines of commented-out Prisma implementation. Safe to delete if Supabase implementation is stable.

---

### 5.4 Duplicate `makeSession()` — LOW

`lib/billing.ts:12-20` and `lib/pixel-registration.ts:26-35` both define identical functions for building a Shopify session object. Should be extracted to a shared utility (e.g. `lib/shopify-session.ts`).

---

### 5.5 useShop Interval Leak — LOW

`hooks/useShop.ts:94-105` creates a `setInterval` inside a `useEffect` but the returned cleanup may not always fire if the component is unmounted mid-interval. Should use a `useRef` to track the interval ID and always clear it in the cleanup function.

---

## 6. Extensions

### 6.1 Web Pixel (checkout-monitor) — EXCELLENT

`extensions/checkout-monitor/src/index.js` correctly:
- Uses `browser.sendBeacon()` (required, no `fetch` in pixel sandbox)
- Subscribes to all relevant checkout funnel events
- Avoids localStorage and external script loading
- Sanitises and forward relevant fields only

Events covered: `page_viewed`, `cart_viewed`, `product_viewed`, `product_added_to_cart`, `product_removed_from_cart`, `checkout_started`, `checkout_contact_info_submitted`, `checkout_address_info_submitted`, `checkout_shipping_info_submitted`, `payment_info_submitted`, `checkout_completed`.

---

### 6.2 Cart Monitor (cart-monitor) — GOOD

`extensions/cart-monitor/assets/cart-monitor.js` intercepts native `fetch` and `XMLHttpRequest` to detect cart mutations — a robust approach. Session persistence and event classification are well thought out.

**Issue:** Extension uses `api_version = "2024-01"` (see section 2.4 above).

---

### 6.3 Pixel Registration Flow — GOOD

`lib/pixel-registration.ts` registers and deletes the Web Pixel via GraphQL mutations. Uses `write_pixels` scope correctly.

---

## 7. Database

### 7.1 Dual ORM Pattern — MEDIUM RISK

The app uses **Prisma** for transactional/relational operations (sessions, webhooks, shop data) and **Supabase client** for event ingestion and analytics (RPC functions). This is architecturally justifiable (each tool is used for its strength), but creates a risk:

- Schema changes must be applied in two places (Prisma migrations + Supabase SQL migrations)
- Deletions across both cannot be wrapped in a single transaction
- The shop-redact webhook deletes Prisma-managed tables but CartEvent (also Prisma-schema but queried via Supabase) could be out of sync

---

### 7.2 Missing CartEvent in Redact Cascade — HIGH

See section 2.1. The `CartEvent` model in `prisma/schema.prisma:121-159` has the correct `Shop` relation, but the redact webhook doesn't include `prisma.cartEvent.deleteMany({ where: { shopId: shop.id } })` before deleting the shop.

---

### 7.3 Schema Design — GOOD

- Indexes on `CheckoutEvent` and `CartEvent` are appropriate (session, shop, timestamp)
- `Shop.shopDomain` has `@unique` which implies an index — good for lookups
- Foreign key relationships are correctly defined in Prisma schema

---

### 7.4 Session Schema Documentation — LOW

`prisma/schema.prisma:14-27` stores both online and offline session fields in one model. Fields like `email`, `firstName`, `lastName` are null for offline sessions. This is fine but undocumented, which could confuse future contributors.

---

## 8. Pre-Production Checklist

### Must Fix
- [ ] Implement OAuth state validation (generate → store → compare)
- [ ] Add `CartEvent` to shop redact deletion cascade
- [ ] Remove or guard `/api/jobs/test-alert` endpoint
- [ ] Align API versions across `shopify.app.toml`, `lib/shopify.ts`, extension TOML
- [ ] Reconcile scopes between `shopify.app.toml` and `lib/shopify.ts`
- [ ] Replace inline HMAC in `app-uninstalled` with shared `verifyWebhookHmac`

### Before App Store
- [ ] Implement data retention / automated deletion for old events (GDPR)
- [ ] Implement rate limiting on `/api/couponmaxx/**` endpoints
- [ ] Verify `SUPABASE_SERVICE_ROLE_KEY` is never in client bundles
- [ ] Scope `X-Frame-Options` to `https://admin.shopify.com`
- [ ] Add audit logging for settings changes and install/uninstall events

### Improvements
- [ ] Fix N+1 in `lib/alert-engine.ts` cooldown check
- [ ] Generate Supabase TypeScript types and replace `any` in `lib/metrics.ts`
- [ ] Extract shared `makeSession()` to a single utility
- [ ] Delete commented-out code in `app/api/pixel/ingest/route.ts`
- [ ] Fix interval cleanup in `hooks/useShop.ts`

---

## Appendix: File Coverage

Files read during this review:

- `shopify.app.toml`, `next.config.mjs`, `middleware.ts`, `vercel.json`, `package.json`
- `prisma/schema.prisma`
- `lib/shopify.ts`, `lib/supabase.ts`, `lib/prisma.ts`, `lib/verify-session-token.ts`, `lib/session-utils.ts`, `lib/session-storage.ts`, `lib/alert-engine.ts`, `lib/metrics.ts`, `lib/billing.ts`, `lib/pixel-registration.ts`, `lib/sanitize.ts`, `lib/verifyWebhookHmac.ts`
- `hooks/useShop.ts`
- `app/api/auth/begin/route.ts`, `app/api/auth/callback/route.ts`
- `app/api/webhooks/app-uninstalled/route.ts`, `app/api/webhooks/customers/data-request/route.ts`, `app/api/webhooks/customers/redact/route.ts`, `app/api/webhooks/shop/redact/route.ts`
- `app/api/pixel/ingest/route.ts`, `app/api/cart/ingest/route.ts`
- `app/api/jobs/evaluate-alerts/route.ts`, `app/api/jobs/compute-baselines/route.ts`, `app/api/jobs/test-alert/route.ts`
- `app/api/couponmaxx/analytics/route.ts`
- `app/(embedded)/couponmaxx/layout.tsx`
- `extensions/checkout-monitor/src/index.js`
- `extensions/cart-monitor/assets/cart-monitor.js`, `extensions/cart-monitor/shopify.extension.toml`
