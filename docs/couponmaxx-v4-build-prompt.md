# CouponMaxx — Pages 3 & 4 Spec + V4 Full Build Prompt
> This file contains Page 3 (Coupons), Page 4 (Notifications/Settings),
> and the complete Claude Code build prompt for V4.
> Paste the build prompt section into Claude Code from the repo root.
> Read alongside couponmaxx-ui-spec.md which has Pages 1 and 2.

---

## PAGE 3 — COUPONS
**Route:** /couponmaxx/coupons
**API:** /api/couponmaxx/coupons and /api/couponmaxx/coupons/[code]

---

### PURPOSE LINE
Below "Coupons": "Track every code, find what's failing, understand what's driving revenue."
13px #6B7280.

---

### SECTION: Date range + Refresh
Same pill as all pages. Default: Last 30 days.

---

### SECTION: Four KPI boxes

Display-only on this page — clicking does NOT filter the table.
Same visual style as Cart Sessions boxes.

#### BOX 1 — Codes Tracked

```
Big number:   COUNT(DISTINCT couponCode) FROM CartEvent
              WHERE couponCode IS NOT NULL AND occurredAt IN range
              Format: integer

Sub-line 1 (colour-coded inline):
  "[X] broken  ·  [Y] degraded  ·  [Z] healthy"
  broken:   red #B91C1C
  degraded: amber #B45309
  healthy:  green #15803D
  separator · : #D1D5DB

Status logic:
  Healthy:   success rate >= 50%
  Degraded:  success rate 20-49%
  Broken:    success rate < 20%
  Minimum 5 attempts to assign status.
  Under 5 attempts: grey "Low data" — not counted in any status group.
```

#### BOX 2 — Coupon Success Rate

```
Big number:   (cart_coupon_applied + cart_coupon_recovered) /
              (applied + failed + recovered) * 100
              Across ALL codes in the period
              Format: XX.X%

Sub-line 1:   "+X.Xpp vs previous period" or "-X.Xpp vs previous period"
              Green if improved, red if declined
```

#### BOX 3 — Checkout AOV: With vs Without Coupon

```
Big number:   "$[X] with coupon"
              AVG(CheckoutEvent.totalPrice) WHERE sessionId IN
              (sessions with any coupon event) AND checkout_completed
              Format: $XXX

Sub-line 1:   "$[Y] without  ·  [sign]$[Z] difference"
              Y = AVG(totalPrice) WHERE no coupon events AND checkout_completed
              Z = X - Y, green if positive, red if negative

Uses CheckoutEvent.totalPrice (real order value, dollars).
Only completed orders. This is the strategic number — real revenue impact.
```

#### BOX 4 — Abandoned After Coupon Failure

```
Big number:   COUNT(DISTINCT sessionId) WHERE:
              - cart_coupon_failed exists in session
              - failed coupon was last meaningful event (no subsequent apply
                or checkout_started after the failure)
              Format: integer

Sub-line 1:   "[X]% of failed coupon sessions abandoned immediately"

Sub-line 2:   "$[Y] in cart value left behind"
              SUM(cartValue at time of failure) for those sessions (cents/100)
              Format: $X,XXX
```

---

### SECTION: Two charts side by side

#### LEFT — Code Velocity

```
Title:  "Code velocity"
Sub:    "Daily attempt volume by code"

recharts LineChart, height 200px
X axis: dates across range
Y axis: attempt count
Lines:  one per code, top 5 by total attempt volume
        6+ codes: top 5 shown + "Others" grey line for the rest

Line colours (order by volume):
  #0EA5E9, #8B5CF6, #F59E0B, #10B981, #EF4444

Legend below chart: coloured square + code name
Clicking legend item toggles that line

Tooltip on hover: all code values for that date

No area fill under lines — lines only (too cluttered with multiple lines)

Shape badge at rightmost point of each line (10px text, same colour as line):
  Spike:   single peak then drops >70% within 3 days
  Steady:  standard deviation < 30% of mean over the period
  Revived: flat for >7 days then increase >100%
  Dying:   downward trend >50% over the period
```

#### RIGHT — Success Rate by Code

```
Title:  "Success rate by code"
Sub:    "Sorted by attempt volume"

recharts BarChart layout="vertical" (horizontal bars), height 200px
Y axis: code names sorted by attempt volume DESC
X axis: 0% to 100%

Bar colour by success rate:
  >= 50%:  #0EA5E9
  20-49%:  #F59E0B
  < 20%:   #EF4444

Right of bar: "XX%" in matching colour
Below code name: "[X] attempts" in grey 11px

Low data (<5 attempts): grey bar, "Low data", sorted to bottom
```

---

### SECTION: Code table (full width)

