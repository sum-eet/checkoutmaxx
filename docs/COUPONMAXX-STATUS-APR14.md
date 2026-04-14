# CouponMaxx — Status Brief (Apr 14 2026)

**Branch:** `couponmaxx-submission`  
**Production:** `https://couponmaxx.vercel.app`  
**Store:** `testingstoresumeet.myshopify.com`  
**Supabase:** `voohvpscahyosapcxbfn.supabase.co`

---

## What Is Working

### Auth & Reinstall Flow ✅
- OAuth callback (`/api/auth/callback`) completes correctly
- On every reinstall: deactivates all old Shop rows, creates fresh UUID row with real access token
- HMAC validation, CSRF state check, session storage all working
- Redirects to Shopify admin app URL after install

### Shop Provisioning (`ensureShop`) ✅
- **Root cause fixed (commit `45ff4a2`):** Original code used a JS-side `isActive` filter (`s.isActive === true || s.isActive === "true"`) that silently failed in production. SELECT errors were also swallowed.
- **Fix:** Replaced with direct `.eq("isActive", true).maybeSingle()` — same pattern used by `resolveShopId()` in cart/ingest which always worked.
- All analytics/recovery/sessions endpoints now return 200 reliably.

### Analytics Dashboard ✅
- `/api/couponmaxx/analytics` → 200 after ensureShop fix
- `/api/couponmaxx/recovery/stats` → 200
- **SSR hydration fix (commit `3f34cc8`):** `useShop()` was resolving shop domain in `useState` initializer — server returned `""`, client returned real domain → React error #418 → SWR key stayed null → no data fetched. Fixed by always initializing state to `""` and resolving in `useEffect` only.
- Dashboard now loads data correctly on hard refresh.

### Cart Event Tracking ✅
- Theme extension (Cart Monitor) deployed and active on `testingstoresumeet.myshopify.com`
- Events flowing into `CartEvent` table in real time: `cart_item_added`, `cart_item_changed`, `cart_coupon_failed`, `cart_coupon_applied`, `cart_checkout_clicked`, etc.
- `resolveShopId()` in `/api/cart/ingest` correctly maps events to the active Shop row
- **Confirmed:** 8 coupon codes tracked for test store (`bruh1`, `bruh2`, `coupon14apr`, etc.)

### Cart Sessions Page ✅
- Shows sessions with timeline, cart value, coupon attempts
- Data refreshes in real time

### Billing Setup ✅
- `appSubscriptionCreate` mutation: correct (Pro plan, $49/30 days, 7 trial days, test=false in prod)
- `/api/billing/create` → creates Shopify subscription, redirects to confirmationUrl
- `/api/billing/callback` → verifies active subscription, updates `subscriptionStatus`/`billingPlan` in DB
  - **Fixed:** was incorrectly computing `trialEndsAt` manually (Shopify owns the trial clock)
  - Added full logging + DB error capture
- **New (commit `3f34cc8`):** `APP_SUBSCRIPTIONS_UPDATE` webhook handler added at `/api/webhooks/app-subscriptions-update` and registered in `registerWebhooks()` — mandatory per Shopify billing requirements. Handles ACTIVE / DECLINED / EXPIRED / CANCELLED status changes.

### Navigation ✅
- Sidebar nav: Analytics, Cart Sessions, Coupon Codes, Cart, Notifications, Settings
- "Coupons" renamed to "Coupon Codes" for clarity

---

## What Is Not Working / In Progress

### Smart Recovery UI ⚠️
**What it does:** When a shopper types an invalid coupon code, `smart-recovery.js` (loaded via the theme extension) calls `/api/couponmaxx/recovery/decide`, which looks up the real failure reason via Shopify Admin GraphQL and either offers a generated fallback discount code or shows a contextual error message inline.

**Root causes found and fixed:**
1. `smart-recovery.js` was never loaded — `cart-monitor.liquid` only injected `cart-monitor.js`. Fixed in commit `f6917ce`, extension redeployed as `couponmaxx-14`.
2. The `invalid` rule in `MerchantRecoverySettings` had `enabled: false` — so even if the script ran, recovery would return `show_nothing` for invalid codes. Fixed directly in DB.

**Current blocker:** Browser-level blocking. The console on `testingstoresumeet.myshopify.com/cart` shows `ERR_BLOCKED_BY_CLIENT` — an ad blocker (uBlock Origin or similar) is blocking the fetch to `/api/couponmaxx/recovery/decide` because the word "recovery" matches common filter lists.

**To confirm it works:** Disable ad blocker on the test store, enter a bad coupon code, click Apply. The recovery suggestion should appear inline in Shopify's discount error container.

**Pending fix:** Rename the recovery decide endpoint to a neutral path (e.g. `/api/couponmaxx/cx`) and update `smart-recovery.js` default URL to avoid ad-block false positives.

---

## Key DB State

| Table | Notes |
|-------|-------|
| `Shop` | One active row: `277abf96` for `testingstoresumeet.myshopify.com`, `isActive=true`, real access token |
| `CartEvent` | 8 coupon codes tracked, multiple sessions, live data flowing |
| `MerchantRecoverySettings` | `enabled=true`, `invalid` rule now `offer_fallback_code` + 10% off, 15min expiry |
| `RecoveryEvent` | No events yet for test store (script was blocked) |
| `Session` | Offline session stored for shop |

---

## Partial Index (critical)
```sql
-- Prevents duplicate active Shop rows on concurrent installs
Shop_shopDomain_active_unique ON Shop(shopDomain) WHERE isActive=true
```
Auth callback deactivates all rows before inserting new one. `ensureShop` handles 23505 conflict via re-fetch.

---

## Commits Since Reinstall Fix Plans

| Hash | Description |
|------|-------------|
| `45ff4a2` | fix: replace broken JS boolean filter with direct Supabase query in ensureShop |
| `3f34cc8` | fix: useShop SSR hydration + billing webhook + logging |
| `f9543f8` | fix: rename Coupons nav item to Coupon Codes |
| `f6917ce` | fix: load smart-recovery.js on storefront + enable invalid rule |
