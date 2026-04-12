# CouponMaxx Pre-Review Checklist

**Date:** 2026-04-12
**Status:** Review expected any day — support escalated after 17 business days

---

## Critical Bugs to Fix Before Review

| # | Bug | Impact | Fix | Status |
|---|-----|--------|-----|--------|
| 1 | `write_discounts` missing from `shopify.app.toml` | Smart Recovery can't create discount codes on production installs | Add to scopes line | TODO |
| 2 | `lib/shopify.ts` scopes out of sync | SDK config missing `read_customer_events` + `write_discounts` | Sync scopes array | TODO |
| 3 | Billing callback redirects to `/dashboard/converted` (dead route) | Merchant sees 404 after approving/declining billing | Change to `/couponmaxx/analytics` | TODO |
| 4 | Custom `background: #F1F1F1` + `fontFamily` in layout | Shopify reviewer flags override of admin chrome | Remove inline styles | TODO |

**After fixing #1:** Must run `shopify app deploy` to push scope changes to Partner Dashboard.

---

## Feature Status — What Works

### Cart Sessions Page (/couponmaxx/sessions)
- **Frontend:** Loads, filters, paginates, shows session timeline
- **API:** Calls 2 Supabase RPCs (`couponmaxx_session_kpis`, `couponmaxx_session_summaries`)
- **Risk:** If RPCs don't exist in Supabase, returns empty data silently
- **Empty state:** Clean — shows "No sessions found"
- **Status: WORKS** (if RPCs exist)

### Coupons Page (/couponmaxx/coupons)
- **Frontend:** Shows KPI boxes, velocity chart, code table, zombie codes
- **API:** Queries CartEvent + CheckoutEvent, builds sessions, computes per-code stats
- **Risk:** 20K row limit on queries — sets `truncated: true` but no user-facing warning
- **Empty state:** Clean — all boxes show 0
- **Status: WORKS**

