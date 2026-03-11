# CheckoutMaxx — App Store Submission Sprint
> Paste this entire prompt into Claude Code from the repo root.

---

## READ THIS FIRST — CURRENT STATE

Everything below is already built and working. DO NOT touch any of it:

```
app/api/pixel/ingest/              ← receives pixel events via sendBeacon
app/api/jobs/evaluate-alerts/      ← cron, alert engine
app/api/jobs/compute-baselines/    ← cron, daily baseline
app/api/webhooks/                  ← GDPR + app-uninstalled, HMAC verified
app/(embedded)/dashboard/          ← main funnel dashboard, SWR polling
app/(embedded)/alerts/             ← active alerts + history, resolve button
app/(embedded)/settings/           ← email, Slack, threshold sliders
app/privacy/                       ← privacy policy page
lib/alert-engine.ts                ← CVR drop, payment drop-off, discount spike
lib/metrics.ts                     ← funnel + KPI queries
lib/notifications/                 ← Resend email + Slack webhook
pixel/checkout-monitor.js          ← Web Pixel (sendBeacon only)
prisma/schema.prisma               ← Shop, CheckoutEvent, AlertLog, Baseline
app/preview/                       ← standalone demo with 4-page nav + sample data
```

You are completing 6 tasks to reach App Store submission readiness.
Build them in order. Do not skip ahead.

---

## TASK 1 — MIGRATE PREVIEW NAV INTO THE MAIN EMBEDDED APP

The app currently has a local preview at `app/preview/` that was built with
Polaris and shows a 4-page nav structure (Converted Carts, Abandoned Carts,
Notifications, Settings) with rich page layouts including: funnel narrowing
blocks, promotion health with expandable rows, shipping intelligence, impact
card, and notification KPI header. This nav and layout is better than what
is currently in `app/(embedded)/`.

The task is to replace the embedded app's navigation and page structure with
the preview's structure, while keeping all existing real data fetching intact.

### Step 1 — Read everything first

Read these files fully before touching anything:
- `app/(embedded)/layout.tsx`
- `app/(embedded)/dashboard/page.tsx`
- `app/(embedded)/alerts/page.tsx`
- `app/(embedded)/settings/page.tsx`
- `app/preview/page.tsx` and all components under `app/preview/`

Understand both nav structures before writing a single line.

### Step 2 — Replace the embedded nav

Current nav: Dashboard | Alerts | Settings (3 items)

Replace with 4 items matching the preview exactly:
- **Converted Carts** → `/dashboard/converted`
- **Abandoned Carts** → `/dashboard/abandoned`
- **Notifications** → `/alerts` (existing route, just relabelled)
- **Settings** → `/settings`

Keep:
- Polaris `Badge tone="critical"` on Notifications showing unresolved alert count
  (fetch from existing AlertLog query, count where resolvedAt IS NULL)
- The pulsing green pixel-active dot at the bottom of the nav
  (the `.pulse-dot` CSS animation from the preview — copy it exactly)

### Step 3 — Create two new dashboard pages

**`app/(embedded)/dashboard/converted/page.tsx`**

Wire all data from `lib/metrics.ts`. If a query doesn't exist yet, add it
to metrics.ts — do not hardcode values.

Layout (top to bottom):
1. `InlineGrid columns={3} gap="400"` — 3 KPI cards:
   Checkouts Started | Completed Orders | Checkout CVR
   Each card: label + big number + Polaris Badge delta + 40px Recharts AreaChart
   sparkline (no axes, no tooltip)

2. `InlineGrid columns={2} gap="400"` — 2 KPI cards:
   Avg Order Value | Avg Time to Complete — same format with sparklines

