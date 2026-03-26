# CheckoutMaxx — SPEC.md
> Last updated: 2026-03-13
> Rule: Never delete from this file. Only append. New sections go at the bottom.
> Every Claude Code session reads this before touching any code.

---

## SYSTEM IDENTITY

CheckoutMaxx is a Shopify embedded app that captures every event in the
cart-to-order funnel and surfaces it to the merchant.

**If the data pipeline stops working, the product has no value.**

Deployed at: https://checkoutmaxx-rt55.vercel.app
Repo: https://github.com/sum-eet/checkoutmaxx
Database: Supabase (project voohvpscahyosapcxbfn)
Platform: Next.js 14 App Router, Vercel serverless

---

## COMPONENT MAP

```
[Shopify Storefront]
  └── extensions/cart-monitor/assets/cart-monitor.js  (Theme App Extension)
        └── POST /api/cart/ingest  (beacon via navigator.sendBeacon)

[Shopify Checkout]
  └── pixel/checkout-monitor.js  (Web Pixel)
        └── POST /api/pixel/ingest  (beacon)

[Shopify Admin Embedded App]
  └── app/(embedded)/dashboard/*  (Next.js pages, Polaris UI)
        └── GET /api/cart/all       → lib/cart-metrics.ts
        └── GET /api/cart/session   → lib/cart-metrics.ts
        └── GET /api/alerts         → direct Supabase query
        └── GET /api/settings       → direct Supabase query
        └── GET /api/metrics        → lib/metrics.ts

[Background Jobs]
  └── /api/jobs/evaluate-alerts   (Vercel cron — alert engine)
  └── /api/jobs/compute-baselines (Vercel cron)
```

---

## COMPONENT CONTRACTS

### Cart Monitor JS → /api/cart/ingest

The cart monitor intercepts all cart network calls via Fetch + XHR proxy.
Sends beacons to /api/cart/ingest after every cart state change.

**Event types (written to CartEvent table):**
- `cart_item_added` — customer adds item (/cart/add.js)
- `cart_item_changed` — quantity change (/cart/change.js, qty > 0)
- `cart_item_removed` — quantity set to 0 (/cart/change.js)
- `cart_bulk_updated` — non-discount /cart/update.js call (includes session init)
- `cart_coupon_applied` — discount code worked (/cart/update.js with discount field)
- `cart_coupon_failed` — discount code rejected
- `cart_coupon_recovered` — previously failed code now works (customer added items)
- `cart_coupon_removed` — code removed from cart
- `cart_checkout_clicked` — checkout button click
- `cart_page_hidden` — page visibility changed to hidden (abandonment signal)

**Skipped at ingest (not written):**
- `cart_fetched` — /cart.js polls (too noisy)
- `cart_unknown_endpoint` — unrecognised cart path
- `cart_fetch_error`, `cart_xhr_error`, `cart_xhr_parse_error` — network noise

**Payload contract:**
```typescript
{
  eventType: string;          // REQUIRED
  shopDomain: string;         // REQUIRED
  sessionId: string;          // REQUIRED — from sessionStorage._cmx_sid
  cartToken: string | null;   // OPTIONAL but important for session join
  occurredAt: string;         // ISO timestamp from client clock
  url: string;                // page URL (path only after sanitise)
  device: 'mobile' | 'desktop';
  country: string | null;     // from window.Shopify.country (unreliable — see store notes)
  payload: {
    cartValue: number | null; // in cents
    cartItemCount: number | null;
    lineItems: Array<{productId, variantId, productTitle, price, quantity}> | null;
    code?: string;            // coupon events only
    discountAmount?: number;  // coupon events only
    // ... other event-specific fields
  }
}
```

If `eventType` or `shopDomain` missing → 400. All other missing fields → null in DB.

**Session ID init:** On page load, cart monitor calls `/cart/update.js` with
`attributes: { _cmx_sid: sessionId }` to store the ID as a cart attribute.
This fires a `cart_bulk_updated` event. This is expected and intentional.

### Web Pixel → /api/pixel/ingest

Web Pixel runs inside Shopify's checkout sandbox. Sends events at each checkout step.

**Event types (written to CheckoutEvent table):**
- `checkout_started`
- `checkout_contact_info_submitted`
- `checkout_address_info_submitted`
- `checkout_shipping_info_submitted`
- `payment_info_submitted`
- `checkout_completed`
- `alert_displayed` — discount code error shown in checkout UI
- `ui_extension_errored` — checkout UI extension crashed

**Session ID linkage:** Web Pixel reads `_cmx_sid` from `checkout.customAttributes`.
This is how cart sessions are joined to checkout sessions.
If the cart attribute write fails (e.g. first visit with no previous cart interaction),
the sessionId will be "unknown" or null — these checkouts cannot be joined.

### Dashboard → API routes → Supabase

All dashboard routes use Supabase JS client (HTTP/REST). No Prisma at runtime.

**Routes used by dashboard pages:**

| Route | Page | What it returns |
|-------|------|-----------------|
| GET /api/cart/all | Cart Activity | { kpis, sessions, couponStats } |
| GET /api/cart/session?shop=&sessionId= | Cart Activity modal | { timeline } |
| GET /api/alerts?shop=&tab= | Monitor/Alerts | Alert list (active or history) |
| PATCH /api/alerts/[id] | Monitor/Alerts | Resolve alert |
| GET /api/settings?shop= | Settings | Shop config fields |
| PATCH /api/settings | Settings | Update shop config |
| GET /api/metrics?shop= | Converted/Abandoned | Funnel, KPIs, live feed |

**Auth:** All routes validate shop domain from query params. No session token check
beyond Shopify's embedded app session (handled by @shopify/shopify-app-remix).

