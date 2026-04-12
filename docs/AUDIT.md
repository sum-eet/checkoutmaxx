# CouponMaxx — Full App Audit

**Date:** 2026-04-11
**Branch:** `couponmaxx-submission`
**App URL:** https://couponmaxx.vercel.app

---

## 1. App Overview

CouponMaxx is an embedded Shopify app that monitors coupon/discount code usage on merchant storefronts. It tracks cart activity, coupon success/failure, checkout funnels, and offers "Smart Recovery" — when a coupon fails, it can automatically suggest an alternative discount code to the customer.

**Architecture:**
- Next.js 14 (App Router) on Vercel
- Supabase PostgreSQL (primary data store) + Prisma ORM (sessions/GDPR)
- 2 Shopify extensions: Web Pixel (checkout events) + Theme App Extension (cart events)
- Vercel Cron Jobs for alert evaluation and baselines
- Resend for email alerts, Slack integration (currently disabled)

**Scopes:** `read_orders, read_checkouts, write_pixels, read_customer_events, read_analytics`

---

## 2. Extensions

### checkout-monitor (Web Pixel)
| Aspect | Detail |
|--------|--------|
| Type | `web_pixel` (sandboxed Web Worker) |
| Purpose | Tracks checkout funnel: started → contact → address → shipping → payment → completed. Also captures discount codes, device type, country, alert_displayed, ui_extension_errored. |
| Communication | `sendBeacon` only (no fetch/DOM/localStorage) |
| Ingest endpoint | `/api/pixel/ingest` |
| Session linking | Reads `_cmx_sid` from cart attributes (set by cart-monitor). Falls back to checkout token. |
| **Status** | **WORKS** |

### cart-monitor (Theme App Extension)
| Aspect | Detail |
|--------|--------|
| Type | `theme` (injects into `<body>`) |
| Purpose | Intercepts all cart network calls (fetch + XHR). Tracks: cart_item_added/removed/changed, coupon_applied/failed/recovered/removed, checkout_clicked, atc_clicked, drawer_opened/closed, page_hidden. |
| Sub-script | `smart-recovery.js` — listens for coupon failures, calls `/api/couponmaxx/recovery/decide`, renders recovery UI with alternative codes |
| CSS | `smart-recovery.css` — 3 display styles (minimal, warm, green) |
| Ingest endpoint | `/api/cart/ingest` + `/api/session/ping` |
| **Status** | **WORKS** |

**Data flow:** Both extensions share session ID via cart attributes (`_cmx_sid`). Cart-monitor sets it, checkout-monitor reads it. When a `checkout_completed` fires in the pixel, the ingest route mirrors it back to CartEvent by correlating with the most recent `cart_checkout_clicked` within 30 minutes.

---

## 3. Admin Pages

### Navigation (App Bridge `<ui-nav-menu>`)
6 items: Analytics | Cart Sessions | Coupons | Cart | Notifications | Settings