### Notifications Page (/couponmaxx/notifications)
- **Frontend:** Alert feed with severity tabs, notification channel settings
- **API:** Queries AlertLog, graceful fallback if isRead/isDismissed columns missing
- **Risk:** Slack settings visible but Slack is disabled — reviewer might try to connect
- **Empty state:** Clean — "No notifications yet"
- **Status: PARTIAL** (Slack UI shows but doesn't work)

### Smart Recovery
- **Settings page:** Full Polaris UI with SaveBar, rule config, style picker — **WORKS**
- **Decide engine:** Resolves failure via Shopify Admin API, creates discount codes — **WORKS** (if `write_discounts` scope is present)
- **Stats:** Shows codes offered/used, revenue recovered — **WORKS**
- **Storefront script:** Detects coupon failure, calls decide, renders recovery pills — **WORKS**
- **Status: WORKS** (after scope fix)

### Analytics Page (/couponmaxx/analytics)
- Onboarding banner, app status check, date range, filters, funnel, recovery stats
- **Status: WORKS**

### Cart Page (/couponmaxx/cart)
- Depends on Supabase RPC functions
- **Status: WORKS** (if RPCs exist)

---

## Scope Mismatch Map

| Location | Scopes | `write_discounts` | `read_customer_events` |
|----------|--------|-------------------|----------------------|
| `shopify.app.toml` (production) | 5 scopes | MISSING | YES |
| `shopify.app.checkoutmaxx.toml` (dev) | 6 scopes | YES | YES |
| `app/api/auth/begin/route.ts` (hardcoded) | 6 scopes | YES | YES |
| `lib/shopify.ts` (SDK config) | 4 scopes | MISSING | MISSING |

**Fix:** Sync all 4 locations to: `read_orders, read_checkouts, write_pixels, read_customer_events, read_analytics, write_discounts`

---

## Billing Plan

**Model:** $49/month, mandatory, 7-day free trial

### Current State
- `lib/billing.ts` — PRO plan config exists ($49/mo, 7-day trial)
- `app/api/billing/create/route.ts` — Creates Shopify subscription, redirects to approval
- `app/api/billing/callback/route.ts` — Handles approval/decline, updates Shop record
- DB fields exist: `subscriptionId`, `subscriptionStatus`, `billingPlan`, `trialEndsAt`
- **No billing gate in UI** — everyone uses app for free

### What Needs Building
1. `app/api/billing/status/route.ts` — Returns current billing status for frontend
2. `components/couponmaxx/BillingGate.tsx` — Wraps layout, checks status, shows upgrade prompt if needed
3. Update auth callback to redirect to billing create after install
4. Fix billing callback redirect (already in critical fixes above)

### Flow After Implementation
```
New Install:
  OAuth → Auth Callback → Redirect to /api/billing/create
  → Shopify shows $49/mo approval screen (7-day trial)
  → Approved: status=ACTIVE, trial starts, app loads normally
  → Declined: status=DECLINED, app shows upgrade gate

Existing Free Users:
  → BillingGate detects no subscription
  → Shows upgrade prompt blocking app access

Trial Expired:
  → BillingGate detects trial ended + no active sub
  → Shows upgrade prompt
```

---

## Testing Plan

### Automated Tests (Claude writes these)
| Test File | What It Tests |
|-----------|--------------|
| `__tests__/api/sessions.test.ts` | Sessions API: response shape, filters, pagination, empty state, auth |
| `__tests__/api/coupons.test.ts` | Coupons API: response shape, truncation, date ranges, empty state |
| `__tests__/api/notifications.test.ts` | Notifications API: alerts, severity filter, mark-read, column fallback |
| `__tests__/api/recovery-decide.test.ts` | Recovery decide: all 6 failure reasons, hunter protection, rate limits, CORS |
| `__tests__/api/recovery-settings.test.ts` | Recovery settings: GET defaults, POST save, auth |
| `__tests__/api/recovery-stats.test.ts` | Recovery stats: response shape, empty state |
| `__tests__/api/auth.test.ts` | Auth: HMAC validation, CSRF check, missing params |
| `__tests__/api/billing.test.ts` | Billing: create redirect, callback status update |
| `__tests__/api/ingest.test.ts` | Ingest: valid events, missing fields, rate limit, CORS |
| `__tests__/lib/sanitize.test.ts` | Sanitization: PII stripping |

### Manual Tests (User must do)

#### Install Flow
- [ ] Install app on dev store
- [ ] Verify OAuth completes without error
- [ ] Verify app loads embedded in Shopify admin
- [ ] Verify pixel registered (check Partner Dashboard > Extensions)
- [ ] Verify webhook registered (check Partner Dashboard > Webhooks)

#### Smart Recovery (Storefront)
- [ ] Enable Smart Recovery in Settings page
- [ ] Configure at least one rule (e.g., expired → offer fallback code)
- [ ] Go to storefront, add product to cart
- [ ] Enter an expired/invalid coupon code
- [ ] Verify recovery message appears with alternative code
- [ ] Click recovery code pill → verify it copies to clipboard
- [ ] Apply recovery code → verify discount applied

#### Billing
- [ ] Trigger billing flow (navigate to `/api/billing/create?shop=yourstore.myshopify.com`)
- [ ] Approve on Shopify screen → verify redirect to analytics page
- [ ] Check Shop record in Supabase: `subscriptionStatus` should be "ACTIVE"

#### Each Page
- [ ] Analytics — loads, shows data or empty state, date picker works
- [ ] Cart Sessions — loads, shows sessions or empty state, click session for timeline
- [ ] Coupons — loads, shows codes or empty state, click code for detail
- [ ] Cart — loads, shows funnel or empty state
- [ ] Notifications — loads, shows alerts or empty state, severity tabs work
- [ ] Settings — loads, toggle recovery on/off, save, verify SaveBar appears/disappears

#### Uninstall
- [ ] Uninstall app from dev store
- [ ] Verify Shop record soft-deleted (`isActive: false`)
- [ ] Verify pixel deregistered
- [ ] Reinstall → verify clean install flow

---

## What's Left After Review Passes

| Item | Priority | Effort |
|------|----------|--------|
| Strip Slack integration (UI + routes + lib) | Medium | 2 hrs |
| Delete dead code in pixel/ingest (138 commented lines) | Low | 5 min |
| Delete `/preview` page | Low | 5 min |
| Delete dead middleware (dashboard version routing) | Low | 5 min |
| Remove `.env` from git history | High | 30 min |
| Built for Shopify badge prep (mobile, Polaris, Lighthouse) | Medium | 3-5 days |
| IngestLog retention policy | Low | 1 hr |
| Consolidate dual ORM (pick Supabase or Prisma, not both) | Low | 1-2 days |