```
Title: "All codes"
Sub:   "[X] codes tracked in this period"

Filter bar above table:
  Status: All / Healthy / Degraded / Broken / Low data
  Sort:   Attempts (default) / Success rate / Avg cart / Last seen

Columns:

Status (left border, 3px, no label):
  Green  #22C55E = healthy
  Amber  #F59E0B = degraded
  Red    #EF4444 = broken
  Grey             = low data

Code (monospace 13px, bold if broken/degraded)

Attempts
  COUNT(DISTINCT sessionId) for this code (all attempt types)

Success rate
  (applied + recovered) / attempts * 100
  Colour matches status: green/amber/red text

Avg cart — Success
  AVG(cartValue cents/100) from sessions where code successfully applied
  Format: $XXX

Avg cart — Failed
  AVG(cartValue cents/100) from sessions where code failed, never recovered
  Format: $XXX
  If much lower than success avg: likely minimum order threshold issue
  If similar to success avg: likely product restriction or expired code

Recoveries
  COUNT(DISTINCT sessionId) where couponRecovered = true for this code
  "> 0": "X unlocked" in blue
  "= 0": "—"

Handoff rate
  % of sessions where THIS code failed but session converted anyway
  (with different code or no code at checkout)
  Math: COUNT(sessions: this code failed AND checkout_completed) /
        COUNT(sessions: this code failed) * 100
  Format: XX%
  Tooltip: "X sessions tried [CODE], failed, then converted anyway"
  High handoff = door opener (valuable even though it fails)
  Low handoff = dead end (failure kills the session)

Last seen
  MAX(occurredAt) for this code
  "Today" / "Yesterday" / "Mar 14"

Row click: opens Code Detail panel (right-side sheet, 480px)
```

---

### SECTION: Zombie codes (conditional)

```
Only shown if zombie codes exist.
Collapsed by default. Click header to expand.

Header row (always visible when section exists):
  Background: #FFFBEB
  Border: 1px solid #FDE68A
  Border-radius: 8px
  Padding: 12px 16px
  Text: "⚠ [X] codes tried that don't exist in your store"
  Chevron rotates on expand/collapse

Expanded table columns:
  Code | Attempts | First seen | Last seen

Definition (grey, 13px, shown when expanded):
  "These codes were entered by customers but never applied successfully.
   They may be old codes, typos, or codes from other sources."

Zombie definition:
  Code has 0% all-time success rate (never appears as couponSuccess=true)
  AND attempts >= 3 (filter single-try noise)
```

---

### CODE DETAIL PANEL (right-side sheet, 480px)

```
Slides in from right on row click.
White background, left border 1px #E3E3E3.
Dark overlay behind it.
X close button top-right.

Header:
  Code name (18px weight 600 monospace)
  Status dot + label: "Healthy" / "Degraded" / "Broken"
  "[X] attempts in [date range]"

Section 1 — Velocity trend
  recharts LineChart, 140px
  Two lines: grey = daily attempts, green = daily successes
  Tooltip: "Mar 14: 8 attempts, 3 succeeded"
  When green line flatlines while grey continues = code broke on that day

Section 2 — Stats (2×3 grid of small stats)
  Success rate this period
  Success rate previous period
  Avg cart (successful)
  Avg cart (failed)
  Handoff rate
  Total discount given (SUM discountAmount cents/100)

Section 3 — Cannibalization analysis
  Only shown if this code appears in multi-code sessions

  Title: "Code interactions"

  Sub-metric A: "This code saved X sessions"
    Sessions where another code failed first, then THIS code succeeded
    = this code is a closer

  Sub-metric B: "X sessions continued after this code failed"
    Sessions where THIS code failed and another code succeeded
    Shows which specific codes picked up: "12 converted with PITCHER15"

Section 4 — Product breakdown
  Only shown if product data exists

  Title: "Success rate by product in cart"
  Table: Product | Attempts | Success rate | Note
  Groups by productTitle in lineItems at time of coupon attempt
  Note flags: "Product restriction likely" if 0% on one product, >50% on others

Section 5 — Recovery detail
  Only shown if recoveries > 0

  Title: "[X] customers unlocked this code by adding items"
  2x2 grid:
    Avg cart before | Avg cart after
    Avg increase    | Conv rate after recovery

Section 6 — Recent sessions (last 10)
  Time | Products (truncated) | Cart value | Outcome badge
  "View →" per row → opens Cart Sessions page with that session highlighted
```

---

---

## PAGE 4 — NOTIFICATIONS
**Route:** /couponmaxx/notifications
**API:** /api/couponmaxx/notifications, /api/couponmaxx/settings

---

### PURPOSE LINE
"Alerts when something needs your attention. Configure triggers and channels in Settings."
13px #6B7280.

---

### SECTION: Two tabs

```
Tab 1: "Alerts"    (default)
Tab 2: "Settings"

Active tab:   14px weight 500 #111827, border-bottom 2px #0EA5E9
Inactive tab: 14px weight 400 #6B7280
Tab bar:      border-bottom 1px #E3E3E3
```

---