| Page | Route | What it shows | Status | Notes |
|------|-------|--------------|--------|-------|
| **Analytics** | `/couponmaxx/analytics` | Coupon success rate, coupon usage rate, attributed sales, revenue at risk, cart views (3 variants), coupon funnel (6 steps), Smart Recovery stats. Date range picker, compare-to, device/UTM filters. | **WORKS** | Has onboarding banner, app status banner (checks extension activation via `shopify.app.extensions()`), and no-data state. Well-built. |
| **Cart Sessions** | `/couponmaxx/sessions` | Individual cart session browser with timeline, filtering, sorting | **WORKS** | |
| **Coupons** | `/couponmaxx/coupons` | Coupon code health table — success rates, usage counts, handoff metrics | **WORKS** | |
| **Cart** | `/couponmaxx/cart` | Cart funnel analysis — sessions, conversions, checkout steps, timing distribution | **WORKS** | Relies on Supabase RPC functions (server-side SQL). If those RPCs don't exist in Supabase, this page breaks silently. |
| **Notifications** | `/couponmaxx/notifications` | Alert feed with severity tabs (critical/warning/info). Notification channel settings (email + Slack). Has SaveBar. 9 alert types configurable. | **PARTIAL** | Slack channel settings visible but Slack is disabled. Email channel works. Alert feed depends on `evaluate-alerts` cron running and finding issues. |
| **Settings** | `/couponmaxx/settings` | Smart Recovery config: master toggle, per-failure-type rules (6 types), coupon hunter protection, high-value cart boost, personalization toggles, display style picker with live previews. | **WORKS** | Uses Shopify SaveBar correctly. No Slack UI here (that's in Notifications). Clean Polaris implementation. |
| **Welcome** | `/welcome` | Post-install feature overview | **WORKS** | |
| **Preview** | `/preview` | Demo page with sample data for all dashboard views | **DEV ONLY** | Not linked in nav. Only useful during development. |
| **Privacy** | `/privacy` | Privacy policy | **WORKS** | Required for app store. |
| **Terms** | `/terms` | Terms of service | **WORKS** | Required for app store. |

### Layout
- Custom wrapper div with `minHeight: 100vh`, `background: #F1F1F1`, `maxWidth: 1000px`
- This overrides Shopify admin's native background — could cause visual inconsistency

---

## 4. API Routes

### Auth
| Route | Method | Purpose | Status |
|-------|--------|---------|--------|
| `/api/auth` | GET | Sanitizes shop param, redirects to `/api/auth/begin` | **WORKS** |
| `/api/auth/begin` | GET | Generates CSRF state, sets cookie, redirects to Shopify OAuth | **WORKS** |
| `/api/auth/callback` | GET | HMAC validation, token exchange, creates Shop record, registers pixel + webhooks in background | **WORKS** |

### Data Ingestion
| Route | Method | Purpose | Status |
|-------|--------|---------|--------|
| `/api/pixel/ingest` | POST | Checkout event ingestion via Supabase. Rate limited (500/min/shop). Uses `waitUntil()` for async DB write. Also mirrors `checkout_completed` to CartEvent table. | **WORKS** — has 138 lines of dead commented-out Prisma version at top of file |
| `/api/cart/ingest` | POST | Cart event ingestion via Supabase. Rate limited. Uses `waitUntil()`. | **WORKS** |
| `/api/session/ping` | POST | Session lifecycle pings. Uses `waitUntil()`. | **WORKS** |

### Analytics & Data
| Route | Method | Purpose | Status |
|-------|--------|---------|--------|
| `/api/couponmaxx/analytics` | GET | Main dashboard metrics — success rates, attribution, funnel, cart views, revenue at risk. Supports date ranges, device/UTM filters, comparison periods. | **WORKS** |
| `/api/couponmaxx/coupons` | GET | List all coupon codes with health/success metrics | **WORKS** |
| `/api/couponmaxx/coupons/[code]` | GET | Individual coupon detail | **WORKS** |
| `/api/couponmaxx/sessions` | GET | List cart sessions with filtering/sorting | **WORKS** |
| `/api/couponmaxx/session` | GET | Single session timeline with events | **WORKS** |
| `/api/couponmaxx/cart` | GET | Cart funnel analysis (Supabase RPC) | **WORKS** — depends on Supabase RPC functions existing |
| `/api/couponmaxx/cart/activity` | GET | Cart activity patterns | **WORKS** |
| `/api/couponmaxx/cart/conversion` | GET | Conversion metrics (coupon vs no-coupon) | **WORKS** |

### Smart Recovery
| Route | Method | Purpose | Status |
|-------|--------|---------|--------|
| `/api/couponmaxx/recovery/decide` | POST | Core recovery engine (574 lines). Evaluates failure reason via Shopify Admin API, applies rules, creates Shopify discount codes on-the-fly. Rate limited (1 code/session/10min, daily store limit). CORS enabled. | **WORKS** — this is the key differentiator |
| `/api/couponmaxx/recovery/settings` | GET/POST | Get/update Smart Recovery rules per failure type | **WORKS** |
| `/api/couponmaxx/recovery/stats` | GET | Recovery performance stats (offered, used, revenue recovered) | **WORKS** |

### Notifications & Alerts
| Route | Method | Purpose | Status |
|-------|--------|---------|--------|
| `/api/couponmaxx/notifications` | GET | List alerts with severity filtering | **WORKS** |
| `/api/couponmaxx/notifications/[id]/read` | POST | Mark alert as read/dismissed | **WORKS** |
| `/api/couponmaxx/settings` | GET/POST | Notification channel preferences + alert thresholds | **WORKS** |
| `/api/couponmaxx/slack/callback` | GET | Slack OAuth callback | **BROKEN** — Slack is disabled (`SLACK_ENABLED=false`). OAuth flow exists but won't complete. |

### Billing
| Route | Method | Purpose | Status |
|-------|--------|---------|--------|
| `/api/billing/create` | POST | Initiates Shopify subscription | **WORKS** |
| `/api/billing/callback` | GET | Subscription confirmation | **WORKS** |

### Background Jobs (Vercel Cron)
| Route | Schedule | Purpose | Status |
|-------|----------|---------|--------|
| `/api/jobs/evaluate-alerts` | Daily 2 AM | Queries coupon failures in last 2h, groups by code, checks thresholds, fires alerts (email + Slack). 4h cooldown. | **WORKS** — Slack delivery will silently fail if shop has no webhook URL |
| `/api/jobs/compute-baselines` | Daily midnight | 7-day rolling CVR baseline. Silent learning period (48h + 20 checkouts minimum). | **WORKS** |
| `/api/jobs/weekly-digest` | Monday 9 AM | Weekly email summary (checkout count, CVR vs prior week, top drop-off step). Uses Prisma (not Supabase). | **WORKS** — uses different ORM than other jobs |
| `/api/jobs/test-alert` | Manual | Test alert delivery | **DEV ONLY** |

### Webhooks
| Route | Purpose | Status |
|-------|---------|--------|
| `/api/webhooks/app-uninstalled` | Soft-delete shop, deregister pixel, delete session | **WORKS** — required |
| `/api/webhooks/customers/data-request` | GDPR data request (acknowledges, no PII stored) | **WORKS** — required |
| `/api/webhooks/customers/redact` | GDPR customer deletion (no-op, session-level data only) | **WORKS** — required |
| `/api/webhooks/shop/redact` | GDPR shop erasure (deletes all events, alerts, baselines) | **WORKS** — required |

### System
| Route | Purpose | Status |
|-------|---------|--------|
| `/api/health` | Health check (Supabase connectivity, event recency, ingest failure count) | **WORKS** |
| `/api/shop-status` | Shop installation status | **WORKS** |

---

## 5. Middleware

**File:** `middleware.ts`

Routes `/dashboard` and old v1 paths (`/dashboard/cart`, `/dashboard/converted`, `/dashboard/abandoned`) to the current version based on `DASHBOARD_VERSION` env var (v1-v4).

**Status:** Legacy routing. Current app uses `/couponmaxx/*` routes. The middleware only fires on `/dashboard*` paths that nothing links to anymore. **DEAD CODE** unless external links or bookmarks still point to `/dashboard`.

---

## 6. Data Layer

### Prisma Schema (PostgreSQL via Supabase)
| Table | Purpose | Used By |
|-------|---------|---------|
| **Session** | Shopify OAuth session storage | Auth routes |
| **Shop** | Core installation record — domain, access token, pixel ID, alert prefs, billing, soft-delete flag | Everything |
| **CheckoutEvent** | Web Pixel events (checkout funnel) | Pixel ingest, analytics |
| **CartEvent** | Cart monitor events (cart activity, coupons) | Cart ingest, analytics, recovery |
| **AlertLog** | Alert history with severity, ROI fields, delivery tracking | Alert cron, notifications page |
| **Baseline** | 7-day rolling metric baselines | Baseline cron, alert evaluation |

### Dual ORM Situation
| Layer | Used For |
|-------|----------|
| **Prisma** | Session CRUD, GDPR webhooks (shop/redact), weekly digest |
| **Supabase JS** | All ingest, all analytics queries, alert engine, recovery stats, baselines |

Both point at the same PostgreSQL database. No data inconsistency risk (same tables), but code inconsistency — some routes use `prisma.shop.findUnique()`, others use `supabase.from("Shop").select()`.

### Supabase RPC Dependencies
The `/api/couponmaxx/cart` route calls Supabase RPC functions (server-side SQL). If these functions don't exist in the Supabase project, the Cart page will return empty/error silently.

---

## 7. Lib Files (18)

| File | Purpose | Status |
|------|---------|--------|
| `prisma.ts` | Singleton PrismaClient | **WORKS** |
| `shopify.ts` | Shopify API client + webhook registration | **WORKS** |
| `session-storage.ts` | Custom Prisma session storage | **WORKS** |
| `supabase.ts` | Supabase admin client | **WORKS** |
| `alert-engine.ts` | Alert evaluation for failed discounts | **WORKS** |
| `verify-session-token.ts` | JWT session token verification | **WORKS** |
| `verifyWebhookHmac.ts` | HMAC-SHA256 webhook signature verification (timing-safe) | **WORKS** |
| `ensure-shop.ts` | Ensures Shop record exists, handles token exchange | **WORKS** |
| `pixel-registration.ts` | Registers/deregisters Web Pixel via GraphQL | **WORKS** |
| `send-email.ts` | Email alerts via Resend | **WORKS** |
| `send-slack.ts` | Slack alert webhooks with buttons | **DISABLED** — code works, but no shops have webhook URLs since Slack OAuth is broken. Also links to `/dashboard?shop=` (old route). |
| `billing.ts` | Shopify app billing (create/get subscription) | **WORKS** |
| `compute-baselines.ts` | 7-day CVR baseline calculation | **WORKS** |
| `metrics.ts` | Analytics queries (KPI, funnel, events, errors) | **WORKS** |
| `session-utils.ts` | V3 session building from cart + checkout events | **WORKS** |
| `authenticated-fetch.ts` | Fetch wrapper forwarding App Bridge id_token | **WORKS** |
| `sanitize.ts` | PII scrubbing from event payloads | **WORKS** |
| `ingest-log.ts` | Fire-and-forget logging of ingest attempts | **WORKS** |

---

## 8. Integrations

| Service | Purpose | Status |
|---------|---------|--------|
| **Shopify Admin API** | OAuth, pixel registration, discount creation (recovery), webhook setup | **WORKS** |
| **Supabase PostgreSQL** | Primary data store | **WORKS** |
| **Prisma ORM** | Sessions, GDPR, weekly digest | **WORKS** |
| **Resend** | Email alert delivery (from `alerts@flowymails.com`) | **WORKS** |
| **Slack** | Alert delivery via incoming webhooks + OAuth | **BROKEN** — `SLACK_ENABLED=false`. OAuth callback route exists but Slack integration cannot be set up by merchants. `send-slack.ts` links to dead `/dashboard` route. |
| **Healthchecks.io** | Cron monitoring | **WORKS** (optional) |
| **Vercel** | Hosting, cron jobs, `waitUntil()` | **WORKS** |

---

## 9. Dead Code & Cruft

### Confirmed Dead Code
| Location | What | Why Dead |
|----------|------|----------|
| `app/api/pixel/ingest/route.ts` lines 1-138 | Entire commented-out Prisma version of the ingest handler | Replaced by Supabase + waitUntil version below it |
| `middleware.ts` | Dashboard version routing (v1/v2/v3/v4) | App now uses `/couponmaxx/*` routes. Nothing links to `/dashboard` anymore. |
| `app/preview/page.tsx` | Dev-only demo page with sample data | Not linked in nav, not useful in production |
| `/api/jobs/test-alert` | Manual test alert trigger | Dev tool, protected by CRON_SECRET |
| Slack integration (routes + lib + settings UI) | Full Slack OAuth flow + webhook delivery | Disabled. Settings page shows Slack options that can't actually connect. |

### Untracked Files in Repo
```
.agents/
.mcp.json
.vscode/
FRESH-FOUNDATION-BUILD (1).md
app/terms/          (staged for commit but new)
caveman/
docs/CART-FINAL-V3.md
docs/CART-PAGE-UX-REDESIGN.md
docs/couponmaxx-smart-recovery-spec.md
docs/recovery-preview.html
remotion/
skills-lock.json
```

### Minor Issues
- `send-slack.ts` line 40: Links to `/dashboard?shop=` which is a dead route
- Settings page has a bottom "Save settings" button AND a SaveBar — redundant (SaveBar is the Polaris way)
- Layout sets custom `background: #F1F1F1` which overrides Shopify admin's native background

---

## 10. Security Notes

| Issue | Severity | Detail |
|-------|----------|--------|
| `.env` in repo | **HIGH** | Contains live Shopify API keys, Supabase passwords, Resend key. Should be gitignored and managed via Vercel env vars only. |
| CORS `*` on ingest | **OK** | Required for `sendBeacon` cross-origin from storefronts. Standard pattern for pixel/analytics endpoints. |
| Rate limiting in-memory | **LOW** | Rate limit maps reset on function cold start. Fine for basic protection but not bulletproof. |
| No retry on `waitUntil` failures | **LOW** | If Supabase is briefly down during a `waitUntil` write, that event is lost silently. Logged via `ingest-log` but not retried. |
| HMAC verification | **OK** | Webhooks use timing-safe HMAC comparison. Auth callbacks verify HMAC + CSRF state cookie. |
| Session tokens | **OK** | JWT verification with expiry check. App Bridge 4.x session token flow. |

---

## 11. Built for Shopify — Gap Analysis

If pursuing the badge, here's what currently meets requirements and what doesn't:

### Already Meets Requirements
- Embedded in Shopify admin
- Session token authentication (no third-party cookies)
- Latest App Bridge (script tag in layout)
- Web Pixel usage (not script tags)
- Theme App Extension for storefront (clean uninstall)
- App Bridge nav menu (`<ui-nav-menu>`)
- GDPR webhook handlers
- Onboarding banner (dismissible, post-install)
- App status check on homepage (extension activation via `shopify.app.extensions()`)
- SaveBar on Settings page
- Polaris components used throughout

### Gaps / Needs Work
| Requirement | Current State | Work Needed |
|-------------|--------------|-------------|
| 50+ net installs | Unknown | Business milestone |
| 5+ reviews | Unknown | Business milestone |
| Admin Web Vitals (LCP ≤2.5s, CLS ≤0.1, INP ≤200ms) | Unknown — needs measurement | Test in Shopify Partner Dashboard |
| Storefront Lighthouse impact (≤10 point drop) | Unknown — cart-monitor.js is 743 lines | Test with extension enabled vs disabled |
| Mobile responsive | Not audited | Need to test all pages on mobile viewport |
| Contextual Save Bar on Notifications page | Has SaveBar | Verify it works correctly |
| No custom background override | Layout sets `background: #F1F1F1` | Should use Shopify admin's native background |
| Discount app requirements | Recovery creates discounts via Admin API | Verify: uses native discount APIs, single redeem code per discount, no draft orders |
| No auto-appearing modals | None observed | OK |
| Red reserved for errors only | Not fully audited | Check all components |

---

## 12. Summary Table

| Component | Count | Works | Broken/Dead | Notes |
|-----------|-------|-------|-------------|-------|
| Extensions | 2 | 2 | 0 | Both core data pipelines working |
| Admin pages | 10 | 9 | 1 partial | Notifications page shows Slack options that don't work |
| API routes (auth) | 3 | 3 | 0 | |
| API routes (ingest) | 3 | 3 | 0 | pixel/ingest has dead code at top |
| API routes (analytics) | 8 | 8 | 0 | Cart route depends on Supabase RPCs |
| API routes (recovery) | 3 | 3 | 0 | Core differentiator |
| API routes (notifications) | 4 | 3 | 1 | Slack callback broken |
| API routes (billing) | 2 | 2 | 0 | |
| API routes (cron jobs) | 4 | 3 | 1 dev-only | test-alert is dev tool |
| API routes (webhooks) | 4 | 4 | 0 | All required, all working |
| API routes (system) | 2 | 2 | 0 | |
| Lib files | 18 | 17 | 1 disabled | send-slack.ts functional but Slack disabled |
| Cron jobs | 3 | 3 | 0 | |
| DB tables | 6 | 6 | 0 | |
| **Totals** | **72** | **66** | **6** | |
