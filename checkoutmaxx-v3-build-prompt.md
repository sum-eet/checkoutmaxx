# CheckoutMaxx — V3 Dashboard Build Prompt
> Read SPEC.md and CHANGELOG.md before touching anything.
> Read this entire file before writing a single line of code.
> V3 is built at /dashboard/v3/* and /api/v3/*
> V1 (/dashboard/*) and V2 (/dashboard/v2/*) stay untouched until explicit migration.

---

## VERSION MIGRATION STRATEGY

Three versions exist or will exist:
  V1 — /dashboard/*           currently live, working, do not touch
  V2 — /dashboard/v2/*        preview, built in previous session
  V3 — /dashboard/v3/*        what this prompt builds

### How to switch between versions
A single env var controls which version the Shopify embedded app nav points to.

In shopify.app.toml (do not modify the file — read it first):
The embedded app's root route is what Shopify loads when merchant opens the app.

Create a middleware file: middleware.ts in the project root.
```typescript
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const dashboard = process.env.DASHBOARD_VERSION ?? 'v1'
  if (request.nextUrl.pathname === '/dashboard') {
    return NextResponse.redirect(
      new URL(`/dashboard/${dashboard === 'v1' ? '' : dashboard + '/'}overview`,
      request.url)
    )
  }
}

export const config = {
  matcher: ['/dashboard']
}
```

Add to Vercel environment variables:
  DASHBOARD_VERSION=v1   → serves existing V1
  DASHBOARD_VERSION=v2   → serves V2 preview
  DASHBOARD_VERSION=v3   → serves V3

Changing this env var + redeploying switches the active version instantly.
No code changes. No merging. No risk to existing functionality.

### Deploy sequence
1. Build V3 in this session. Test at /dashboard/v3/overview directly.
2. When satisfied: set DASHBOARD_VERSION=v3 in Vercel → redeploy → V3 is live.
3. V1 and V2 routes remain accessible directly via URL for comparison.
4. When fully confident in V3: delete V1 and V2 routes in a future session.

---

## ABSOLUTE GUARDRAILS

### Never touch these — live and working
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
app/(embedded)/dashboard/           — V1, untouched
app/(embedded)/dashboard/v2/        — V2, untouched
app/api/cart/                       — existing cart API routes
app/api/metrics/
app/api/alerts/
```

### What you are building — new files only
```
middleware.ts                                    NEW — version router
app/(embedded)/dashboard/v3/layout.tsx          NEW
app/(embedded)/dashboard/v3/overview/page.tsx   NEW
app/(embedded)/dashboard/v3/sessions/page.tsx   NEW
app/(embedded)/dashboard/v3/performance/page.tsx NEW
app/(embedded)/dashboard/v3/discounts/page.tsx  NEW
app/(embedded)/dashboard/v3/notifications/page.tsx NEW

app/api/v3/overview/route.ts                    NEW
app/api/v3/sessions/route.ts                    NEW
app/api/v3/session/route.ts                     NEW
app/api/v3/performance/route.ts                 NEW
app/api/v3/discounts/route.ts                   NEW
app/api/v3/discounts/[code]/route.ts            NEW
app/api/v3/notifications/route.ts               NEW
app/api/v3/notifications/[id]/read/route.ts     NEW
```

### Technology rules
```
DB reads:       Supabase JS client only (lib/supabase.ts) — never Prisma
DB writes:      none except marking alerts read
Money in DB:    CartEvent.cartValue and discountAmount = CENTS (÷100 for display)
                CheckoutEvent.totalPrice = DOLLARS (display as-is)
Tables:         "CartEvent", "CheckoutEvent", "Shop", "AlertLog",
                "SessionPing", "IngestLog" — case-sensitive, always quoted
TypeScript:     npx tsc --noEmit must pass clean before any commit
Build:          npm run build must pass clean before any commit
Charts:         Use recharts (already installed) — do not install new libraries
Polaris:        Use Polaris components for all layout, cards, tables, badges
                Do not use custom CSS where Polaris covers it
```

---

## NAVIGATION — V3

```
Cart Activity      /dashboard/v3/overview       default landing
Cart Sessions      /dashboard/v3/sessions
Cart Performance   /dashboard/v3/performance
Discounts          /dashboard/v3/discounts
Notifications      /dashboard/v3/notifications
```

Settings link at bottom → existing /settings page (no V3 version needed).
V3 badge in layout header — small, subdued — so merchant knows it's the new version.

---

## GLOBAL TIME FILTER

Four presets only. No "30 days" or "90 days" on most pages — merchants think in
operational windows, not arbitrary calendar periods.

```
1h    — last 60 minutes (live monitoring)
24h   — last 24 hours (daily review)
7d    — last 7 days (weekly review)
Custom — date range picker, any range, no minimum, no maximum
```

Default: 24h

Persists in URL query params: ?start=ISO&end=ISO
All pages respond to the same global filter.
Cart Performance has an additional override (see that page's spec).

Comparison period:
  1h   → previous hour
  24h  → previous 24 hours
  7d   → previous 7 days
  Custom → previous equivalent duration

Delta display rules:
  Rates and percentages: show as percentage points → "+3.2pp"
  Counts: show as percentage → "+12%"
  Money: show as dollar delta → "+$14.20"
  Green = improving. Red = worsening. Grey = within ±2% / ±1pp.

---

## SOURCE CAPTURE (requires cart-monitor.js change)

Current state: pageUrl is stored as pathname only. UTM params are stripped.
Required change: on session init, read UTM params from window.location.search
and include in the session ping payload.

Add to cart-monitor.js session init (after sessionId assignment):
```javascript
function getUtmSource() {
  try {
    const p = new URLSearchParams(window.location.search)
    return {
      utmSource: p.get('utm_source'),
      utmMedium: p.get('utm_medium'),
      utmCampaign: p.get('utm_campaign')
    }
  } catch { return {} }
}
```

Include in session ping payload:
```javascript
const utm = getUtmSource()
const pingPayload = JSON.stringify({
  sessionId: CONFIG.sessionId,
  source: 'cart',
  shopDomain: CONFIG.shopDomain,
  country: CONFIG.country ?? null,
  device: CONFIG.device ?? null,
  pageUrl: window.location.pathname,
  utmSource: utm.utmSource ?? null,
  utmMedium: utm.utmMedium ?? null,
  utmCampaign: utm.utmCampaign ?? null,
  occurredAt: new Date().toISOString(),
})
```

Add these columns to SessionPing table:
```sql
ALTER TABLE "SessionPing"
ADD COLUMN IF NOT EXISTS "utmSource" text,
ADD COLUMN IF NOT EXISTS "utmMedium" text,
ADD COLUMN IF NOT EXISTS "utmCampaign" text;
```

Create file supabase/sessionping-utm.sql with the above.
Print reminder: "Run supabase/sessionping-utm.sql in Supabase SQL editor."

Source filter values derived from utmSource:
  null or '' → "Direct"
  'google' or 'bing' → "Paid search"
  'instagram' or 'facebook' or 'tiktok' → "Social"
  'klaviyo' or 'email' → "Email"
  anything else → use raw utmSource value

---

---

# PAGE 1 — CART ACTIVITY
**Route:** /dashboard/v3/overview
**Mental state served:** Quick check. 30 seconds. Numbers and colours.
**Design principle:** One dominant thing — the 4 KPI cards. Everything else supports.

---

## TIME FILTER
Displayed top right. Presets: 1h / 24h / 7d / Custom.
Default: 24h.

---

## ROW 1 — 4 KPI Cards (clickable filters)

All four cards are clickable. Clicking a card filters the session table below
to show only matching sessions. Active card has a blue outline.
Clicking the active card again resets the filter.

### Card 1 — Carts Opened
```
Value:     COUNT(DISTINCT sessionId) FROM CartEvent
           WHERE occurredAt IN range AND shopId = shop
           (all sessions, including empty)
Sub-label: "[X] with products · [Y] empty"
           X = sessions where cartValue > 0 OR cartItemCount > 0
           Y = total - X
Delta:     % change vs previous period
Click:     shows all sessions in table (default state, resets other filters)
```

### Card 2 — With Products
```
Value:     COUNT(DISTINCT sessionId) FROM CartEvent
           WHERE occurredAt IN range
           AND (cartValue > 0 OR cartItemCount > 0)
Sub-label: "[X]% of sessions"
           X = (with products / carts opened) * 100
Delta:     percentage point change vs previous period
           Format: "was X% prev period" shown as subdued text below sub-label
           NOT as a badge — inline subdued text is less alarming for small fluctuations
Click:     filters table to sessions with products only
```

### Card 3 — Coupon Attempted
```
Value:     COUNT(DISTINCT sessionId) WHERE any coupon event exists
           AND occurredAt IN range
Sub-label: "[X]% of product carts"
           X = (coupon sessions / with-products sessions) * 100
Delta:     "was X% prev period" subdued text
Click:     filters table to sessions with any coupon event
```

### Card 4 — Reached Checkout
```
Value:     COUNT(DISTINCT sessionId) WHERE cart_checkout_clicked exists
           OR sessionId IN CheckoutEvent with checkout_started
           AND occurredAt IN range
Sub-label: "[X]% of product carts"
           X = (checkout sessions / with-products sessions) * 100
Delta:     "was X% prev period" subdued text
Click:     filters table to sessions that reached checkout
```

---

## ROW 2 — Session Filters

Displayed as a horizontal filter bar below the KPI cards.
These are secondary filters — they narrow within whatever card filter is active.

```
Filter 1 — Product (dropdown)
  Options: All products + distinct productTitles from lineItems in range
  Filters to sessions containing that product

Filter 2 — Device (segmented control — not dropdown, only 3 options)
  All / Desktop / Mobile
  Based on "device" field in CartEvent

Filter 3 — Country (dropdown)
  Options: All countries + distinct country values in range, sorted by frequency

Filter 4 — Source (dropdown)
  Options: All sources / Direct / Paid search / Social / Email / [raw utm values]
  Derived from utmSource in SessionPing
  Note: shows "Source unavailable" for sessions before UTM capture was added
```

No "status" filter (Ordered/Abandoned). Reason: a session marked "abandoned"
may have converted in a later session. Showing status as a filter implies
finality that the data cannot confirm. Outcome badge stays on the table rows
as informational context only — not a filter.

Active filters: shown as dismissible tags below the filter bar.
"Clear all" link when any filter (card or dropdown) is active.

---

## ROW 3 — Scoped Counts (inline, updates with filters)

```
Format: "Showing [X] sessions  ·  [Y]% reached checkout  ·  [Z]% completed order"
Updates live as filters change.
Z = sessions with checkout_completed / showing count * 100
```

---

## ROW 4 — Session Table

No horizontal scroll. Ever.
Products stack vertically. Coupons stack vertically. Time shows relative + absolute.

```
Columns:

Time (width: 100px)
  Line 1: relative time — "32m ago" / "2h ago" / "yesterday 4pm"
  Line 2: absolute time in merchant's timezone — "2:32 PM IST"
  Line 3: session duration — "8m 14s"
  Timezone: use Intl.DateTimeFormat with the merchant's shop timezone
            (read from Shopify session/shop data — already available in auth)

Country + Device (combined, width: 70px)
  Flag emoji + country code
  Device icon below (laptop = desktop, phone = mobile)

Products (flexible width, no max)
  Each product on its own line:
  "[Product name] ×[qty]  $[price]"
  Price is the line item price (cartValue contribution of that item)
  If no products: "Empty cart" in subdued text
  Never truncate — let the column expand. This is why no horizontal scroll.

Cart Value (width: 110px)
  If value changed during session: "$[start] → $[end]"
  Start = first cartValue > 0 in session
  End = last cartValue > 0 in session
  If unchanged: "$[value]"
  If always 0 or null: "—"

Coupons (width: 120px)
  Each code on its own line (not horizontal pills — vertical stack)
  Format per code:
    Applied (couponSuccess=true): green text "✓ [CODE] −$[discount]"
    Failed (couponSuccess=false, never recovered): red text "✗ [CODE]"
    Recovered (couponRecovered=true): amber text "↑ [CODE] −$[discount]"
    Neutral (no success field): grey text "[CODE]"
  No pill backgrounds — just coloured text. Cleaner at a glance.

Outcome (width: 80px)
  Ordered → green badge
  Reached checkout → amber badge
  Abandoned → grey badge
  Note: this is informational only. Not a filter. Tooltip on hover:
  "This reflects activity within this session only. The customer
   may have returned and purchased in a separate session."

View (width: 36px)
  "View →" text link
  Opens session timeline panel (right-side sheet, not modal)
```

Sort: occurredAt DESC (most recent first)
Pagination: 25 per page with prev/next

---

## SESSION TIMELINE PANEL

Right-side sheet. Full height. Opens on "View →" click.
Does not navigate away from the page.

```
Header:
  One-line summary (template, not LLM):
    Rules (first match wins):
    1. checkout_completed:
       "[Product] [+ X more if multi], [coupon action], completed order"
    2. cart_checkout_clicked but no completed:
       "[Product], [coupon action], reached checkout"
    3. cartValue > 0, no checkout:
       "[Product], [coupon action], abandoned"
    4. cartValue = 0:
       "Browsed without adding to cart"

    Coupon action phrases:
      applied:   "applied [CODE] (saved $X)"
      failed:    "tried [CODE] (failed)"
      recovered: "unlocked [CODE] after adding items"
      none:      omit entirely

  Cart value (final), item count, outcome badge
  Country flag + device icon
  Session duration

Products section:
  "[Product name]  ×[qty]  $[price per item]"
  Total: "$[cartValue]" right-aligned

Timeline section:
  Merged CartEvent + CheckoutEvent sorted by occurredAt ASC

  Per event:
    Left column: clock time + elapsed since previous event (+Xs / +Xm Ys)
    Source badge: "Cart" (grey) or "Checkout" (blue)
    Label + detail (see label map in V2 spec — reuse exactly)
    Sentiment colour: green=positive, red=negative, default=neutral

  Empty state: "No events found for this session"
```

---

## ROW 5 — Recent Alerts Strip

Below the session table. Shows last 3 alerts regardless of read status.
One line per alert: [dot] [title] [body truncated] [timestamp] [→ link]
"View all →" at right end.
Hidden entirely if no alerts in last 7 days.

---

---

# PAGE 2 — CART SESSIONS
**Route:** /dashboard/v3/sessions
**Mental state served:** Investigation. Find a specific session fast.
**Design principle:** Search and filter dominant. Table is the content.

This page is intentionally minimal. No charts. No KPI cards.
The merchant comes here to find one thing. Don't distract them.

---

## TOP: Search Bar (full width, prominent)

```
Placeholder: "Search by session ID, product name, or coupon code..."
Searches across: sessionId, productTitle in lineItems, couponCode
Live search: filters table as merchant types (debounced 300ms)
```

---

## FILTERS (below search)

Same 4 filters as Cart Activity (Product, Device, Country, Source)
Plus:

```
Filter 5 — Cart Value Range
  Options: Any / Under $50 / $50–$100 / $100–$150 / $150–$200 / $200+ / Custom
  Based on highest cartValue in session

Filter 6 — Has Coupon
  Options: Any / Used a coupon / No coupon / Has failed coupon / Has recovered coupon
  "Has failed coupon" = cart_coupon_failed exists with no subsequent recovery for same code
  "Has recovered coupon" = cart_coupon_recovered exists in session
```

No outcome/status filter. Same reason as Cart Activity.

---

## SCOPED COUNTS (inline)

"Showing [X] sessions  ·  [Y]% reached checkout  ·  [Z]% completed order"

---

## SESSION TABLE

Identical columns to Cart Activity session table.
Full date range available (not just the global 1h/24h/7d filter).
This page has its own date range override — can go back 90 days.
Reason: investigation use case often means finding a session from last week.

---

---

# PAGE 3 — CART PERFORMANCE
**Route:** /dashboard/v3/performance
**Mental state served:** Strategic analysis. Weekly review before decisions.
**Design principle:** Charts are dominant. Filters at top. Time intelligence secondary.

---

## TIME FILTER OVERRIDE

This page defaults to 30 days regardless of global filter.
Merchant can change to any range.
Minimum meaningful data: 20 completed orders. Below that, show empty state:
"[X]/20 orders needed for reliable insights. Select a wider date range."
Never show the insight line below charts if fewer than 20 orders.

---

## FILTERS (below time filter)

Device / Country / Source — same dropdowns as other pages.
These filter ALL charts on this page simultaneously.
Lets merchant ask: "What does conversion look like for mobile US traffic only?"

---

## ROW 1 — Two Charts Side by Side

### Left: Conversion by Cart Value Bands

```
Component: Vertical bar chart (recharts BarChart)
Title: "Conversion rate by cart value"
Sub: "Based on [X] sessions · [date range]"

X axis: cart value bands
  $0–50 / $50–100 / $100–125 / $125–150 / $150–175 / $175–200 / $200+
  Note: $100–125 and $125–150 are narrower because drwater AOV clusters here.
  These are fixed bands. Future: make dynamic based on store's actual AOV.

Y axis: conversion rate 0–100%

Math per band:
  Numerator:   sessions where highest cartValue falls in band
               AND checkout_completed exists for that sessionId
  Denominator: sessions where highest cartValue falls in band
               AND (cart_checkout_clicked OR checkout_started exists)
  Rate:        numerator / denominator * 100
  Exclude:     sessions with cartValue = 0 or null

Bar colours:
  Below overall avg conversion rate: #888780 (grey)
  At or above overall avg: shade of blue, darker as rate increases
    avg to avg+15pp: #378ADD
    avg+15pp to avg+30pp: #185FA5
    avg+30pp+: #0C447C
  Bars with fewer than 10 sessions: #D3D1C7 (light grey) + "Low data" label

Reference lines:
  Solid thin blue vertical line at merchant's AOV band — labelled "Your AOV $XXX"
  Dashed horizontal line at overall avg conversion rate — labelled "Avg CVR XX%"

Insight line below chart (template only, no LLM):
  const highestBand = bands with ≥10 sessions, sorted by convRate DESC, first
  const aovBand = band containing current AOV
  if highestBand.label !== aovBand.label:
    "Sessions over [highestBand.min] convert at [X]% vs [Y]% for your avg cart."
  else:
    "Your avg cart of $[AOV] is already in your best-converting range ([X]%)."
  If fewer than 20 completed orders: show nothing
```

### Right: Revenue Per Session by Code

```
Component: Horizontal bar chart (recharts BarChart layout="vertical")
Title: "Revenue per session by discount code"
Sub: "Net revenue per session — vs no-discount baseline"

Y axis (categories): "No coupon (baseline)" pinned at top, then codes sorted
                     by revPerSession DESC, low-data codes at bottom

X axis: revenue per session in dollars

Math per bar:
  No coupon baseline:
    sessions = sessions with no coupon events AND cartValue > 0
    convRate = checkout_completed / sessions * 100
    avgCart = AVG(cartValue at checkout click) in dollars
    revPerSession = avgCart * (convRate / 100)

  Per code:
    sessions = sessions with any event for this code
    convRate = sessions with this code AND checkout_completed / sessions * 100
    avgCart = AVG(cartValue) at time of coupon event (cents / 100)
    avgDiscount = AVG(discountAmount) WHERE couponSuccess=true (cents / 100)
                  0 if no successful applications
    revPerSession = (avgCart - avgDiscount) * (convRate / 100)
    vsBaseline = revPerSession - baseline.revPerSession

Bar colours:
  Baseline: grey
  vsBaseline > $5: green (#639922)
  vsBaseline < -$5: red (#A32D2D)
  within ±$5: grey
  isLowData (< 10 sessions): light grey, "Low data" label, sorted to bottom

Delta label at end of each bar:
  "+$XX vs no coupon" or "−$XX vs no coupon"
  Baseline row: "baseline"

Below chart — note (static):
  "Rev/session = (avg cart − avg discount) × conversion rate.
   A code above baseline earns more net revenue per visitor than no discount."
```

---

## ROW 2 — Time Intelligence (3 metric cards)

```
Component: 3 cards in a row, same style as KPI cards

Card 1 — Median: first item → checkout click
  Value: MEDIAN of (checkout_click.occurredAt - first_cart_item_added.occurredAt)
         per session, for sessions that reached checkout
         Display: "Xm Ys"
  Sub: "Consideration window for sessions that checked out"
  Delta: vs previous period

Card 2 — Checkout load time
  Value: MEDIAN of (checkout_started.occurredAt - cart_checkout_clicked.occurredAt)
         per session, joined across CartEvent and CheckoutEvent on sessionId
         Display: "X.Xs"
  Sub: "Time from checkout click to Shopify checkout loading"
  Delta: vs previous period
  Note: values over 3 seconds = friction worth investigating
        Show amber colour if median > 3000ms, red if > 5000ms

Card 3 — Return buyer rate
  Value: COUNT(sessionIds that share a cartToken with an earlier session)
         / COUNT(sessions with checkout_completed) * 100
         Display: XX%
  Sub: "Orders where customer visited more than once before buying"
  Delta: vs previous period
  Note: high return rate = longer consideration window, don't email too early
```

---

## ROW 3 — Cart Composition

```
Component: Two large numbers side by side + supporting table
No card wrapper — just clean typography on the page

Left number (large):
  "XX% of orders came from multi-product carts"
  X = sessions with checkout_completed AND cartItemCount > 1
      / sessions with checkout_completed * 100
  Sub (smaller): "vs XX% in the previous period"

Right number (large):
  "XX% came from single-product carts"
  Sub: "vs XX% in the previous period"

Below the two numbers — top 5 product combinations in converted carts:
  Title: "Most common combinations in completed orders"
  Simple ranked list (not a table):
  1. HydroTumbler + HydroTumbler  ·  34 orders  ·  avg $209
  2. HydroPitcher + E-Book        ·  18 orders  ·  avg $124
  3. HydroFix + HydroTumbler      ·  12 orders  ·  avg $159
  ...

  Math:
    For each completed session, sort lineItems by productTitle, join into a string
    Group by combination string, count, average cartValue
    Sort by count DESC, show top 5
    Minimum 5 completed sessions to show a combination

  If fewer than 5 combinations or fewer than 20 completed orders:
    Show empty state: "Not enough orders yet to show combination patterns."
```

---

---

# PAGE 4 — DISCOUNTS
**Route:** /dashboard/v3/discounts
**Mental state served:** Operational monitoring + strategic analysis. Both.
**Design principle:** Health status dominant at top. Performance detail below.

Merged from V2's "All Codes" + "Coupon Intelligence" — one page, all data.

---

## TIME FILTER

Default: 30 days (coupon analysis needs volume).
All presets available. Merchant can override.

---

## FILTERS

Device / Country / Source — same dropdowns.
Applied to all data on this page.

---

## ROW 1 — 4 KPI Cards

```
Card 1 — Active codes
  Value: COUNT(DISTINCT couponCode) FROM CartEvent
         WHERE couponCode IS NOT NULL AND occurredAt IN range

Card 2 — Avg cart with coupon vs without
  Value: "$[X] with coupon · $[Y] without"
         X = AVG(cartValue) for sessions with any coupon event (cents/100)
         Y = AVG(cartValue) for sessions with no coupon events (cents/100)
  Delta: "+$Z lift" where Z = X - Y
         Green if positive (coupons pulling AOV up)
         Red if negative (coupon users have lower carts)

Card 3 — Carts recovered
  Value: COUNT(DISTINCT sessionId) WHERE cart_coupon_recovered = true
         AND occurredAt IN range
  Sub: "added items to unlock a code"
  Delta: vs previous period

Card 4 — Codes needing attention
  Value: COUNT(DISTINCT couponCode) where status = Broken or Degraded
  Sub: list of broken code names (up to 3), truncated
  Colour: red if > 0 broken codes, amber if only degraded, green if all healthy
```

---

## ROW 2 — Code Health Table

```
Title: "All codes"
Sub: "[X] active in [date range]"

Status logic:
  Healthy:   success rate ≥ 50%
  Degraded:  success rate 20–49%
  Broken:    success rate < 20%

Columns:

Status (24px)
  Coloured dot only. Green/amber/red. No text — dot is self-explanatory.
  Legend below table title: "● Healthy  ● Degraded  ● Broken"

Code
  Monospace font. Click row → opens code detail panel (right-side sheet).

Attempts
  COUNT(DISTINCT sessionId) where this code was attempted in range

Success rate
  applied sessions / total sessions * 100
  Colour matches status: green/amber/red text

Avg cart
  AVG(cartValue) at time of coupon event, in dollars

Recoveries
  COUNT(DISTINCT sessionId) where couponRecovered = true for this code
  Show: "X unlocked" if > 0, "—" if 0

Rev/session
  See math in Cart Performance page spec — same formula
  Grey + "Low data" if < 10 sessions

Last seen
  MAX(occurredAt) for this code: "Today" / "Yesterday" / "Mar 12"

Row background tinting:
  Broken rows: very subtle red tint (background-danger at low opacity)
  Degraded rows: very subtle amber tint (background-warning at low opacity)
  Healthy rows: no tint

Sort default: attempts DESC (most-used codes first)
Allow resort by: success rate, rev/session, last seen
```

---

## ROW 3 — Two Charts Side by Side

### Left: Revenue Per Session (same as Cart Performance)

Reuse exact same component. Show here too because Discounts page
needs it in context of the code health table above.

### Right: Avg Cart + Conversion Rate by Code

```
Component: Grouped bar chart (recharts BarChart)
Two bars per code: one for avg cart value (blue), one for conv rate (green)
Dual Y axes: left = dollars, right = percentage

Shows: which codes correlate with high-value carts AND high conversion
       A code with high avg cart but low conv rate = customers trying it
       but it's not closing the sale (friction somewhere)
       A code with low avg cart but high conv rate = working on smaller purchases

X axis: code names (abbreviated if needed)
Legend: custom HTML below chart (blue square = avg cart, green = conv rate)
```

---

## CODE DETAIL PANEL

Right-side sheet, full height, opens on row click.

```
Header:
  Code name (large, monospace)
  Status dot + status label
  "[X] attempts in [date range]"

Section 1 — Attempt trend chart
  Component: Line chart with 2 lines
  X axis: daily (or hourly if range ≤ 2 days)
  Line 1 (grey): daily attempt count
  Line 2 (green): daily success count
  Rationale: two lines on one axis shows the day a code broke —
             successes flatline while attempts continue

Section 2 — Summary stats (2×2 grid)
  Success rate this period vs previous: "XX% (was YY%)"
  Avg cart with this code vs store avg: "$XXX (store avg $YYY)"
  Rev/session vs baseline: "$XX (baseline $YY)"
  Total discount given: "$XXX across X orders"

Section 3 — Product breakdown (only if > 1 product in lineItems data)
  Title: "Success rate by product type"
  Table: Product context | Attempts | Success rate | Issue
  This is where the PATRICKSDAY × duo bundle insight surfaces automatically.
  Logic: group coupon events by the set of products in lineItems at time of attempt
         If success rate differs significantly (>20pp) between product groups →
         show a warning badge: "Product restriction likely"

Section 4 — Recovery detail (only if recoveries > 0)
  Title: "X customers unlocked this code by adding items"
  4 numbers in a 2×2 grid:
    Avg cart before: $X
    Avg cart after: $Y
    Avg increase: +$Z (shown in green)
    Conversion rate after recovery: XX%
  Insight line: "Customers who unlock this code convert at [X]%
                 and have [Y]% higher carts than average."

Section 5 — Recent sessions (last 10)
  Mini table: Time | Cart value | Outcome | Applied/Failed
  "View session →" link per row — opens session timeline on Cart Sessions page
```

---

---

# PAGE 5 — NOTIFICATIONS
**Route:** /dashboard/v3/notifications
**Mental state served:** Action queue. What needs fixing today?
**Design principle:** Severity drives order. Each alert links to the fix.

---

## ROW 1 — Summary Bar

```
"[X] unread  ·  [X] critical  ·  [X] warnings"
"Mark all read" link at right.
```

---

## ROW 2 — Filter Tabs

All | Critical | Warnings | Info | Dismissed
Plus: Settings tab (far right, separated by spacer)

---

## ROW 3 — Alerts List

```
Each alert row:
  Left border: 2px solid in severity colour (red/amber/blue)
  [dot] [title] [body] [→ link] [timestamp] [dismiss ×]

  Unread: slightly stronger background
  Read: default background
  Click anywhere (not dismiss): marks as read

Alert definitions:

CRITICAL (red) — fires fast, merchant needs to act today

  1. Broken coupon
     Trigger: ≥ 10 attempts, < 10% success rate in any 2-hour window
     Title: "[CODE] may be broken"
     Body: "[X] attempts, [X]% success in last 2h"
     Link: → Discounts page, that code's detail panel

  2. CVR drop
     Trigger: checkout CVR > 40% below 7-day baseline for > 30 minutes
     Title: "Checkout conversion dropped"
     Body: "CVR is [X]% — baseline is [Y]%"
     Link: → Cart Performance page

  3. Product-restricted coupon (new — based on today's PATRICKSDAY finding)
     Trigger: a code succeeds on product A but fails on product B,
              with ≥ 5 failures on product B in last 24h
     Title: "[CODE] failing on [product]"
     Body: "[X]% success on other products, 0% on [product name]"
     Link: → Discounts page, that code's detail panel

WARNING (amber) — worth knowing, not urgent

  4. Coupon degraded
     Trigger: success rate 20–49%, ≥ 5 attempts, last 24h
     Title: "[CODE] success rate is low"
     Body: "[X]% success across [Y] attempts today"
     Link: → Discounts page

  5. Step dropout spike
     Trigger: dropout at any checkout step > 2× baseline for ≥ 30 min
     Title: "High dropout at [step]"
     Body: "[X]% dropping at [step] vs [Y]% baseline"
     Link: → Cart Performance page

INFO (blue) — positive signals, no action needed

  6. Cart recoveries
     Trigger: ≥ 3 cart_coupon_recovered events today
     Title: "[X] cart recoveries today"
     Body: "[CODE] unlocked [X]× · customers added avg $[X] to qualify"
     Link: → Discounts page, that code's detail panel

  7. New traffic source
     Trigger: sessions arrive with a utmSource not seen in previous 30 days
     Title: "New traffic source: [source]"
     Body: "[X] sessions from [source] in last 24h"
     Link: → Cart Sessions filtered by that source
```

---

## SETTINGS TAB (within Notifications page)

Shown when "Settings" tab is clicked.

```
One row per alert type.
Each row:
  [toggle on/off] [alert name] [description] [Slack badge] [Email badge]

Toggle: on = blue, off = grey
Channel badges: clickable to toggle each channel independently
  Active: filled badge (blue for Slack, green for Email)
  Inactive: outlined grey badge

Alert types and their defaults:
  Broken coupon alert          ON  · Slack ON  · Email ON
  CVR drop alert               ON  · Slack ON  · Email OFF
  Product-restricted coupon    ON  · Slack ON  · Email ON
  Coupon degraded              ON  · Slack OFF · Email OFF
  Step dropout spike           ON  · Slack ON  · Email OFF
  Cart recoveries summary      ON  · Slack OFF · Email OFF
  New traffic source           OFF · Slack OFF · Email OFF
  Weekly digest email          ON  · Slack OFF · Email ON

Weekly digest:
  Sent Monday 9am merchant timezone
  Contains: top 3 insights from the past week
  Each insight = one number + one sentence
  No charts, no AI text — pure data formatted as sentences
  Links back into the app for each insight
```

---

---

# EMPTY STATES

Every chart, table, and section must have an empty state.
Use Polaris EmptyState component throughout.

```
No sessions:
  "No cart sessions in this period."
  "Sessions appear once customers visit the store."

No checkout events:
  "No checkout data in this period."
  "Make sure the app is installed on your store."

Fewer than 20 orders (Cart Performance):
  "Not enough data yet — [X]/20 orders needed."
  "Select a wider date range or check back later."

No coupon activity:
  "No discount codes used in this period."

No alerts:
  "No alerts in this period."
  "Alerts fire automatically when anomalies are detected."

No combinations (Cart Performance):
  "Not enough orders yet to show combination patterns."
```

---

# API ROUTES — V3

All new. All under /api/v3/. Read-only except mark-as-read.

```
GET /api/v3/overview
  Params: shop, start, end
  Returns: kpis (4 cards with values + deltas), recentAlerts (last 3)

GET /api/v3/sessions
  Params: shop, start, end, product, device, country, source,
          minCart, maxCart, hasCoupon, search, page
  Returns: sessions (25 per page), total, scopedCounts

GET /api/v3/session
  Params: shop, sessionId
  Returns: session detail + full timeline (CartEvent + CheckoutEvent merged)

GET /api/v3/performance
  Params: shop, start, end, device, country, source
  Returns: conversionBands, revenuePerCoupon, timeIntelligence,
           cartComposition, productCombinations

GET /api/v3/discounts
  Params: shop, start, end, device, country, source
  Returns: kpis (4 cards), codes (table rows), chartData (for both charts)

GET /api/v3/discounts/[code]
  Params: shop, start, end
  Returns: trend, summary, productBreakdown, recovery, recentSessions

GET /api/v3/notifications
  Params: shop, start, end, severity
  Returns: summary, alerts list

POST /api/v3/notifications/[id]/read
  Body: { shop }
  Handles: not found (404), wrong shop (403), column missing (503),
           already read (200 idempotent), supabase error (500)
```

---

# BUILD SEQUENCE

Build in this exact order. Do not skip ahead.

```
1. Verify clean build — npx tsc --noEmit + npm run build, fix any errors first

2. Add middleware.ts — version router, test that DASHBOARD_VERSION env var works

3. Add UTM capture to cart-monitor.js — read window.location.search on init,
   include in session ping, create supabase/sessionping-utm.sql

4. Build /api/v3/* routes — ALL routes before any UI
   Test each with a curl request. Confirm response shape before building UI.

5. Build V3 layout — nav, version badge, date filter component

6. Build Cart Activity page (overview) — KPI cards, filter bar, session table,
   timeline panel, alerts strip

7. Build Cart Sessions page — search bar, filters, table (same components as overview)

8. Build Cart Performance page — time filter override, charts, time intelligence,
   cart composition

9. Build Discounts page — KPI cards, code health table, charts, code detail panel

10. Build Notifications page — alerts list + settings tab

11. npx tsc --noEmit — fix all errors
12. npm run build — fix all errors
13. Test at /dashboard/v3/overview with real data

14. git add + commit + push
    Commit message: "feat: v3 dashboard — Cart Activity, Sessions, Performance,
    Discounts, Notifications at /dashboard/v3/*"
```

---

# APPEND TO CHANGELOG.md

Before ending the session, add this entry:

```markdown
## [DATE]: V3 dashboard built at /dashboard/v3/*

**What changed:** Complete V3 dashboard. New IA, new pages, new data models.
V1 and V2 untouched. Version switching via DASHBOARD_VERSION env var.

**Pages:** Cart Activity, Cart Sessions, Cart Performance, Discounts, Notifications

**New capabilities vs V2:**
- Clickable KPI card filters (Cart Activity)
- UTM/source capture in cart-monitor.js + SessionPing table
- No outcome filter (deceptive — abandoned session may convert later)
- Time intelligence: consideration window, checkout load time, return buyer rate
- Cart composition and product combination analysis (Cart Performance)
- Merged Discounts page: code health + coupon intelligence + charts
- Product-restricted coupon detection (new alert type from PATRICKSDAY finding)
- Notification settings tab with per-channel toggles

**DB changes:**
- SessionPing: added utmSource, utmMedium, utmCampaign columns
  Run: supabase/sessionping-utm.sql in Supabase SQL editor

**Files changed:** middleware.ts (NEW), all /dashboard/v3/* pages (NEW),
all /api/v3/* routes (NEW), extensions/cart-monitor/assets/cart-monitor.js
(UTM capture added), supabase/sessionping-utm.sql (NEW)

**Version switching:** Set DASHBOARD_VERSION in Vercel env vars:
  v1 = original dashboard (default)
  v2 = previous preview
  v3 = this build
```