### TAB 1 — ALERTS

#### Summary bar

```
"[X] unread  ·  [X] critical  ·  [X] warnings"
"Mark all read" link far right, 12px #0EA5E9
```

#### Filter chips

```
All | Critical | Warnings | Info | Dismissed
Default: All
```

#### Alert list

```
Each row:
  Left border: 3px solid — red/amber/blue by severity
  [dot]  [title + body]  [timestamp]  [action link]  [dismiss ×]

  Dot: 8px circle, same colour as border, margin-top 4px
  Title: 13px weight 500 #111827
  Body:  12px #6B7280
  Timestamp: 11px #9CA3AF right-aligned
  Action link: 12px #0EA5E9 "View →"
  Dismiss ×: 14px #9CA3AF, hover red

  Unread: background #FAFAFA
  Read:   background #FFFFFF
  Click row (not ×): marks as read, background changes to #FFFFFF
```

#### Alert definitions

```
CRITICAL (red #EF4444):

1. Broken coupon
   Trigger: >= 10 attempts AND < 10% success in any 2h window
   Title:   "[CODE] may be broken"
   Body:    "[X] attempts, [X]% success in last 2 hours"
   Link:    → /couponmaxx/coupons (code detail panel for that code)

2. CVR drop
   Trigger: checkout CVR > 40% below 7-day baseline for > 30min
   Title:   "Checkout conversion dropped sharply"
   Body:    "CVR is [X]% — baseline is [Y]%"
   Link:    → /couponmaxx/analytics

3. Product-restricted coupon
   Trigger: code succeeds on Product A, fails on Product B,
            >= 5 failures on B in last 24h
   Title:   "[CODE] failing on [product name]"
   Body:    "[X]% success on other products, 0% on [product]"
   Link:    → /couponmaxx/coupons (code detail panel)

4. Zombie code spike
   Trigger: code with 0% all-time success gets >= 5 attempts in 1h
   Title:   "[CODE] being tried but not found in your store"
   Body:    "[X] attempts today, 0% success"
   Link:    → /couponmaxx/coupons (zombie section)

WARNING (amber #F59E0B):

5. Coupon degraded
   Trigger: success rate 20-49%, >= 5 attempts, last 24h
   Title:   "[CODE] success rate is low"
   Body:    "[X]% success across [Y] attempts today"
   Link:    → /couponmaxx/coupons

6. Step dropout spike
   Trigger: dropout at any checkout step > 2x baseline for >= 30min
   Title:   "High dropout at [step]"
   Body:    "[X]% dropping at [step] vs [Y]% baseline"
   Link:    → /couponmaxx/analytics

7. Abandoned after failure surge
   Trigger: > 5 sessions abandoned immediately after coupon fail in 2h
   Title:   "Customers abandoning after coupon failures"
   Body:    "[X] sessions abandoned after a failed code in last 2h"
   Link:    → /couponmaxx/sessions

INFO (blue #0EA5E9):

8. Cart recoveries
   Trigger: >= 3 cart_coupon_recovered events today
   Title:   "[X] cart recoveries today"
   Body:    "[CODE] unlocked [X]x — avg $[X] added to qualify"
   Link:    → /couponmaxx/coupons

9. New traffic source
   Trigger: utmSource not seen in previous 30 days
   Title:   "New traffic source: [source]"
   Body:    "[X] sessions from [source] in last 24h"
   Link:    → /couponmaxx/sessions
```

---

### TAB 2 — SETTINGS

Three sub-sections within the Settings tab.
No separate page — all within the tab, scrollable.

---

#### Sub-section 1: Alert triggers

```
Title: "Alert triggers"
Sub:   "Choose which events send a notification"

One row per alert type:
  [toggle]  [name 13px weight 500]  [description 12px grey]  [threshold if applicable]

Toggle visual:
  ON:  background #0EA5E9, dot right
  OFF: background #E5E7EB, dot left
  36px wide, 20px tall, border-radius 10px, smooth CSS transition

Threshold inputs (inline, for relevant alerts):

  Broken coupon row:
    "Fire when success rate drops below [__]% after [__] attempts"
    Two number inputs, 48px wide, 1px #D1D5DB border, 4px radius
    Defaults: 10% after 10 attempts

  CVR drop row:
    "Fire when CVR drops [__]% below baseline for [__] minutes"
    Defaults: 40% drop, 30 minutes

  Degraded coupon row:
    "Fire when success rate drops below [__]%"
    Default: 50%

Rows (in order):
  [ON]  Broken coupon             [threshold inputs]
  [ON]  CVR drop                  [threshold inputs]
  [ON]  Product-restricted coupon (automatic detection, no threshold)
  [ON]  Zombie code spike         (automatic, no threshold)
  [ON]  Coupon degraded           [threshold input]
  [ON]  Step dropout spike        (automatic)
  [ON]  Abandoned after failure   (automatic)
  [ON]  Cart recoveries           (automatic)
  [OFF] New traffic source        (automatic)

"Save" button: primary blue, right-aligned below list
               Shows Polaris Toast "Settings saved" on success
```

