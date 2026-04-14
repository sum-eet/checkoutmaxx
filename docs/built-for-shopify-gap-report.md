# Built for Shopify — Gap Report (CouponMaxx)

**Date:** April 14, 2026  
**Branch:** couponmaxx-submission  
**Audited against:** [shopify.dev/docs/apps/launch/built-for-shopify/requirements](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements)

---

## BLOCKING ISSUES (Will cause rejection)

### 1. REST API Still in Use — CRITICAL DEADLINE MISSED

**Shopify requirement:** All new public apps must use the **GraphQL Admin API exclusively** as of April 1, 2025. REST API usage is grounds for immediate rejection.

**Where to look:**
- `lib/pixel.ts` — `registerAppPixel()` and `deregisterAppPixel()` — verify these use GraphQL `webPixelCreate` / `webPixelDelete` mutations, not REST endpoints
- Any `fetch()` call targeting `/admin/api/2025-04/*.json` must be converted

**Required:** Every Shopify Admin API call must go to `/admin/api/2025-04/graphql.json` using `@shopify/shopify-api`'s GraphQL client.

**Audit command:**
```bash
grep -r "admin/api" app/ lib/ --include="*.ts" | grep -v graphql
```

---

### 2. Missing Content Security Policy (CSP) — `frame-ancestors`

**Shopify requirement:** Embedded apps must set `frame-ancestors` in CSP to restrict who can embed them. Shopify review tools check for this.

**Current state:** `next.config.mjs` sets `X-Frame-Options: ALLOWALL` but has no `Content-Security-Policy` header.

**Required addition to `next.config.mjs`:**
```js
{
  key: 'Content-Security-Policy',
  value: "frame-ancestors https://*.shopify.com https://admin.shopify.com https://*.myshopify.com;"
}
```

Keep `X-Frame-Options: ALLOWALL` alongside for older browser compat.

---

### 3. `write_discounts` Scope — Partner Dashboard Approval Required

Apps requesting `write_discounts` are subject to manual review for **Protected Customer Data**. Shopify must approve this in the Partner Dashboard before the app can go public.

**Action:** Partner Dashboard → App Setup → Protected Customer Data → declare data use for discount management → submit for approval.

---

### 4. CouponMaxx Billing Flow Not Verified

The `app_subscriptions/update` webhook exists (for CheckoutMaxx), but there is no confirmed billing initiation route for CouponMaxx. **If CouponMaxx charges merchants in any form, it must use Shopify's billing API exclusively.** Non-Shopify payment methods = instant rejection.

**Required:** A route that calls `appSubscriptionCreate` GraphQL mutation and redirects the merchant to Shopify's confirmation URL.

**Check:** Is there a `/api/couponmaxx/billing` or equivalent? If not, it must be built.

---

## HIGH PRIORITY (Likely cause rejection or low review score)

### 5. Rate Limiting Missing on `/api/cart/ingest`

`/api/pixel/ingest` has an in-memory rate limiter (500 req/min per shop). `/api/cart/ingest` does not. This endpoint is public and CORS-open, reachable from any storefront.

**File:** `app/api/cart/ingest/route.ts`  
**Action:** Copy the same `rateLimitMap` pattern from `app/api/pixel/ingest/route.ts`.

---

### 6. No React Error Boundaries

No `error.tsx` files found in the `app/(embedded)/` route group. Without these, any unhandled React error inside a Polaris component shows a blank/broken page to merchants — Shopify reviewers test for this.

**Required new files:**
- `app/(embedded)/error.tsx`
- `app/(embedded)/couponmaxx/error.tsx`

Each should render a Polaris `Banner` with `status="critical"` and a retry button.

---

### 7. No `loading.tsx` Loading States

Shopify reviewers test navigation between sections. Without `loading.tsx`, route segments show nothing during data fetch (blank screen).

**Required new files:**
- `app/(embedded)/couponmaxx/analytics/loading.tsx`
- `app/(embedded)/couponmaxx/sessions/loading.tsx`
- `app/(embedded)/couponmaxx/coupons/loading.tsx`

Use Polaris `SkeletonPage` + `SkeletonBodyText` inside each.

---

### 8. Privacy Policy & ToS URLs Missing from `shopify.app.toml`

Both pages exist (`/privacy`, `/terms`) but are not declared in the app config. Shopify requires these URLs to be registered.

**Add to `shopify.app.toml`:**
```toml
[app_info]
privacy_policy_url = "https://couponmaxx.vercel.app/privacy"
terms_of_service_url = "https://couponmaxx.vercel.app/terms"
```

Also verify both URLs return 200 in production.

---

### 9. App Store Listing Incomplete (Partner Dashboard)

Built for Shopify requires a complete, polished listing before review:

| Field | Requirement | Status |
|-------|-------------|--------|
| App name | Under 30 chars, starts with brand name | Verify "CouponMaxx" |
| Subtitle | Concise, under 60 chars, merchant-outcome focused | Unknown |
| Screenshots | Min 3 at 1280×800px | Unknown |
| Feature descriptions | Merchant outcomes, not features | Unknown |
| Category | Analytics or Marketing | Must be set |
| Support email | Valid, monitored | Must be set |

---

### 10. 50 Installs + 5 Reviews Minimum

Built for Shopify badge requires:
- **50 net installs** from shops on paid Shopify plans
- **5 reviews** on the Shopify App Store

These are non-code requirements but must be met before BFS is awarded. Plan merchant outreach accordingly.

---

## MEDIUM PRIORITY (Quality / best practices)

### 11. Extension Handle Mismatch in `shopify.app.toml`

The main `shopify.app.toml` registers:
```toml
[[extensions]]
type = "web_pixel"
handle = "cart-monitor"
```

