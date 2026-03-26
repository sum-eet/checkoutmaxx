# CheckoutMaxx — V2 Dashboard Build Prompt
> Paste this entire file into Claude Code from the repo root.
> Read SPEC.md and CHANGELOG.md first. Then read this entire file before writing a single line.
> This is the complete build spec for /dashboard/v2/* and /api/v2/*.
> Every decision is pre-made. Do not infer, assume, or improvise.

---

## STEP 0 — READ FIRST, BUILD SECOND

Before touching any file:

1. Run `cat SPEC.md` — understand the existing architecture
2. Run `cat CHANGELOG.md` — understand what has been built and why
3. Run `ls app/dashboard/` — see existing page structure
4. Run `ls app/api/` — see existing API structure
5. Run `npx tsc --noEmit` — confirm build is clean before you start

Do not write a single file until you have done all five of these.

---

## ABSOLUTE GUARDRAILS

### Never touch these files or directories

```
pixel/checkout-monitor.js
extensions/cart-monitor/
app/api/pixel/ingest/
app/api/cart/ingest/
app/api/session/ping/
app/api/health/
lib/supabase.ts
lib/ingest-log.ts
prisma/schema.prisma
app/api/webhooks/
app/api/auth/
app/api/billing/
app/api/jobs/
app/(embedded)/dashboard/converted/
app/(embedded)/dashboard/abandoned/
app/(embedded)/dashboard/cart/
app/(embedded)/dashboard/notifications/
app/(embedded)/dashboard/settings/
app/api/cart/
app/api/metrics/
app/api/alerts/
```

These are live and working. Any modification to them breaks the production app.

### What you are building — new files only

```
app/(embedded)/dashboard/v2/layout.tsx          NEW — v2 nav layout
app/(embedded)/dashboard/v2/overview/page.tsx   NEW
app/(embedded)/dashboard/v2/cart/page.tsx       NEW
app/(embedded)/dashboard/v2/performance/page.tsx NEW
app/(embedded)/dashboard/v2/discounts/page.tsx  NEW
app/(embedded)/dashboard/v2/notifications/page.tsx NEW

app/api/v2/overview/route.ts                    NEW
app/api/v2/cart/sessions/route.ts               NEW
app/api/v2/cart/session/route.ts                NEW
app/api/v2/performance/route.ts                 NEW
app/api/v2/discounts/route.ts                   NEW
app/api/v2/discounts/[code]/route.ts            NEW
app/api/v2/notifications/route.ts               NEW
app/api/v2/notifications/[id]/read/route.ts     NEW

supabase/alertlog-isread.sql                    NEW — run manually, see Step 1
```

### Technology rules

```
All DB reads:   Supabase JS client only (lib/supabase.ts)
                import { supabase } from '@/lib/supabase'
                Never Prisma for queries in v2

All DB writes:  Only one write in v2 — marking alerts read
                Uses Supabase JS client

Monetary values in DB:
  CartEvent.cartValue:        CENTS — divide by 100 for display
  CartEvent.discountAmount:   CENTS — divide by 100 for display
  CheckoutEvent.totalPrice:   DOLLARS — display as-is

Table names (case-sensitive, always quoted in raw SQL):
  "CartEvent", "CheckoutEvent", "Shop", "AlertLog",
  "SessionPing", "IngestLog"

Field names (check actual schema before writing any query):
  CartEvent:     sessionId, shopId, eventType, cartValue, cartItemCount,
                 lineItems, couponCode, couponSuccess, couponRecovered,
                 discountAmount, cartToken, pageUrl, device, country, occurredAt
  CheckoutEvent: sessionId, shopId, eventType, totalPrice, discountCode,
                 deviceType, country, errorMessage, rawPayload, occurredAt
  AlertLog:      id, shopId, alertType, message, occurredAt (check for isRead — see Step 1)
  Shop:          id, shopDomain, isActive

Run this before writing any query:
  Read the actual Prisma schema to confirm every field name.
  Do not guess field names.

TypeScript:
  npx tsc --noEmit must pass clean after every file you write
  npm run build must pass clean before final commit
  Fix all type errors before moving to the next step
```

---

## STEP 1 — ALERTLOG isRead FIELD (do this before building notifications)

### First: check if isRead already exists

Run this query in Supabase SQL editor (or via a test script):

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'AlertLog'
ORDER BY ordinal_position;
```

### Case A — isRead column exists and is boolean

No action needed. Skip to Step 2.

### Case B — isRead column does not exist

Create file `supabase/alertlog-isread.sql`:

```sql
ALTER TABLE "AlertLog"
ADD COLUMN IF NOT EXISTS "isRead" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "AlertLog_shopId_isRead_idx"
ON "AlertLog" ("shopId", "isRead");
```

Print this message to the developer:
```
ACTION REQUIRED before testing notifications:
Run supabase/alertlog-isread.sql in Supabase SQL editor.
The notifications page will not work without this column.
```

Do NOT run the migration yourself. The developer runs it manually.
Do NOT modify prisma/schema.prisma. This column is managed outside Prisma.

### Case C — AlertLog table does not exist at all

This means the app is in an earlier state than expected.
Print this message and stop:
```
AlertLog table not found. Cannot build notifications page.
The existing alert system must be working before v2 notifications can be built.
Check CHANGELOG.md for the state of the alert engine.
```

### Case D — isRead exists but is nullable (no DEFAULT)

Run this in supabase/alertlog-isread.sql:
```sql
UPDATE "AlertLog" SET "isRead" = false WHERE "isRead" IS NULL;
ALTER TABLE "AlertLog" ALTER COLUMN "isRead" SET DEFAULT false;
ALTER TABLE "AlertLog" ALTER COLUMN "isRead" SET NOT NULL;
```

### Handling isRead in API regardless of migration timing

The `GET /api/v2/notifications` endpoint must handle the case where
isRead does not yet exist on the row (returns null from Supabase).
Treat null as false. Never crash on a missing isRead field.

```typescript
// Safe read pattern
const isRead = alert.isRead ?? false
```

The `POST /api/v2/notifications/[id]/read` endpoint must handle:
- Alert ID not found → return 404, do not throw
- isRead column does not exist → return 503 with message
  "Notifications read state not available. Run alertlog-isread.sql first."
- AlertLog row belongs to different shop → return 403
- Supabase error on update → return 500, log to console, do not crash

---

## STEP 2 — SHOP AUTHENTICATION PATTERN

Every /api/v2/* route needs to identify the shop.

Read the existing /api/cart/all/route.ts or /api/v2 equivalent to find
the exact auth pattern used. Match it exactly. Do not invent a new pattern.

The shop lookup will be something like:
```typescript
// Find the shop from the session/auth token
// Use the exact same pattern as existing dashboard API routes
const shop = await supabase
  .from('Shop')
  .select('id, shopDomain')
  .eq('shopDomain', shopDomain)
  .eq('isActive', true)
  .single()

if (!shop.data) {
  return NextResponse.json({ error: 'Shop not found' }, { status: 404 })
}
const shopId = shop.data.id
```

All subsequent queries use shopId, never shopDomain directly.

---

## STEP 3 — DATE RANGE HANDLING

Every API route receives start and end as ISO timestamp strings.

```typescript
const start = new Date(searchParams.get('start') ?? subDays(new Date(), 7))
const end = new Date(searchParams.get('end') ?? new Date())
```

All Supabase queries filter with:
```typescript
.gte('occurredAt', start.toISOString())
.lte('occurredAt', end.toISOString())
```

Comparison period (for delta calculations):
```typescript
const duration = end.getTime() - start.getTime()
const prevEnd = new Date(start.getTime())
const prevStart = new Date(start.getTime() - duration)
```

Sparkline granularity (passed from API to frontend):
```
range <= 1 day:   hourly points
range <= 60 days: daily points
range > 60 days:  weekly points
```

---

## STEP 4 — BUILD API ROUTES FIRST

Build every /api/v2/* route before building any page.
Test each with a curl command after building it.
Confirm the response shape matches what the page will need.

### /api/v2/overview

```typescript
// Response shape:
{
  kpis: {
    cartSessions: {
      value: number,
      previous: number,
      delta: number,        // percentage change
      sparkline: { label: string, value: number }[]
    },
    checkoutRate: {
      value: number,        // percentage 0-100
      previous: number,
      delta: number,        // percentage points
      numerator: number,    // sessions that reached checkout
      denominator: number,  // product sessions
      sparkline: { label: string, value: number }[]
    },
    cvr: {
      value: number,        // percentage 0-100
      previous: number,
      delta: number,        // percentage points
      numerator: number,    // completed orders
      denominator: number,  // checkout starts
      sparkline: { label: string, value: number }[]
    },
    aov: {
      value: number,        // dollars
      previous: number,
      delta: number,        // dollar change
      orderCount: number,
      sparkline: { label: string, value: number }[]
    }
  },
  funnel: {
    current: FunnelStep[],
    previous: FunnelStep[]
  },
  recentAlerts: Alert[]     // last 3, any severity
}

type FunnelStep = {
  step: string,
  sessions: number,
  pct: number,              // % of checkout_started
  dropped: number,          // sessions lost vs previous step
  dropRate: number,         // dropped / checkout_started * 100
  dropRateDelta: number     // vs previous period, percentage points
}
```

### /api/v2/cart/sessions

```typescript
// Query params: start, end, shop, outcome, country, device,
//               minCart, maxCart, hasCoupon, product, page
// Response shape:
{
  sessions: CartSession[],
  total: number,            // total matching filter (for pagination)
  page: number,
  perPage: 25,
  scopedCounts: {
    total: number,
    checkoutRate: number,   // % of these sessions that reached checkout
    completionRate: number  // % of these sessions that completed order
  }
}

type CartSession = {
  sessionId: string,
  startTime: string,        // ISO
  duration: number,         // milliseconds
  country: string | null,
  device: string | null,
  products: LineItem[],
  cartValueStart: number | null,   // dollars (divide cents by 100)
  cartValueEnd: number | null,     // dollars
  coupons: CouponSummary[],
  outcome: 'ordered' | 'checkout' | 'abandoned',
  summary: string           // one-line template string (see Page 2 spec)
}

type CouponSummary = {
  code: string,
  status: 'applied' | 'failed' | 'recovered'
}
```

### /api/v2/cart/session (single session timeline)

```typescript
// Query params: shop, sessionId
// Response shape:
{
  session: CartSession,     // same as above
  timeline: TimelineEvent[]
}

type TimelineEvent = {
  source: 'cart' | 'checkout',
  eventType: string,
  occurredAt: string,       // ISO
  label: string,            // human label from label map
  detail: string | null,
  sentiment: 'positive' | 'negative' | 'neutral'
}
```

### /api/v2/performance

```typescript
// Response shape:
{
  basedOnSessions: number,
  comparison: {
    converted: ComparisonMetrics,
    abandoned: ComparisonMetrics,
    convertedCount: number,
    abandonedCount: number
  },
  conversionBands: ConversionBand[],
  revenuePerCoupon: RevenuePerCouponRow[]
}

type ComparisonMetrics = {
  avgCartValue: number | null,      // dollars
  avgItemCount: number | null,
  couponUsagePct: number | null,    // 0-100
  medianDurationMs: number | null,
  singleProductPct: number | null,  // 0-100
  multiProductPct: number | null,
  mostCommonProduct: string | null,
  mostCommonCombination: string | null
}

type ConversionBand = {
  label: string,            // "$100–125"
  minCents: number,
  maxCents: number,
  sessions: number,         // sessions in this band that attempted checkout
  conversions: number,      // sessions that completed
  conversionRate: number,   // 0-100
  isAovBand: boolean        // true if current AOV falls in this band
}

type RevenuePerCouponRow = {
  code: string | null,      // null = "No coupon" baseline row
  sessions: number,
  convRate: number,         // 0-100
  avgCartDollars: number,
  avgDiscountDollars: number,
  revPerSession: number,
  vsBaseline: number,       // dollar delta vs no-coupon baseline
  isLowData: boolean        // true if sessions < 10
}
```

### /api/v2/discounts

```typescript
// Response shape:
{
  summary: {
    active: number,
    healthy: number,
    needsAttention: number
  },
  codes: DiscountCode[]
}

type DiscountCode = {
  code: string,
  status: 'healthy' | 'degraded' | 'broken',
  attempts: number,
  successRate: number,      // 0-100
  avgCartDollars: number | null,
  recoveries: number,
  revPerSession: number | null,
  lastSeen: string,         // ISO
  isLowData: boolean        // true if attempts < 10
}
```

### /api/v2/discounts/[code]

```typescript
// Query params: shop, start, end
// Response shape:
{
  code: string,
  status: 'healthy' | 'degraded' | 'broken',
  attempts: number,
  trend: TrendPoint[],      // daily attempts + successes for chart
  summary: {
    successRate: number,
    successRatePrev: number,
    avgCartDollars: number,
    storeAvgCartDollars: number,
    revPerSession: number,
    baselineRevPerSession: number,
    totalDiscountGiven: number,
    totalDiscountOrders: number
  },
  recovery: RecoveryDetail | null,   // null if recoveries = 0
  recentSessions: RecentSession[]    // last 10
}

type TrendPoint = {
  date: string,             // "Mar 14"
  attempts: number,
  successes: number
}

type RecoveryDetail = {
  count: number,
  avgCartBeforeDollars: number,
  avgCartAfterDollars: number,
  avgCartIncreaseDollars: number,
  avgItemsAdded: number
}

type RecentSession = {
  sessionId: string,
  occurredAt: string,
  cartValueDollars: number | null,
  outcome: 'ordered' | 'checkout' | 'abandoned',
  couponStatus: 'applied' | 'failed' | 'recovered'
}
```

### /api/v2/notifications

```typescript
// Query params: shop, start, end, severity (all|critical|warning|info|dismissed)
// Response shape:
{
  summary: {
    unread: number,
    critical: number,
    warnings: number
  },
  alerts: NotificationAlert[]
}

type NotificationAlert = {
  id: string,
  severity: 'critical' | 'warning' | 'info',
  title: string,
  body: string,
  occurredAt: string,       // ISO
  isRead: boolean,          // default false if column missing
  isDismissed: boolean,
  linkType: 'overview' | 'discounts' | 'cart' | null,
  linkCode: string | null   // coupon code if linkType = 'discounts'
}
```

### /api/v2/notifications/[id]/read

```typescript
// Method: POST
// Body: { shop: string }
// Response: { ok: true } or error

// Edge cases (all must be handled):
// 1. Alert ID not found in DB → 404
// 2. Alert belongs to different shop → 403
// 3. isRead column does not exist → 503 with message
// 4. Alert already isRead = true → 200 ok (idempotent, not an error)
// 5. Supabase error → 500, log to console
// 6. Missing shop in body → 400
```

---

## STEP 5 — V2 LAYOUT

Create `app/(embedded)/dashboard/v2/layout.tsx`.

This is a new layout component. It must not affect the existing
`app/(embedded)/dashboard/layout.tsx` in any way.

Nav items:
```
Overview          href="/dashboard/v2/overview"
Cart Sessions     href="/dashboard/v2/cart"
Cart Performance  href="/dashboard/v2/performance"
Discounts         href="/dashboard/v2/discounts"
Notifications     href="/dashboard/v2/notifications"
```

Settings link at bottom: href="/settings" (existing settings page, no v2 version)

Active state: highlight current route.

"V2 Preview" badge somewhere subtle in the layout header — small grey badge —
so merchant knows this is the preview version. Does not need to be prominent.

---

## STEP 6 — BUILD PAGES

Build in this exact order. Do not skip ahead.

### Page order:
1. Overview
2. Cart Sessions (table only, no modal yet)
3. Cart Sessions (add timeline modal)
4. Cart Performance
5. Discounts (table only, no detail panel yet)
6. Discounts (add code detail panel)
7. Notifications

### Components to use (Polaris):
```
Page, Layout, Card, DataTable, Badge, Tabs
Text, InlineStack, BlockStack, Box
Modal (for timeline — use Sheet if available, otherwise Modal)
Button, TextField, Select, Filters
Spinner, SkeletonBodyText, SkeletonDisplayText
EmptyState (for all empty states — see spec)
Banner (for error states)
LineChart, BarChart — use Polaris Charts if available,
  otherwise recharts (already in dependencies)
```

### Chart library decision:
Check if @shopify/polaris-viz is in package.json.
If yes: use it for all charts — it matches Polaris aesthetics.
If no: use recharts which is already installed.
Do not install new chart libraries.

### Data fetching pattern:
Use SWR for all data fetching. Match the exact SWR pattern used in
existing dashboard pages. Read an existing page before writing fetch logic.

Always destructure error from SWR:
```typescript
const { data, error, isLoading, mutate } = useSWR(key, fetcher)
```

Never leave error unhandled — show a Banner with error message if error exists.
Never leave an undefined data state showing a blank page — show skeleton or empty state.

---

## STEP 7 — EMPTY STATES

Every chart and table must have an empty state. No exceptions.

Use the exact empty state copy from the spec:

```
No sessions in range:
  Title: "No sessions in this period"
  Body:  "Cart sessions will appear here once customers visit the store."

No checkout events:
  Title: "No checkout data in this period"
  Body:  "Checkout events appear once customers reach the Shopify checkout."

Fewer than 10 data points:
  Title: "Not enough data yet"
  Body:  "Based on [X] sessions. Select a wider date range for more data."
  (always show X so merchant knows how close they are)

No coupon activity:
  Title: "No discount codes used in this period"
  Body:  "Coupon attempts will appear here once customers try discount codes."

No alerts:
  Title: "No alerts in this period"
  Body:  "Alerts fire when conversion drops, coupons fail, or anomalies are detected."
```

Use Polaris `<EmptyState>` component for all of these.
No custom empty state components — use the system one.

---

## STEP 8 — GLOBAL DATE FILTER

Single component `DateRangeFilter` used on every page.

```typescript
// Props:
{
  value: { start: Date, end: Date },
  onChange: (range: { start: Date, end: Date }) => void
}

// Presets:
Today, Yesterday, Last 7 days, Last 30 days, Last 90 days, Custom

// Default: Last 7 days

// Custom: date range picker
// No minimum range. No maximum range.
// Both start and end selectable.

// Persists in URL query params: ?start=ISO&end=ISO
// So merchant can bookmark or share a specific range.

// When range changes:
// - All SWR keys update (new start/end params)
// - All data refetches automatically
// - No manual refresh needed on range change
```

---

## STEP 9 — SESSION SUMMARY LINE (template logic)

Used in both the session table and the timeline modal header.

```typescript
function buildSessionSummary(session: CartSession): string {
  const product = session.products[0]?.productTitle ?? null
  const productCount = session.products.length
  const productStr = productCount > 1
    ? `${product} + ${productCount - 1} more`
    : product ?? 'items'

  const coupon = session.coupons[0] ?? null
  let couponStr = ''
  if (coupon) {
    if (coupon.status === 'applied') {
      couponStr = `, applied ${coupon.code}`
    } else if (coupon.status === 'recovered') {
      couponStr = `, unlocked ${coupon.code} after adding items`
    } else if (coupon.status === 'failed') {
      couponStr = `, tried ${coupon.code} (failed)`
    }
  }

  if (session.outcome === 'ordered') {
    return `${productStr}${couponStr}, completed order`
  } else if (session.outcome === 'checkout') {
    return `${productStr}${couponStr}, reached checkout`
  } else if (session.products.length > 0) {
    return `${productStr}${couponStr}, abandoned`
  } else {
    return 'Browsed without adding to cart'
  }
}
```

This function lives in a shared utility file, not inside a component.

---

## STEP 10 — CONVERSION BANDS CHART SPEC

Cart value bands (fixed for now):
```
$0–50, $50–100, $100–125, $125–150, $150–175, $175–200, $200+
```

Note on $100–125 and $125–150 being narrower than other bands:
These are intentionally narrower because most drwater sessions cluster
around $124 AOV. Narrower bands give more resolution around the
conversion threshold. This is hardcoded for now — acceptable.

Bar colour logic:
```typescript
const overallCvr = totalConversions / totalCheckoutSessions * 100

bands.map(band => {
  if (band.sessions < 10) return 'grey'  // low data
  if (band.conversionRate >= overallCvr + 10) return 'dark-blue'
  if (band.conversionRate >= overallCvr) return 'blue'
  return 'grey'
})
```

Insight line below chart:
```typescript
const highestBand = bands
  .filter(b => b.sessions >= 10)
  .sort((a, b) => b.conversionRate - a.conversionRate)[0]

const aovBand = bands.find(b =>
  aovCents >= b.minCents && aovCents < b.maxCents
)

if (!highestBand || !aovBand) return null

if (highestBand.label !== aovBand.label) {
  return `Sessions with carts of ${highestBand.label} convert at ${highestBand.conversionRate.toFixed(0)}% vs ${aovBand.conversionRate.toFixed(0)}% for your average cart of $${(aovCents/100).toFixed(0)}.`
} else {
  return `Your average cart of $${(aovCents/100).toFixed(0)} is already in your best-converting range (${highestBand.conversionRate.toFixed(0)}%).`
}
```

If fewer than 10 sessions total across all bands:
Show EmptyState, not the chart.

---

## STEP 11 — REVENUE PER COUPON CHART SPEC

Horizontal bar chart. Each bar = one coupon code row.
First bar always "No coupon (baseline)".

Bar colours:
```typescript
if (row.code === null) return 'grey'  // baseline
if (row.vsBaseline > 5) return 'green'
if (row.vsBaseline < -5) return 'red'
return 'grey'  // within ±$5 of baseline
```

Delta label at end of each bar:
```typescript
if (row.code === null) return 'baseline'
const sign = row.vsBaseline >= 0 ? '+' : ''
return `${sign}$${row.vsBaseline.toFixed(2)} vs no coupon`
```

Low data rows (isLowData = true):
- Rendered in grey regardless of vsBaseline
- Show "Low data" label instead of delta
- Sorted to bottom of chart, below all data-sufficient rows

---

## STEP 12 — NOTIFICATIONS MARK AS READ

When merchant clicks anywhere on an alert row (not the dismiss button):
1. Optimistically update UI — mark as read immediately (don't wait for API)
2. Fire POST /api/v2/notifications/[id]/read in background
3. If API returns error: revert the optimistic update, show a toast error

```typescript
async function markAsRead(alertId: string) {
  // Optimistic update
  mutate(data => ({
    ...data,
    alerts: data.alerts.map(a =>
      a.id === alertId ? { ...a, isRead: true } : a
    )
  }), false)

  try {
    const res = await fetch(`/api/v2/notifications/${alertId}/read`, {
      method: 'POST',
      body: JSON.stringify({ shop: shopDomain })
    })
    if (!res.ok) {
      // Revert
      mutate()  // revalidate from server
      // Show error banner — do not crash
    }
  } catch {
    mutate()  // revert on network error
  }
}
```

Dismiss (X button):
- Same optimistic pattern
- No separate API endpoint for dismiss in v2
- Dismissed alerts filtered client-side by adding to a local dismissed set
- Dismissal does not persist across page refreshes in v2 (acceptable for preview)

---

## STEP 13 — VERIFY AND COMMIT

After all pages are built:

```bash
npx tsc --noEmit
```

Fix every error. Zero type errors before committing.

```bash
npm run build
```

Fix every build error. Build must pass clean.

```bash
git add app/(embedded)/dashboard/v2/ app/api/v2/ supabase/alertlog-isread.sql
git commit -m "feat: v2 dashboard preview — Overview, Cart Sessions, Cart Performance, Discounts, Notifications at /dashboard/v2/*"
git push
```

After pushing, Vercel will deploy automatically.
Test at: https://checkoutmaxx-rt55.vercel.app/dashboard/v2/overview

Old dashboard at /dashboard/* is completely unaffected.

---

## STEP 14 — APPEND TO CHANGELOG.md

Before ending the session, append this entry to CHANGELOG.md:

```markdown
## [DATE]: V2 Dashboard — Preview build at /dashboard/v2/*

**What changed:** Built complete new dashboard at /dashboard/v2/* routes.
Old /dashboard/* routes untouched.

**Pages built:**
- /dashboard/v2/overview — 4 KPI cards, checkout funnel, drop analysis, alerts strip
- /dashboard/v2/cart — session table with 7 filters, timeline modal
- /dashboard/v2/performance — converted vs abandoned comparison, conversion bands, revenue per coupon
- /dashboard/v2/discounts — codes table with status, code detail panel
- /dashboard/v2/notifications — severity-ranked alerts with read/dismiss

**New API routes:** /api/v2/overview, /api/v2/cart/sessions, /api/v2/cart/session,
/api/v2/performance, /api/v2/discounts, /api/v2/discounts/[code],
/api/v2/notifications, /api/v2/notifications/[id]/read

**DB change:** AlertLog.isRead column — added via supabase/alertlog-isread.sql
(manual run required). isRead is optional in API — null treated as false.

**Key decisions:**
- All reads use Supabase JS client — no Prisma in v2
- /dashboard/v2/* has its own layout — does not affect existing nav
- Optimistic UI for mark-as-read — reverts on API error
- Dismiss is client-side only in v2 preview (does not persist)
- No LLMs anywhere — all text is template-generated or raw data

**Files changed:** [list all new files created]
```