---

#### Sub-section 2: Notification channels

```
Title: "Channels"
Sub:   "Where to send alerts"

Two cards side by side (same card style — white, 1px #E3E3E3, 8px radius):

SLACK CARD:
  Title: "Slack" with Slack logo icon (16px)

  NOT connected state:
    Grey dot + "Not connected"
    "Connect Slack" primary blue button
    Sub: "Alerts will be sent to a Slack channel"
    Click: redirect to Slack OAuth
    URL: https://slack.com/oauth/v2/authorize?
         client_id=[SLACK_CLIENT_ID]&
         scope=incoming-webhook&
         redirect_uri=[APP_URL]/api/couponmaxx/slack/callback

  Connected state:
    Green dot + "Connected"
    Channel: "#[channel-name]"
    "Disconnect" small grey outline button

  Per-alert channel toggles (shown in both states):
    Critical alerts → Slack: [toggle] default ON
    Warnings → Slack:        [toggle] default ON
    Info → Slack:            [toggle] default OFF

EMAIL CARD:
  Title: "Email" with envelope icon (16px)
  Always shown as connected (uses Shopify store owner email)
  Email: "[merchant@email.com]" (from auth session)
  "Change" small link → inline input to override

  Per-alert channel toggles:
    Critical → Email:  [toggle] default ON
    Warnings → Email:  [toggle] default OFF
    Info → Email:      [toggle] default OFF

"Save channels" button: right-aligned, primary blue
```

---

#### Sub-section 3: Weekly digest

```
Title: "Weekly digest"
Sub:   "A summary email sent every Monday morning"

Main toggle [ON/OFF] next to title. Default: ON.

When ON — show:

  Send time row:
    "Every Monday at"  [hour select: 1-12]  :00  [AM/PM select]
    Default: 9 AM

  Timezone row:
    "Sending in [store timezone from Shopify session]"
    "[current time in that timezone]"
    Not editable — read only

  Digest contents (static list, no toggles):
    • Top performing code this week (by rev/session comparison)
    • Codes that need attention (broken or degraded)
    • Cart recoveries count
    • Checkout CVR vs previous week
    • Conversion band insight (where the cart value cliff is)

  Preview button:
    "Preview this week's digest →"
    Opens Polaris Modal (600px wide)
    Shows actual email layout with real data
    Close: X button

"Save digest settings" button: right-aligned, primary blue
```

---

---

# V4 FULL CLAUDE CODE BUILD PROMPT

> Paste everything from here to the end into Claude Code.
> Start fresh session. Paste the whole thing. Go.

---

## BEFORE ANYTHING: READ THESE FILES

```bash
cat SPEC.md
cat CHANGELOG.md
ls app/(embedded)/
ls app/(embedded)/dashboard/
cat app/(embedded)/dashboard/layout.tsx
ls app/api/
npx tsc --noEmit
npm run build
```

Do not write a single file until all six commands are done.
Fix any existing errors before starting.

---

## ABSOLUTE GUARDRAILS — NEVER TOUCH THESE

```
pixel/checkout-monitor.js
extensions/cart-monitor/
extensions/cart-monitor/assets/cart-monitor.js
extensions/cart-monitor/blocks/cart-monitor.liquid
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
app/(embedded)/dashboard/              V1 untouched
app/(embedded)/dashboard/v2/           V2 untouched
app/(embedded)/dashboard/v3/           V3 untouched
All /api/cart/* routes
All /api/v2/* routes
All /api/v3/* routes
shopify.app.toml
vercel.json
```

---

## WHAT YOU ARE BUILDING

```
app/(embedded)/couponmaxx/layout.tsx
app/(embedded)/couponmaxx/analytics/page.tsx
app/(embedded)/couponmaxx/sessions/page.tsx
app/(embedded)/couponmaxx/coupons/page.tsx
app/(embedded)/couponmaxx/notifications/page.tsx

components/couponmaxx/Header.tsx
components/couponmaxx/DateRangePicker.tsx
components/couponmaxx/FilterPill.tsx
components/couponmaxx/KpiBox.tsx
components/couponmaxx/MetricCard.tsx
components/couponmaxx/LineChartInCard.tsx
components/couponmaxx/FunnelChart.tsx
components/couponmaxx/SessionTable.tsx
components/couponmaxx/TimelinePanel.tsx
components/couponmaxx/CodeTable.tsx
components/couponmaxx/CodeDetailPanel.tsx
components/couponmaxx/AlertList.tsx
components/couponmaxx/Toggle.tsx

app/api/couponmaxx/analytics/route.ts
app/api/couponmaxx/sessions/route.ts
app/api/couponmaxx/session/route.ts
app/api/couponmaxx/coupons/route.ts
app/api/couponmaxx/coupons/[code]/route.ts
app/api/couponmaxx/notifications/route.ts
app/api/couponmaxx/notifications/[id]/read/route.ts
app/api/couponmaxx/settings/route.ts
app/api/couponmaxx/slack/callback/route.ts

supabase/shop-slack.sql
supabase/sessionping-utm.sql  (only if not already created)
```