---

## DATA INVARIANTS

These must be true for every row. A violation is a bug, not an edge case.

1. Every CartEvent has a non-null `id` (UUID from crypto.randomUUID()).
2. Every CartEvent has a non-null `shopId` and `eventType`.
3. Every CheckoutEvent has a non-null `id` (UUID from crypto.randomUUID()).
4. Every CheckoutEvent has a non-null `shopId` and `eventType`.
5. No CartEvent or CheckoutEvent contains raw PII (email, phone, full name, IP address).
   PII is stripped in `lib/sanitize.ts` before DB write.
6. Ingest endpoints respond in < 200ms (DB writes happen async via waitUntil()).
7. Every ingest attempt (success or failure) produces an IngestLog row.
   **NOTE: IngestLog table must be created manually — run supabase/ingestlog-table.sql.**

---

## TECHNOLOGY RULES

1. **Ingest endpoints (write-heavy):** Supabase JS client only. Never Prisma.
2. **Dashboard reads:** Supabase JS client only. Prisma is dead at runtime.
3. **Schema changes:** `prisma migrate dev` with `DIRECT_URL` pointing to port 5432.
4. **IDs:** `crypto.randomUUID()` in every insert. DB does not generate IDs.
5. **Async writes (ingest):** Use `waitUntil()` from `@vercel/functions`. Never `void` promises.
6. **No persistent connections:** Everything is HTTP/REST. No TCP connection pools.
7. **New dependency test:** Must answer "Does it work on Vercel serverless?" before adding.
8. **Map/Set iteration:** Always use `Array.from()`. Never spread `[...map]` — TS target incompatibility.

---

## ENVIRONMENT VARIABLES

| Variable | Where | Purpose |
|----------|-------|---------|
| SUPABASE_URL | Vercel + local | Supabase project URL |
| SUPABASE_SERVICE_ROLE_KEY | Vercel + local | Service role key for all DB ops |
| DATABASE_URL | Local only | `prisma://` Accelerate URL — NOT used at runtime |
| DIRECT_URL | Local only | Direct postgres:// URL for `prisma migrate dev` |
| SHOPIFY_API_KEY | Vercel + local | App credentials |
| SHOPIFY_API_SECRET | Vercel + local | App credentials |
| CRON_SECRET | Vercel | Guards /api/jobs/* routes |

---

## PRISMA STATUS (as of 2026-03-13)

Prisma has been fully removed from the request path for all dashboard and ingest routes.

**Migrated to Supabase JS:**
- lib/metrics.ts ✓
- lib/cart-metrics.ts ✓
- app/api/cart/ingest ✓
- app/api/pixel/ingest ✓
- app/api/cart/all, session, sessions, kpis, coupons ✓
- app/api/alerts, alerts/[id] ✓
- app/api/settings ✓

**Still using Prisma (non-critical paths — migrate opportunistically):**
- app/api/auth/callback — OAuth install flow
- app/api/billing/callback — billing flow
- app/api/webhooks/app-uninstalled — shop uninstall webhook
- app/api/webhooks/shop/redact — GDPR webhook
- app/api/jobs/weekly-digest — background job
- app/api/jobs/test-alert — debug job
- app/api/debug/* — debug utilities

---

## STORE-SPECIFIC NOTES

### drwater.myshopify.com

- Uses Rebuy Smart Cart 2.0. Rebuy calls `/cart/update.js` multiple times per
  customer action (attribute syncing, price updates). This creates duplicate
  `cart_bulk_updated` events within 1-2 seconds. Deduplication needed at query
  layer with 2-second window.
- Automatic discount `HYDRATEFIRST` appears in every `/cart/update` response
  with `applicable: false`. Must be filtered — do NOT generate `cart_coupon_failed`
  events for automatic discounts. **Filter is in cart-monitor.js but needs verification.**
- Country detection uses `window.Shopify.country` — unreliable for customers
  using VPNs. True fix: inject Liquid `{{ localization.country.iso_code }}`.
  TODO: Step 13.

---

## ARCHITECTURE DECISIONS (append-only log)

### 2026-03-13: Ingest endpoints migrated from Prisma to Supabase JS
Prisma TCP connections are incompatible with Vercel serverless cold starts and
Supabase's free tier connection limit (~15 concurrent). Supabase JS uses HTTP/REST —
no connection pools, no TCP, works on every cold start. See CHANGELOG.md.

### 2026-03-13: Dashboard reads migrated from Prisma/Accelerate to Supabase JS
Prisma Accelerate was misconfigured with wrong DB host. Even after reconfiguration,
Accelerate's TCP tunnel cannot reach Supabase's postgres on port 5432 from external
hosts. Supabase JS HTTP client has no such restriction. All 8 dashboard-serving
API routes migrated in same session.



toml:
name = "checkoutmaxx"
client_id = "0a60bbe935cef2f46838acec2b3918d8"
application_url = "https://checkoutmaxx-rt55.vercel.app"
embedded = true

[access_scopes]
scopes = "read_orders,read_checkouts,write_pixels,read_customer_events,read_analytics"

[auth]
redirect_urls = [
  "https://checkoutmaxx-rt55.vercel.app/api/auth/callback"
]

[webhooks]
api_version = "2025-04"

[webhooks.privacy_compliance]
customer_data_request_url = "https://checkoutmaxx-rt55.vercel.app/api/webhooks/customers/data-request"
customer_deletion_url = "https://checkoutmaxx-rt55.vercel.app/api/webhooks/customers/redact"
shop_deletion_url = "https://checkoutmaxx-rt55.vercel.app/api/webhooks/shop/redact"

[pos]
embedded = false

[[extensions]]
type = "theme"
handle = "cart-monitor"