3. Full-width Polaris Card "CVR Over Time":
   Recharts LineChart, 200px height
   - Line 1: CVR — solid #4F7FFF, strokeWidth 2
   - Line 2: baseline — dashed #8c9196, strokeWidth 1
   - Custom dot: red circle (fill #d72c0d, r=4) on days where an AlertLog
     of type 'abandonment_spike' fired — join by date
   - ReferenceLine at baseline value with label
   - Subdued axes (axisLine={false}), tooltip with date + CVR% + baseline%
   - Below chart: Text tone="subdued" "● Red dots = days an abandonment alert fired"

4. `InlineGrid columns={2} gap="400"`:
   Left Card "Top Converting Products" — DataTable: Product | Orders | Revenue
   Right Card "Completions by Device" — DataTable: Device | Orders | CVR

5. Full-width Card "Completions by Country":
   DataTable: Country | Completed | CVR | Avg Order Value

---

**`app/(embedded)/dashboard/abandoned/page.tsx`**

Wire all data from `lib/metrics.ts`. Extend metrics.ts for any missing queries.

Layout (top to bottom):
1. `InlineGrid columns={4} gap="400"` — 4 KPI cards (no sparklines):
   Abandoned Sessions | Abandonment Rate | Avg Abandoned Cart Value |
   Total Abandoned Cart Value — all with delta badges

2. Full-width Card "Checkout Funnel":
   Use the narrowing-block visual from the preview — NOT a chart library.
   Each step is a Polaris `Box` with background color whose width is
   `(sessions / maxSessions * 100)%` of the container:
   - Normal steps: `background="bg-surface-brand-selected"` (blue tint)
   - highDrop step: `background="bg-surface-critical-selected"` (red tint)
   - Last step (completed): `background="bg-surface-success-selected"` (green)
   Inside each bar: `InlineStack align="space-between"` — step name + optional
   `<Badge tone="critical">High drop-off</Badge>` on left, session count on right.
   Between steps: a Badge pill showing: `−{dropped} dropped · {dropPct}% · ~${lostRevenue} lost`
   Badge tone: "critical" if highDrop, "attention" otherwise.
   Summary row below all steps: total abandoned sessions + total est. lost revenue.

3. Full-width Card "Abandonment by Step Over Time":
   Recharts LineChart, 180px height.
   3 lines: contact (blue) | shipping (#f59e0b) | payment (#d72c0d).
   Legend. Y axis as %. Same subdued axis style.

4. `InlineGrid columns={2} gap="400"`:
   Left Card "Products in Abandoned Carts":
   DataTable: Product | Abandoned Carts | Est. Lost Revenue
   Right Card "Abandonment by Device":
   DataTable: Device | Abandoned | Rate | Worst Step

5. Full-width Card "Promotion Health":
   Polaris `IndexTable` with `condensed`. Columns:
   Code | Attempts | Converted | Failed | Fail% | Est. Lost | Status
   Status Badge: tone="success" Healthy / tone="warning" High failure /
   tone="critical" Critical — based on failPct (<10 / 10–40 / >40).
   Fail% cell: Text tone="critical" if >40%, tone="caution" if >10–40%.
   Row expansion via Polaris `Collapsible` (chevron button on each row):
   Shows: failure reason | avg cart value failed vs converted | abandon step |
   Polaris Button variant="plain" "Edit in Shopify →" (deep link to discount admin).
   Track expanded row ID in useState.

6. Full-width Card "Shipping Intelligence":
   `InlineGrid columns="2fr 1fr" gap="600"`:
   Left: DataTable "Abandonment by Shipping Method"
   Columns: Method | Selected | Abandoned | Rate
   Rate badge: tone="critical" >30%, tone="warning" >15%, tone="success" else.
   Right: 3 stacked stat boxes (Polaris Box with border):
   - Avg Time on Shipping Step
   - Shipping Step Abandon Rate
   - Addresses with No Shipping Rates (Box with borderColor="border-caution")
   If addresses-with-no-rates count > 0: show Banner tone="warning" below
   listing recent date/city/country.

7. `InlineGrid columns={2} gap="400"`:
   Left Card "Abandonment by Country" — DataTable
   Right Card "Abandonment by State (US)" — DataTable
   Note: subdued text "US traffic only" below right card

### Step 4 — Update Notifications page

Keep all existing functionality (Active tab, History tab, resolve button,
alert logic). Add these 4 things from the preview:

1. KPI row at top — `InlineGrid columns={4}`:
   Total Alerts Sent | Alerts Resolved | Avg Resolution Time |
   Est. Revenue Protected
   Lifetime numbers, no sparklines. Est. Revenue Protected: Text tone="success".

2. Filter pills between KPI row and table:
   Polaris ButtonGroup: All | Discount | Abandonment | Extension | Payment
   Store active filter in useState. Wire to filter IndexTable rows by alertType.

3. Update IndexTable columns to:
   When | Type | Detail | Sent Via | Status | Est. ROI
   Sent Via: InlineStack of Badges per channel:
   - Email → Badge tone="info"
   - Slack → Badge tone="attention"
   Status:
   - resolved → Badge tone="success" "✓ Resolved"
   - unresolved → Badge tone="warning" "Unresolved" + Button variant="plain"
     size="slim" "Resolve" inline
   Est. ROI: Text tone="success" "~$X,XXX" or "—"

4. Row expansion via Polaris Collapsible:
   Click row → expands inline showing full alert message text +
   Button variant="plain" "View in Shopify admin →" +
   resolvedAt timestamp in subdued text if resolved.

### Step 5 — Update Settings page

Keep all existing form logic. Add the Impact card at the bottom of the page,
after all existing sections.

Polaris Box with background="bg-surface-brand" padding="600" borderRadius="300":
- Text variant="headingLg": "CheckoutMaxx has been protecting your store
  for [N] days" — N computed as Math.floor((Date.now() - shop.installedAt) / 86400000)
- InlineGrid columns={4} gap="400" paddingBlockStart="400" — 4 lifetime metrics:
  Each metric: Text variant="bodySm" tone="subdued" label (all caps) +
               Text variant="heading2xl" value
  Metrics:
  - "CHECKOUTS MONITORED" / count all checkout_started events for this shop
  - "ISSUES CAUGHT" / total AlertLog count for this shop
  - "ALERTS RESOLVED" / count AlertLog where resolvedAt IS NOT NULL
  - "REVENUE PROTECTED" / "$[sum roiEstimatedUsd, formatted with commas]"
- Divider
- Text tone="subdued" variant="bodySm":
  "Revenue figures are estimates based on checkout CVR recovery after
  each resolved alert. Actual impact may vary."
- If roiEstimatedUsd sum > 0 AND sum > 49:
  Text variant="bodyMd" paddingBlockStart="200":
  "[N]× your monthly plan cost in estimated recovered revenue"
  where N = (sum / 49).toFixed(1)

### Step 6 — Clean up

Once migration is complete and all 4 nav pages work in the embedded app:
- Remove `app/preview/` from `.gitignore` — commit both the preview and the
  migrated app together
- The preview at `/preview` remains as a standalone demo — do NOT delete it
- Redirect `/dashboard` (old route) → `/dashboard/converted` so old links
  don't 404

### Hard rules for Task 1
- All real data via existing SWR patterns and lib/metrics.ts
- Extend metrics.ts for missing queries — do not create separate API routes
  or hardcode values
- Polaris only. No Tailwind. No shadcn. Recharts for charts only.
- Funnel uses plain divs + inline width styles — NOT a chart library
- Do not break any existing API routes or lib functions

---

## TASK 2 — POST-INSTALL WELCOME SCREEN

File: `app/(embedded)/welcome/page.tsx`

Find where the OAuth callback redirects after install completes and change
the redirect destination from `/dashboard` to `/welcome`.

The welcome screen:

Page title: "CheckoutMaxx is now protecting your store"

Layout (top to bottom):
1. Banner tone="success":
   "Your checkout pixel is active. We're already monitoring for issues."

2. InlineGrid columns={3} gap="400" — three Cards:
   Card 1 title "Abandonment spikes":
     "We alert you when your checkout CVR drops 20%+ below your 7-day baseline
     — so you know before your customers start tweeting."
   Card 2 title "Broken discount codes":
     "When a promo code fails 3+ times in an hour, you get an alert with the
     exact code and how many customers it hit."
   Card 3 title "Payment failures":
     "If payment failures spike above 15%, we flag it immediately with the
     affected gateway."

3. Banner tone="info":
   "Learning period: Alerts activate in ~48 hours, once we've learned your
   store's normal checkout patterns. You'll see live data right away."

4. InlineStack gap="300":
   Button variant="primary" → /dashboard/converted : "View your dashboard"
   Button variant="plain"   → /settings            : "Configure alerts"

Do NOT add /welcome to the navigation.

---

## TASK 3 — WEEKLY DIGEST CRON

File: `app/api/jobs/weekly-digest/route.ts`

Protect with CRON_SECRET header (same pattern as evaluate-alerts).

For each active shop with alertEmailEnabled=true and alertEmail set,
send one Resend email.

Subject: `CheckoutMaxx Weekly — [shopDomain]`

Body (plain text):
```
CheckoutMaxx Weekly Summary
Week of [Monday date] – [Sunday date]

Checkouts monitored this week: [count checkout_started, last 7 days]
Orders completed: [count checkout_completed, last 7 days]
Checkout CVR: [completed/started as %]
vs. prior week: [delta in percentage points, e.g. "+2.1pts" or "-0.8pts"]

Alerts fired this week: [count AlertLog where firedAt >= 7 days ago]
Alerts resolved: [count where resolvedAt is not null in same window]

Top drop-off step: [step with highest dropPct from getFunnelMetrics]

────────────────────────────────────────────
View your dashboard: [NEXT_PUBLIC_APP_URL]/dashboard/converted

────────────────────────────────────────────
To stop these emails, go to Settings in the app and disable weekly digest.
CheckoutMaxx — Checkout monitoring for Shopify stores.
```

Add to vercel.json crons array:
```json
{ "path": "/api/jobs/weekly-digest", "schedule": "0 9 * * 1" }
```

---

## TASK 4 — RATE LIMITING ON INGEST

File: `app/api/pixel/ingest/route.ts`

Add in-memory rate limiting per shopDomain at the very top of the POST
handler, before any DB interaction:

```typescript
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 500;
const WINDOW_MS  = 60_000;

const key = shopDomain || req.headers.get('x-forwarded-for') || 'unknown';
const now = Date.now();
const entry = rateLimitMap.get(key);
if (entry && now < entry.resetAt) {
  if (entry.count >= RATE_LIMIT) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  entry.count++;
} else {
  rateLimitMap.set(key, { count: 1, resetAt: now + WINDOW_MS });
}
```

Return 429 silently. Do not log. Do not change anything else in this route.

---

## TASK 5 — SHOPIFY BILLING (REQUIRED FOR APP STORE)

### 5a — Prisma migration

Add to Shop model in prisma/schema.prisma:
```prisma
subscriptionId     String?
subscriptionStatus String?
trialEndsAt        DateTime?
billingPlan        String    @default("free")
```
Run: `npx prisma migrate dev --name add_billing_fields`

### 5b — lib/billing.ts (new file)

```typescript
export const PRO_PLAN = {
  name:         'Pro',
  price:        49,
  currencyCode: 'USD',
  interval:     'EVERY_30_DAYS',
  trialDays:    7,
} as const;

export async function createSubscription(
  shop: string,
  accessToken: string,
  returnUrl: string
): Promise<string> {
  // GraphQL mutation: appSubscriptionCreate
  // Use same @shopify/shopify-api client pattern as lib/pixel-registration.ts
  // CRITICAL: test: process.env.NODE_ENV !== 'production'
  // lineItems: [{ plan: { appRecurringPricingDetails: {
  //   price: { amount: 49, currencyCode: 'USD' },
  //   interval: 'EVERY_30_DAYS'
  // }}}]
  // Returns: confirmationUrl string
}

export async function getActiveSubscription(
  shop: string,
  accessToken: string
): Promise<{ id: string; status: string } | null> {
  // Query: currentAppInstallation { activeSubscriptions { id status } }
  // Returns first result or null
}
```

**CRITICAL:** `test:` MUST be `process.env.NODE_ENV !== 'production'`.
Never hardcode `test: true` — Shopify will reject the submission if
test charges run in production.

### 5c — app/api/billing/create/route.ts (new file)

GET handler. Requires active Shopify session.
1. Get shop + accessToken from session
2. returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/billing/callback`
3. Call createSubscription → get confirmationUrl
4. Redirect to confirmationUrl

### 5d — app/api/billing/callback/route.ts (new file)

GET handler. Shopify redirects here after merchant approves or declines.
1. Get shop session
2. Call getActiveSubscription
3. If ACTIVE:
   Update shop: subscriptionStatus="ACTIVE", billingPlan="pro",
   trialEndsAt = now + 7 days
   Redirect to /dashboard/converted
4. If not active:
   Update shop: subscriptionStatus="DECLINED", billingPlan="free"
   Redirect to /dashboard/converted?billing=declined

### 5e — Billing gate in app/(embedded)/layout.tsx

After session verification:
```typescript
const shop = await prisma.shop.findUnique({ where: { shopDomain } });
const trialExpired = shop?.trialEndsAt && shop.trialEndsAt < new Date();
const needsBilling = shop?.billingPlan !== 'pro' && trialExpired;
if (needsBilling) redirect('/api/billing/create');
```

If subscriptionStatus === 'FROZEN': do NOT block. Show a
Banner tone="warning" at layout level:
"Your subscription is paused. Update your billing to restore full monitoring."
with Button → /api/billing/create "Update billing".

NEVER gate /api/pixel/ingest on billing status.

---

## TASK 6 — PRE-SUBMISSION VERIFICATION

### 6a — Clean build
```bash
npm run build
```
Fix ALL TypeScript errors. No @ts-ignore suppressions. Build must pass clean.

### 6b — App deploy
```bash
npx @shopify/cli@latest app deploy
```
Pushes GDPR webhook URLs from shopify.app.toml to Shopify.
Run after build passes.

### 6c — Verify GDPR block in shopify.app.toml
```toml
[webhooks.privacy_compliance]
customer_data_request_url = "https://[VERCEL_URL]/api/webhooks/customers/data_request"
customer_deletion_url     = "https://[VERCEL_URL]/api/webhooks/customers/redact"
shop_deletion_url         = "https://[VERCEL_URL]/api/webhooks/shop/redact"
```

### 6d — Route spot check (all must return non-500)
```
GET  /dashboard/converted        → loads
GET  /dashboard/abandoned        → loads
GET  /alerts                     → loads
GET  /settings                   → loads
GET  /welcome                    → loads
GET  /preview                    → loads (no auth needed)
GET  /privacy                    → loads (no auth needed)
GET  /api/billing/create         → redirects to Shopify confirmationUrl
POST /api/pixel/ingest           → 200 { ok: true }
GET  /api/jobs/evaluate-alerts   → 200 with CRON_SECRET header
GET  /api/jobs/compute-baselines → 200 with CRON_SECRET header
GET  /api/jobs/weekly-digest     → 200 with CRON_SECRET header
```

---

## ABSOLUTE HARD RULES

1. Do NOT touch lib/alert-engine.ts
2. Do NOT touch existing GDPR webhook handlers
3. Do NOT touch /api/pixel/ingest beyond the rate limit block
4. Billing test: MUST be `process.env.NODE_ENV !== 'production'` — never hardcoded
5. Polaris only — no Tailwind, no shadcn, no custom CSS
6. Recharts for charts only — funnel uses plain divs
7. npm run build must pass with zero new TypeScript errors
8. NEVER block /api/pixel/ingest based on billing status