But the Web Pixel extension's own toml (`extensions/checkout-monitor/shopify.extension.toml`) has `handle = "checkout-monitor"`.

The Theme App Extension is `cart-monitor`. The handles are swapped.

**Action:** Align the handle in `shopify.app.toml` to match each extension's own toml. Use `shopify app deploy --reset` on staging to confirm.

---

### 12. API Version Outdated

`api_version = "2025-04"` in `shopify.app.toml`. Shopify expects apps to stay on supported, recent versions.

**Action:** Update to `"2025-07"` (or latest stable at time of submission). Check [shopify.dev/docs/api/release-notes](https://shopify.dev/docs/api/release-notes) for breaking changes.

---

### 13. Storefront Performance — Cart Monitor Script

`extensions/cart-monitor/assets/cart-monitor.js` is 743 lines of synchronously injected JS. Shopify's Built for Shopify criteria requires the app not to decrease a store's Lighthouse score by more than **10 points** and CLS ≤ 0.1, INP ≤ 200ms.

**Action:** 
1. Run Lighthouse on a test store without the extension → baseline
2. Enable extension → measure delta
3. If score drops > 10 points: add `defer` to script loading or lazy-init after `DOMContentLoaded`

---

### 14. Onboarding Flow Completeness

Shopify reviewers specifically test first-run experience for new installs. The `/welcome` page exists but must:
1. Guide merchants to activate the Theme App Extension in their theme
2. Show how to set up their first coupon
3. Confirm pixel is active (auto-registered on install)

**Action:** Walk through the install flow on a fresh dev store and verify the welcome page is reachable, not skippable, and covers all three steps.

---

### 15. Contact Email in Privacy Policy

Current privacy policy lists `sk200435@gmail.com` as the contact email. Shopify reviewers and merchants expect a professional email (e.g., `support@couponmaxx.app` or a business email).

**Action:** Update privacy policy + Partner Dashboard listing with a professional support email.

---

## WHAT'S ALREADY SOLID

| Requirement | Status |
|---|---|
| OAuth with HMAC + CSRF state validation | ✅ |
| Session token verification (JWT, timingSafeEqual) | ✅ |
| All 3 GDPR webhooks (data_request, customers/redact, shop/redact) | ✅ |
| `app/uninstalled` webhook with pixel deregistration + data cleanup | ✅ |
| Offline tokens only (no online token exposure) | ✅ |
| Polaris v12 with `ui-nav-menu` embedded navigation | ✅ |
| App Bridge 4.x with id_token propagation | ✅ |
| Token exchange (session token → offline token) | ✅ |
| Webhook HMAC verification with timing-safe comparison | ✅ |
| Shop redact cascade delete | ✅ |
| Reinstall safety (fresh UUID, deactivates old record) | ✅ |
| Pixel rate limiting (500 req/min) | ✅ |
| Privacy policy page (content is solid) | ✅ |
| Terms of service page | ✅ |
| sendBeacon for storefront data transmission | ✅ |
| No DOM XSS vectors in cart monitor JS | ✅ |

---

## Prioritized Action List

| # | Item | Effort | Blocking? |
|---|------|--------|-----------|
| 1 | Audit + migrate any REST API calls to GraphQL | High | **YES** |
| 2 | Add CSP `frame-ancestors` to `next.config.mjs` | Low | **YES** |
| 3 | Verify Protected Customer Data approval (Partner Dashboard) | Low | **YES** |
| 4 | Confirm/build CouponMaxx billing flow via Shopify billing API | Medium | **YES** |
| 5 | Add rate limiting to `/api/cart/ingest` | Low | No |
| 6 | Add `error.tsx` Polaris error boundaries | Low | No |
| 7 | Add `loading.tsx` skeleton loading states | Low | No |
| 8 | Add `[app_info]` URLs to `shopify.app.toml` | Trivial | No |
| 9 | Fix extension handle mismatch in `shopify.app.toml` | Trivial | No |
| 10 | Bump `api_version` to latest in `shopify.app.toml` | Trivial | No |
| 11 | Complete Partner Dashboard listing (screenshots, subtitle, category) | Medium | No |
| 12 | Lighthouse test on storefront with cart-monitor extension | Low | No |
| 13 | Verify onboarding flow end-to-end on fresh dev store | Low | No |
| 14 | Update contact email to professional address | Trivial | No |
| 15 | Outreach plan for 50 installs + 5 reviews | Business | No |

---

## Files to Change

| File | Change |
|------|--------|
| `next.config.mjs` | Add CSP `frame-ancestors` header |
| `shopify.app.toml` | Add `[app_info]`, fix handle mismatch, bump api_version |
| `app/(embedded)/error.tsx` | New — Polaris error boundary |
| `app/(embedded)/couponmaxx/error.tsx` | New — Polaris error boundary |
| `app/(embedded)/couponmaxx/analytics/loading.tsx` | New — SkeletonPage |
| `app/(embedded)/couponmaxx/sessions/loading.tsx` | New — SkeletonPage |
| `app/(embedded)/couponmaxx/coupons/loading.tsx` | New — SkeletonPage |
| `app/api/cart/ingest/route.ts` | Add rate limiting |
| `lib/pixel.ts` | Migrate to GraphQL if using REST |
| `app/privacy/page.tsx` | Update contact email |

---

## Official Docs

- [Built for Shopify Requirements](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements)
- [App Store Requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
- [GDPR Webhooks](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
- [Protected Customer Data](https://shopify.dev/docs/apps/launch/protected-customer-data)
- [GraphQL Admin API](https://shopify.dev/docs/api/admin-graphql/latest)
- [App Design Guidelines / Polaris](https://shopify.dev/docs/apps/design)
- [API Release Notes](https://shopify.dev/docs/api/release-notes)