---

## CRITICAL: SHOPIFY NAV — THE V3 BUG AND THE V4 FIX

V3 had the navigation rendered INSIDE the app iframe as a sidebar.
This is wrong. Shopify's embedded apps must use App Bridge to register
nav items in Shopify's NATIVE left sidebar.

### The correct pattern

```typescript
// app/(embedded)/couponmaxx/layout.tsx

import { NavMenu } from '@shopify/app-bridge-react'
import Link from 'next/link'

export default function CouponMaxxLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <NavMenu>
        <Link href="/couponmaxx/analytics" rel="home">
          Analytics
        </Link>
        <Link href="/couponmaxx/sessions">Cart Sessions</Link>
        <Link href="/couponmaxx/coupons">Coupons</Link>
        <Link href="/couponmaxx/notifications">Notifications</Link>
      </NavMenu>
      {children}
    </>
  )
}
```

`<NavMenu>` from @shopify/app-bridge-react communicates with Shopify's
admin shell. The links appear in Shopify's LEFT SIDEBAR, not in your HTML.
You render ZERO sidebar HTML yourself.

`rel="home"` on the first link = default page when app opens.

### Verify the package is installed

```bash
cat package.json | grep app-bridge
```

If @shopify/app-bridge-react is missing:
```bash
npm install @shopify/app-bridge-react
```

### The AppProvider requirement

NavMenu requires an AppProvider ancestor. Read the existing
app/(embedded)/dashboard/layout.tsx — it already has an AppProvider.
The couponmaxx layout nests inside the same shell. Do NOT add another
AppProvider. The existing one covers all embedded routes.

If for any reason the AppProvider is not wrapping couponmaxx routes,
check app/(embedded)/layout.tsx or the root embedded layout.

### Test nav before building pages

After building layout.tsx:
- Deploy or run locally
- Open the app in Shopify admin (not directly in browser)
- Confirm the four nav items appear in Shopify's LEFT SIDEBAR
- Confirm clicking each nav item loads the correct page
- DO NOT PROCEED to building pages until this is confirmed

---

## TECHNOLOGY RULES

```
DB reads:     supabase from '@/lib/supabase' ONLY — never Prisma for queries
Money:        CartEvent.cartValue = CENTS → /100 for display
              CartEvent.discountAmount = CENTS → /100
              CheckoutEvent.totalPrice = DOLLARS → use as-is
Tables:       "CartEvent" "CheckoutEvent" "Shop" "AlertLog" "SessionPing"
              — case sensitive, always quote in Supabase queries
Charts:       recharts only — never install new chart libraries
TypeScript:   npx tsc --noEmit must pass before every commit
Build:        npm run build must pass before every commit
Data fetch:   SWR for all page data
              Always: const { data, error, isLoading, mutate } = useSWR(...)
              Never leave error silently unhandled
              Never show blank page — skeleton or empty state always
Timezone:     Merchant timezone from Shopify session (useAppBridge or shop data)
              All absolute times displayed in merchant's store timezone
              Use Intl.DateTimeFormat for formatting
Numbers:      Math.round() or .toFixed(1) on ALL displayed numbers
              Never let JS float math reach the screen unrounded
```

---

## UI STYLE — NON-NEGOTIABLE — MATCH ALIA EXACTLY

```
Page background:  #F1F1F1
Card background:  #FFFFFF
Card border:      1px solid #E3E3E3
Card radius:      8px
Card padding:     20px
Card shadow:      NONE

Chart colour:     #0EA5E9  (exact hex — not approximations)
Chart fill:       rgba(14, 165, 233, 0.08)
Grid lines:       NONE on any chart — set grid={false} on recharts axes
Chart heights:    140px (in-card), 200px (section), 280px (funnel)

Type scale:
  Page title:     20px 600 #111827
  Card title:     14px 500 #1A1A1A
  Definition:     13px 400 #6B7280 (one line)
  Big number:     32px 700 #111827
  Axis label:     11px 400 #9CA3AF
  Body:           13px 400 #374151

Spacing:
  Page padding:   24px sides, 20px top/bottom
  Card gap:       16px
  Section gap:    24px

Grid:
  Two cards/row:  grid-template-columns: 1fr 1fr; gap: 16px
  Full width:     grid-template-columns: 1fr

DO NOT use Polaris Card for metric cards
DO NOT use Polaris DataTable for session or code tables
DO NOT render any sidebar HTML

DO use Polaris for:
  Page (title wrapper)
  Banner (error states)
  Toast (save confirmations)
  Spinner (loading within components)
  Modal (overlays like digest preview)
```

---

## HEADER COMPONENT

```typescript
// components/couponmaxx/Header.tsx
// Renders inside the page content area — NOT a sidebar

// Visual spec:
// Full width, white, 56px tall, border-bottom 1px solid #E3E3E3
// Left: [32px square logo placeholder] [CouponMaxx 15px 600 #111827]
// Center (absolute): "Use the menu on the left to navigate" 13px #9CA3AF
// Right: [Live pill] [store name 13px #374151]

// Live pill:
//   background #F0FDF4, border 1px solid #BBF7D0, radius 20px, padding 4px 10px
//   Pulsing dot: 8px circle #22C55E, CSS animation pulse 2s infinite
//   "Live" 12px #15803D weight 500
//   @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }

// Logo placeholder: 32x32px, radius 6px, background #0EA5E9
// Developer replaces with actual SVG — leave a comment saying so

// Store name: read from Shopify session / useAppBridge
// No dropdown on store name — static text only
```

---

## DATE RANGE PICKER COMPONENT

```typescript
// components/couponmaxx/DateRangePicker.tsx
// Props: value: {start: Date, end: Date}, onChange: (range) => void
// defaultValue: last 30 days

// Visual: pill button showing "Last 30 days  Feb 14 – Mar 16  ▾"
// Calendar icon (Heroicons, 16px) + text + chevron
// Background white, border 1px #D1D5DB, radius 6px, padding 6px 12px

// Dropdown (opens below pill):
//   Options: Last 7 days / Last 30 days / Last 90 days / Last 12 months / Custom
//   Active option: blue text #1D4ED8, checkmark right
//   Custom: shows two date inputs (start, end)

// Persist in URL query params: ?start=ISO&end=ISO
// So browser back button preserves the selected range

// Used identically on all 4 pages
```

---

## API ROUTES — BUILD THESE FIRST, TEST WITH CURL

### /api/couponmaxx/analytics

```typescript
// GET — params: shop, start, end, product?, device?, utmSource?
// Returns:
{
  couponSuccessRate: {
    average: number,           // 0-100
    daily: { date: string, value: number }[]
  },
  cartsWithCoupon: {
    average: number,
    daily: { date: string, value: number }[]
  },
  attributedSales: {
    // Pre-fetched for all window + pre/post variants
    // Client switches between them
    preDiscount14: { total: number, daily: { date: string, value: number }[] },
    postDiscount14: { total: number, daily: { date: string, value: number }[] },
    preDiscount7:  { total: number, daily: { date: string, value: number }[] },
    postDiscount7:  { total: number, daily: { date: string, value: number }[] },
    preDiscount30: { total: number, daily: { date: string, value: number }[] },
    postDiscount30: { total: number, daily: { date: string, value: number }[] },
    preDiscount1:  { total: number, daily: { date: string, value: number }[] },
    postDiscount1:  { total: number, daily: { date: string, value: number }[] },
  },
  cartViews: {
    total:       { total: number, daily: { date: string, value: number }[] },
    withProducts:{ total: number, daily: { date: string, value: number }[] },
    checkouts:   { total: number, daily: { date: string, value: number }[] }
  },
  funnel: {
    cartViews:         number,
    cartsWithProducts: number,
    couponsAttempted:  number,
    couponsApplied:    number,
    couponsFailed:     number,
    reachedCheckout:   number,
    // For line chart mode:
    daily: {
      date: string,
      cartViews: number,
      cartsWithProducts: number,
      couponsAttempted: number,
      couponsApplied: number,
      couponsFailed: number,
      reachedCheckout: number
    }[]
  }
}
```

### /api/couponmaxx/sessions

```typescript
// GET — params: shop, start, end, page=1, country?, device?,
//              product?, minCart?, maxCart?, coupon?, outcome?,
//              boxFilter?: 'all'|'products'|'coupon'|'checkout'
// Returns:
{
  boxes: {
    cartsOpened: number,
    emptyCount: number,
    withProducts: number,
    withProductsPct: number,
    couponAttempted: number,
    couponAttemptedPct: number,
    reachedCheckout: number,
    reachedCheckoutPct: number,
    checkoutWithCoupon: number,
    checkoutWithoutCoupon: number
  },
  sessions: CartSessionRow[],
  total: number,
  page: number,
  perPage: 25,
  scopedCounts: {
    showing: number,
    checkoutRate: number,
    completionRate: number
  }
}
```

### /api/couponmaxx/session

```typescript
// GET — params: shop, sessionId
// Returns: { session: CartSessionRow, timeline: TimelineEvent[] }
// TimelineEvent: merged CartEvent + CheckoutEvent sorted by occurredAt ASC
```

### /api/couponmaxx/coupons

```typescript
// GET — params: shop, start, end
// Returns:
{
  boxes: {
    codesTracked: number,
    brokenCount: number,
    degradedCount: number,
    healthyCount: number,
    couponSuccessRate: number,
    couponSuccessRateDelta: number,
    aovWithCoupon: number,       // dollars
    aovWithoutCoupon: number,    // dollars
    abandonedAfterFail: number,
    abandonedAfterFailPct: number,
    abandonedCartValue: number   // dollars
  },
  velocityChart: {
    codes: string[],             // top 5 by volume
    daily: { date: string, [code: string]: number }[]
  },
  successRateChart: {
    code: string,
    attempts: number,
    successRate: number,
    status: 'healthy'|'degraded'|'broken'|'low_data'
  }[],
  codes: CodeTableRow[],
  zombieCodes: ZombieCode[]
}
```

### /api/couponmaxx/coupons/[code]

```typescript
// GET — params: shop, start, end
// Returns: code detail panel data
// velocity trend, stats grid, cannibalization, product breakdown,
// recovery detail, recent sessions
```

### /api/couponmaxx/notifications

```typescript
// GET — params: shop, start, end, severity?
// Returns: { summary: {...}, alerts: NotificationAlert[] }

// POST /[id]/read
// Body: { shop }
// Edge cases:
//   Alert not found → 404
//   Wrong shop → 403
//   Already read → 200 (idempotent)
//   DB error → 500
```

### /api/couponmaxx/settings

```typescript
// GET — params: shop → returns current settings or defaults
// POST — body: { shop, settings } → saves to Shop.notificationSettings JSONB
```

### /api/couponmaxx/slack/callback

```typescript
// GET — params: code, shop (from state param)
// Exchange code for Slack webhook URL
// Store in Shop.slackWebhookUrl and Shop.slackChannelName
// Redirect to /couponmaxx/notifications
```

---

## DB CHANGES — RUN MANUALLY IN SUPABASE SQL EDITOR

Create file supabase/shop-slack.sql:

```sql
ALTER TABLE "Shop"
ADD COLUMN IF NOT EXISTS "slackWebhookUrl" text,
ADD COLUMN IF NOT EXISTS "slackChannelName" text,
ADD COLUMN IF NOT EXISTS "notificationSettings" jsonb,
ADD COLUMN IF NOT EXISTS "notificationEmail" text;
```

Print reminder at end of session:
"Run supabase/shop-slack.sql in Supabase SQL editor before testing notifications."

Also check if supabase/sessionping-utm.sql exists and has been run.
If not: create it and print the same reminder.

```sql
ALTER TABLE "SessionPing"
ADD COLUMN IF NOT EXISTS "utmSource" text,
ADD COLUMN IF NOT EXISTS "utmMedium" text,
ADD COLUMN IF NOT EXISTS "utmCampaign" text;
```

---

## VERSION ROUTING

Update middleware.ts to add v4 routing.
Read the existing middleware.ts first. Add v4 to the existing destinations map.

```typescript
const destinations: Record<string, string> = {
  v1: '/dashboard/...',        // whatever V1 route currently is
  v2: '/dashboard/v2/overview',
  v3: '/dashboard/v3/overview',
  v4: '/couponmaxx/analytics',  // ADD THIS
}
```

Do not change any existing routing. Only add the v4 entry.

---

## BUILD SEQUENCE — FOLLOW IN ORDER

```
1.  Read all files listed in STEP 0 above
2.  Verify clean build — fix ALL errors before starting
3.  npm install @shopify/app-bridge-react if missing
4.  Create supabase SQL files (do not run them — print reminder)
5.  Build shared components: DateRangePicker, FilterPill, KpiBox,
    MetricCard, LineChartInCard, Toggle, Header
    No page-specific logic in shared components — props only
6.  Build layout.tsx with NavMenu
    STOP — test that nav appears in Shopify left sidebar
    DO NOT BUILD PAGES until nav is confirmed working
7.  Build ALL API routes
    Test each with curl after building — confirm response shape
    Fix data issues before building UI
8.  Build Page 1 — Analytics
    Wire all filter state (product, device, utmSource)
    Wire compare-to dashed line
    Wire all card title dropdowns
    Wire funnel column selector + bar/line toggle
9.  Build Page 2 — Cart Sessions
    Wire box filters + filter bar compounding
    Build timeline panel (right-side sheet)
10. Build Page 3 — Coupons
    Build velocity chart (multi-line)
    Build success rate horizontal bar chart
    Build code table with status left borders
    Build zombie codes collapsible section
    Build code detail panel (right-side sheet)
11. Build Page 4 — Notifications
    Build alert list + severity colours + dismiss
    Build Settings tab:
      Trigger toggles with threshold inputs
      Slack OAuth flow
      Email channel
      Weekly digest + preview modal
12. Update middleware.ts — add v4 routing
13. npx tsc --noEmit — fix ALL errors, zero allowed
14. npm run build — fix ALL errors
15. Test every page with real drwater data
16. Confirm nav in Shopify left sidebar (critical — must verify)
17. git add -A
    git commit -m "feat: CouponMaxx V4 — Analytics, Cart Sessions, Coupons,
    Notifications — Shopify App Store submission build"
    git push
```

---

## EMPTY STATES — EVERY CHART AND TABLE REQUIRES ONE

```
No data in period:
  Icon: chart outline SVG (simple, 40px, #D1D5DB)
  Title: "No data in this period"    14px weight 500 #374151
  Body:  appropriate message          13px #6B7280

Page-specific messages:
  Analytics:     "Cart data will appear once customers visit the store."
  Cart Sessions: "Sessions will appear once customers add products to cart."
  Coupons:       "Coupon attempts will appear once customers try discount codes."
  Notifications: "Alerts fire automatically when anomalies are detected."

API error (SWR error state):
  Polaris Banner tone="critical"
  "Couldn't load data — refresh the page or try again."

Chart with sparse data (< 5 points):
  Show the data anyway — do NOT hide it
  Add label below chart: "Based on [X] sessions"
  Never replace real data with an empty state just because it's small
```

---

## ENV VARS NEEDED IN VERCEL

Print this reminder at the end of the session:

```
Add these to Vercel environment variables:

SLACK_CLIENT_ID=        (from your Slack app at api.slack.com/apps)
SLACK_CLIENT_SECRET=    (same Slack app)
DASHBOARD_VERSION=v4    (switches the app to CouponMaxx)

Also run in Supabase SQL editor:
  supabase/shop-slack.sql
  supabase/sessionping-utm.sql  (if not already run)
```

---

## SUBMISSION CHECKLIST

Before pushing and setting DASHBOARD_VERSION=v4:

```
Navigation:
  [ ] Nav appears in Shopify LEFT SIDEBAR — not inside the app frame
  [ ] All 4 nav items visible
  [ ] Clicking each nav item loads correct page
  [ ] Active nav item highlighted in Shopify's native UI

Pages:
  [ ] Analytics page loads with real data
  [ ] Cart Sessions page loads, filters work, timeline panel opens/closes
  [ ] Coupons page loads, code detail panel opens/closes
  [ ] Notifications Alerts tab shows alerts
  [ ] Notifications Settings tab: toggles save, Slack connect works

Data:
  [ ] All monetary values divided by 100 (no 12499 showing instead of $124.99)
  [ ] All percentages rounded to 1 decimal place
  [ ] All timestamps in merchant's store timezone

Build:
  [ ] npx tsc --noEmit — zero errors
  [ ] npm run build — clean
  [ ] No console errors in browser

Empty states:
  [ ] Each page shows correct empty state with no data
  [ ] Error banners show when API fails
  [ ] No blank/white pages under any condition

Shopify requirements (for submission):
  [ ] App works on a NEW store (not just drwater)
  [ ] No hardcoded store references anywhere
  [ ] GDPR webhooks return 200 (check app/api/webhooks/)
  [ ] Uninstall webhook deactivates the shop
  [ ] Privacy policy URL configured in Partner Dashboard
  [ ] Support URL configured in Partner Dashboard
```

---

## CHANGELOG ENTRY — APPEND BEFORE ENDING SESSION

```markdown
## [DATE]: CouponMaxx V4 — Shopify App Store submission build

**What changed:** Complete CouponMaxx app at /couponmaxx/*.
This is the version being submitted to Shopify App Store.

**Critical nav fix:** V3 nav was rendered inside the app frame.
V4 uses NavMenu from @shopify/app-bridge-react — nav is in Shopify's
native left sidebar.

**Pages built:**
- /couponmaxx/analytics — Header, date range, 3 filters, 4 metric cards
  (coupon success rate, carts with coupon, attributed sales with dropdowns,
  cart views with switcher), coupon funnel with bar/line toggle + column selector
- /couponmaxx/sessions — 4 KPI boxes (clickable filters), filter bar,
  session table (time/country/device/source/products/cart value/coupons/outcome),
  timeline right-side panel
- /couponmaxx/coupons — 4 KPI boxes, code velocity multi-line chart,
  success rate horizontal bar chart, code table with colour left borders,
  zombie codes collapsible section, code detail right-side panel with
  cannibalization analysis
- /couponmaxx/notifications — Alert feed with severity colours + dismiss,
  Settings tab with trigger thresholds + Slack OAuth + email + weekly digest

**DB changes (run in Supabase SQL editor):**
  supabase/shop-slack.sql
  supabase/sessionping-utm.sql

**New env vars needed:**
  SLACK_CLIENT_ID
  SLACK_CLIENT_SECRET
  DASHBOARD_VERSION=v4

**Files created:** [list all files]

**Version routing:** middleware.ts updated — DASHBOARD_VERSION=v4 routes
to /couponmaxx/analytics
```
