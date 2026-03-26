# CouponMaxx — UI Spec
> Page-by-page build spec. Written to match Alia's UI exactly.
> Claude Code reads this before writing a single line.
> Updated as each page is defined. Current: Page 1 — Analytics.

---

## GUARDRAILS — READ BEFORE ANYTHING

### Never touch these files
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
All existing /dashboard/* routes (V1, V2, V3)
All existing /api/cart/*, /api/v2/*, /api/v3/* routes
```

### What you are building
```
New layout:   app/(embedded)/couponmaxx/layout.tsx
New pages:    app/(embedded)/couponmaxx/analytics/page.tsx    (Page 1 — this spec)
              app/(embedded)/couponmaxx/sessions/page.tsx     (Page 2 — TBD)
              app/(embedded)/couponmaxx/discounts/page.tsx    (Page 3 — TBD)
              app/(embedded)/couponmaxx/notifications/page.tsx (Page 4 — TBD)

New API:      app/api/couponmaxx/analytics/route.ts
              (additional routes added per page)
```

### Technology rules
```
DB reads:        Supabase JS client only — import { supabase } from '@/lib/supabase'
Money:           CartEvent.cartValue and discountAmount = CENTS (divide by 100)
                 CheckoutEvent.totalPrice = DOLLARS (use as-is)
Tables:          "CartEvent", "CheckoutEvent", "Shop", "SessionPing" — case sensitive
Charts:          recharts only — already installed, do not add new libraries
TypeScript:      npx tsc --noEmit must pass clean before every commit
Build:           npm run build must pass clean before every commit
Polaris:         Use for layout shell, nav, badges only
                 Do NOT use Polaris for the analytics cards or charts
                 Custom components match Alia's visual style exactly
```

---

## UI STYLE SYSTEM — MATCH ALIA EXACTLY

Study the Alia screenshot provided. Every pixel of the CouponMaxx analytics
pages must match this aesthetic. This section defines every visual rule.

### Colours
```
Background (app body):     #F1F1F1  (light grey page background)
Card background:           #FFFFFF  (white)
Card border:               1px solid #E3E3E3
Header bar background:     #FFFFFF
Header bar border-bottom:  1px solid #E3E3E3
Primary text:              #1A1A1A
Secondary text:            #6B7280  (grey, used for definitions and labels)
Axis labels:               #9CA3AF  (lighter grey)
Chart line colour:         #0EA5E9  (Alia's teal-blue — use exactly this)
Chart fill (under line):   rgba(14, 165, 233, 0.08)  (very faint teal fill)
Live dot:                  #22C55E  (green)
Live pill background:      #F0FDF4
Live pill text:            #15803D
Live pill border:          1px solid #BBF7D0
Filter pill background:    #FFFFFF
Filter pill border:        1px solid #D1D5DB
Filter pill text:          #374151
Filter pill hover bg:      #F9FAFB
Active filter bg:          #EFF6FF
Active filter border:      1px solid #BFDBFE
Active filter text:        #1D4ED8
Page title text:           #111827  weight 600  size 20px
```

### Typography
```
Font:                system-ui, -apple-system, sans-serif (no custom fonts)
Page title:          20px, weight 600, color #111827
Card title:          14px, weight 500, color #1A1A1A
Card definition:     13px, weight 400, color #6B7280
Card big number:     32px, weight 700, color #111827 (dollars get $prefix)
Card big number      (percentage): 32px, weight 700, color #111827, suffix %
Axis labels:         11px, weight 400, color #9CA3AF
Filter label:        13px, weight 500, color #374151
Section title:       15px, weight 600, color #111827
Funnel tooltip:      12px, weight 500, white text on dark tooltip
```

### Spacing
```
Page padding:        24px left/right, 20px top/bottom
Card padding:        20px all sides
Card gap (grid):     16px
Card border-radius:  8px
Filter pill padding: 6px 12px
Filter pill gap:     8px
Filter pill radius:  6px
Header height:       56px
Header padding:      0 24px
```

### Cards
```
Two cards per row in a CSS grid: grid-template-columns: 1fr 1fr; gap: 16px
Each card:
  background: #FFFFFF
  border: 1px solid #E3E3E3
  border-radius: 8px
  padding: 20px
  no box-shadow

Card internal layout (top to bottom):
  Row 1: card title (left) + "..." overflow button (right)  — both same line
  Row 2: definition text (grey, 13px, one line)
  Row 3: big number (32px bold) — this is the AVERAGE or TOTAL for the period
  Row 4: chart (line chart, no card wrapper, flows directly below the number)

Card title has a chevron (▾) after the text only if there's a dropdown.
If no dropdown: title with no chevron.
"..." button: 3 dots, no border, hover shows grey background, top-right of card.
```

### Line charts (inside cards)
```
Library:             recharts LineChart
Height:              140px (fixed for all in-card charts)
Left Y-axis:         labels showing scale (e.g. 20%, 15%, 10%, 5%, 0%)
                     or ($1.6k, $1.2k, $800, $400, $0)
                     Calculated dynamically from data range
                     5 ticks maximum
Bottom X-axis:       date labels (e.g. 2/16, 2/20, 2/24, 2/28, 3/04, 3/08, 3/12, 3/16)
                     Show approximately 8 labels across the range
                     Format: M/DD (no year)
No top/right axes
No grid lines        (Alia has no horizontal grid lines — clean look)
Line:                color #0EA5E9, strokeWidth 1.5, no dots on data points
Fill:                area fill under line, color rgba(14,165,233,0.08)
Tooltip:             shows date + value on hover, white card, small shadow
Chart margins:       top: 8, right: 8, bottom: 8, left: 40
```

### Funnel / Bar chart (full-width card)
```
Library:             recharts BarChart
Height:              280px
Bars:                color #0EA5E9, radius [4,4,0,0] (rounded top corners)
Tooltip on bar:      floating label showing "Label: VALUE  PERCENT%"
                     Dark background (#1F2937), white text, border-radius 6px
                     Positioned above bar center
Bar gap:             barCategoryGap="40%" (space between bar groups)
X-axis:              category labels below each bar, 13px grey
Y-axis:              left side, numeric scale, 11px grey
No grid lines
```

### Header bar
```
Full width, white, 56px tall, border-bottom 1px solid #E3E3E3
Fixed at top of the embedded app content area

Left side:
  Square logo placeholder (32×32px, border-radius 6px, background #0EA5E9)
  → developer replaces this with actual SVG logo mark
  "CouponMaxx" wordmark next to it, 15px weight 600 #111827

Center:
  "Use the menu on the left to navigate"
  13px, #9CA3AF, absolutely centered

Right side:
  Green "Live" pill:
    background #F0FDF4, border 1px solid #BBF7D0, border-radius 20px
    padding 4px 10px
    Pulsing green dot (8px circle, #22C55E, CSS animation: pulse 2s infinite)
    "Live" text 12px #15803D weight 500
    6px gap between dot and text
  "Dr.Water" text: 13px #374151 weight 500, margin-left 12px
  No dropdown on the store name — static text only
```

### Page title row
```
Sits below header, above filters
Left: "Analytics" — 20px weight 600 #111827

Right (inline flex, gap 8px):
  Date range pill:
    Calendar icon (16px) + date range text + chevron
    e.g. "Last 30 days  Feb 14 – Mar 16  ▾"
    background white, border 1px solid #D1D5DB, radius 6px, padding 6px 12px
    13px #374151
    Clicking opens a date picker dropdown

  "Compare to" pill:
    Same visual style as date range pill
    Shows "Compare to ▾" — clicking opens options:
      Previous period / Previous year / Custom
    When active: shows comparison data as dashed line on all charts

  No "Settings" pill — Alia has one, CouponMaxx does not
  No "..." overflow on this row
```

### Filter row
```
Label: "Add filters" — 13px weight 500 #374151, margin-right 12px

Three filter pills (horizontal flex, gap 8px):
  1. Product
  2. Device type
  3. UTM source

Each filter pill:
  Shows icon + label + chevron
  Icons:
    Product:     grid/box icon (Heroicons outline)
    Device type: device icon
    UTM source:  cursor/click icon
  Default state: background white, border 1px solid #D1D5DB, 13px #374151
  Active state:  background #EFF6FF, border 1px solid #BFDBFE, 13px #1D4ED8
                 Shows selected value in pill text instead of label
  Clicking opens dropdown with options

No "More filters" collapse — just these 3 pills always visible

Filter behavior:
  All charts and metrics on the page respond to active filters
  Multiple filters can be active simultaneously
  Each active filter narrows the dataset for all metrics
  Clear individual filter by clicking X on active pill
  Clear all: link appears when any filter is active
```

---

## PAGE 1 — ANALYTICS
**Route:** /couponmaxx/analytics
**API:** /api/couponmaxx/analytics

---

### SECTION: Page title row

```
Left:  "Analytics"  (20px weight 600 #111827)
Right: [date range pill]  [Compare to pill]
```

Date range options (dropdown from the date range pill):
```
Last 7 days
Last 30 days   ← default
Last 90 days
Last 12 months
Custom range   → shows date picker
```

When a range is selected, pill text updates to:
"Last 30 days  Feb 14 – Mar 16  ▾"
Dates show the actual start and end dates of the selected range.

Compare to options:
```
No comparison   ← default (no dashed line)
Previous period
Previous year
```

When compare-to is active, all line charts show a second dashed grey line
for the comparison period. Tooltip shows both values on hover.

---

### SECTION: Filter row

Three filter pills. Values for each:

**Product filter**
Dropdown options: All products (default) + distinct productTitles from
CartEvent.lineItems JSON for this shopId, sorted by frequency DESC.
When active: filters all metrics to sessions containing that product.

**Device type filter**
Dropdown options: All devices (default) / Desktop / Mobile / Tablet
Source field: CartEvent.device
When active: filters to sessions from that device type.

**UTM source filter**
Dropdown options: All sources (default) + distinct utmSource values from
SessionPing.utmSource for this shopId, sorted by frequency DESC.
Derived display names:
  null or empty → "Direct"
  "google" or "bing" → "Paid search"
  "instagram" or "facebook" or "tiktok" → "Social"
  "klaviyo" or "email" → "Email"
  anything else → raw utmSource value
When active: filters to sessions with that utmSource.

---

### ROW 1 — Two cards side by side

---

#### CARD 1 — Coupon Success Rate

```
Title:       "Coupon success rate"
             No chevron dropdown — static title
Definition:  "Percent of coupon applications that were successfully applied"
             (one line, grey, 13px — exactly like Alia's single-line definitions)

Big number:  Average coupon success rate across the selected date range
             Format: XX.X%   (e.g. "67.3%")
             This is the AVERAGE of the daily rates across the period

Math:
  Numerator:   COUNT(CartEvent rows) WHERE eventType = 'cart_coupon_applied'
               AND occurredAt IN range AND shopId = shop
               AND [active filters applied]
  Denominator: COUNT(CartEvent rows) WHERE eventType IN
               ('cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered')
               AND occurredAt IN range AND shopId = shop
               AND [active filters applied]
  Rate:        numerator / denominator * 100
  Big number:  average of daily rates across the range
               (not total/total — average of each day's rate)

Chart:
  Type:        Line chart (recharts)
  X axis:      dates across the selected range
  Y axis:      percentage scale (0% to max+5%)
  One data point per day: that day's coupon success rate
  Line colour: #0EA5E9
  Fill:        rgba(14,165,233,0.08)
  Tooltip:     "Mar 14: 71.2%"

Compare-to:
  When compare period active: second dashed grey line showing previous
  period's daily rates. Tooltip shows both.

Empty state:
  If no coupon events in range: show "No coupon data in this period"
  in place of the big number and chart, same grey text style as definition.
```

---

#### CARD 2 — Carts with Coupon Applied

```
Title:       "Carts with coupon applied"
             No chevron dropdown — static title
Definition:  "Percent of product carts where a coupon code was attempted"

Big number:  Average percentage across the selected date range
             Format: XX.X%   (e.g. "44.0%")

Math:
  Numerator:   COUNT(DISTINCT sessionId) FROM CartEvent
               WHERE eventType IN ('cart_coupon_applied','cart_coupon_failed',
               'cart_coupon_recovered') AND occurredAt IN range
               AND shopId = shop AND [active filters]
  Denominator: COUNT(DISTINCT sessionId) FROM CartEvent
               WHERE (cartValue > 0 OR cartItemCount > 0)
               AND occurredAt IN range AND shopId = shop
               AND [active filters]
  Rate:        numerator / denominator * 100
  Big number:  average of daily rates across the range

Chart:
  Same format as Card 1 — line chart, same colours
  One point per day: that day's percentage
  Y axis: percentage scale
  Tooltip: "Mar 14: 44.0%"

Compare-to: same dashed line behaviour as Card 1

Empty state: "No cart data in this period"
```

---

### ROW 2 — Two cards side by side

---

#### CARD 3 — Attributed Sales

```
Title:       "Attributed sales  ▾  14 days  ▾  Pre-discount  ▾"
             THREE separate inline dropdowns in the title area
             Exactly like Alia's "Attributed sales ▾  14 days ▾  Pre-discount ▾"

Dropdown 1 — "Attributed sales" label (static, no dropdown — just the name)
  Actually: just the label text, no dropdown here

Dropdown 2 — Attribution window
  Options: 1 day / 7 days / 14 days (default) / 30 days
  Shows: "14 days ▾"
  Changes which checkout_completed events count as attributed
  Attribution logic: checkout_completed occurred within [window] days
  after ANY cart event (first touch) for that session

Dropdown 3 — Pre-discount or Post-discount
  Options: Pre-discount (default) / Post-discount
  Pre-discount:  SUM of CartEvent.cartValue at checkout click (cents/100)
                 for attributed sessions
  Post-discount: SUM of CheckoutEvent.totalPrice for attributed sessions
                 (this is the actual amount charged)

Definition:
  Pre-discount:  "Total pre-discount cart value from sessions with a coupon,
                  within the attribution window"
  Post-discount: "Total post-discount revenue from sessions with a coupon,
                  within the attribution window"

Big number:
  Total attributed sales for the period
  Format: $XX,XXX  (e.g. "$22,928")
  This is a SUM not an average — total for the whole date range

Math (pre-discount, 14-day window):
  Find all sessions in the date range that:
    1. Had at least one coupon event (applied, failed, or recovered)
    2. Had a checkout_completed event within 14 days of first cart event
  Sum CartEvent.cartValue (cents/100) at the checkout click moment
  for all those sessions

Chart:
  Line chart — same format
  X axis: dates
  Y axis: dollar amounts (format: $1.6k, $1.2k, $800, $400, $0)
  One point per day: attributed sales total for that day
  Tooltip: "Mar 14: $1,240"

Compare-to: dashed line for previous period

Empty state: "No attributed sales in this period"
```

---

#### CARD 4 — Cart Views

```
Title:       "Cart views  ▾"
             ONE dropdown in the title — switches the metric displayed

Dropdown options:
  Cart views        ← default (total carts opened)
  Carts with products
  Checkouts

When "Cart views" selected:
  Definition:  "Total number of cart sessions opened"
  Big number:  COUNT(DISTINCT sessionId) FROM CartEvent
               WHERE occurredAt IN range AND shopId = shop
               AND [active filters]
               Format: 12,082 (integer, no prefix)

When "Carts with products" selected:
  Definition:  "Sessions where at least one product was in the cart"
  Big number:  COUNT(DISTINCT sessionId) WHERE cartValue > 0 OR cartItemCount > 0

When "Checkouts" selected:
  Definition:  "Sessions that reached Shopify checkout"
  Big number:  COUNT(DISTINCT sessionId) WHERE cart_checkout_clicked exists
               OR sessionId in CheckoutEvent with checkout_started

Chart:
  Line chart — same format
  Shows the selected metric as a daily count
  Y axis: numeric (format: 800, 600, 400, 200, 0)
  Tooltip: "Mar 14: 423"

Compare-to: dashed line for previous period

Empty state: "No cart data in this period"
```

---

### ROW 3 — Coupon Funnel (full width card)

```
Title (top left):  "Coupon funnel"
                   15px weight 600 #111827

Controls (top right, inline flex, gap 8px):
  Column selector dropdown:
    Shows currently visible columns e.g. "Cart views, Carts with products (+4)  ▾"
    Clicking opens a multi-select checklist of all available columns
    Checked columns appear in the chart
    All checked by default

  Chart type toggle:
    "Bar" button (active by default — filled/highlighted)
    "Line" button
    Clicking switches between bar chart and line chart for the funnel

  "⇄" sort/settings icon (static button, opens column reorder — future feature,
      for now just show the icon without functionality)

Available columns (all visible by default, in this order):
  1. Cart views              — COUNT(DISTINCT sessionId) all sessions
  2. Carts with products     — sessions where cartValue > 0 OR cartItemCount > 0
  3. Coupons attempted       — sessions with any coupon event
  4. Coupons applied         — sessions with cart_coupon_applied event
  5. Coupons failed          — sessions with cart_coupon_failed (never recovered)
  6. Reached checkout        — sessions with cart_checkout_clicked or checkout_started

Note on "Coupons attempted":
  This is the TOTAL of all coupon interactions regardless of success.
  Count = sessions with any of: applied, failed, or recovered events.

Note on "Coupons applied":
  Successfully applied = cart_coupon_applied OR cart_coupon_recovered
  (recovered = ultimately successful even if failed first)

Note on "Coupons failed":
  Sessions where cart_coupon_failed exists AND no subsequent
  cart_coupon_applied or cart_coupon_recovered for the same code in the session.
  i.e. the code stayed broken for that session.

BAR CHART mode (default):
  One bar per column.
  Bars decrease in height left to right (funnel shape).
  Each bar colour: #0EA5E9
  Bar border-radius: 4px top corners only
  Floating tooltip on each bar:
    "[Column label]: [VALUE]  [PERCENT]%"
    Percent = this column's value / Cart views * 100
    Tooltip: dark background #1F2937, white text, 12px
    Positioned: above center of bar
  X axis: column labels below each bar
  Y axis: numeric scale on left

LINE CHART mode:
  When switched to line mode:
  Each selected column becomes its own line in a different colour.
  Colour palette for lines (in order):
    #0EA5E9 (teal-blue)
    #8B5CF6 (purple)
    #F59E0B (amber)
    #10B981 (green)
    #EF4444 (red)
    #F97316 (orange)
  X axis: dates across the selected range
  Y axis: count scale
  Legend below chart: coloured square + label for each active line
  Tooltip: shows all active column values for the hovered date

When columns are deselected via the dropdown:
  Bar mode: that bar disappears, remaining bars reflow
  Line mode: that line disappears from chart and legend

Height: 280px (chart area only, not including card padding)
```

---

## API ROUTE SPEC — /api/couponmaxx/analytics

```typescript
// GET /api/couponmaxx/analytics
// Query params: shop, start, end, product?, device?, utmSource?, compareTo?

// Response shape:
{
  couponSuccessRate: {
    average: number,              // percentage 0-100, average of daily rates
    daily: { date: string, value: number }[],
    comparison?: { date: string, value: number }[]  // if compareTo active
  },
  cartsWithCoupon: {
    average: number,              // percentage
    daily: { date: string, value: number }[],
    comparison?: { date: string, value: number }[]
  },
  attributedSales: {
    total: number,                // dollars (already converted from cents)
    daily: { date: string, value: number }[],
    comparison?: { date: string, value: number }[]
    // Note: window and pre/post params handled client-side via separate
    // API call when dropdowns change — do not bundle all variants
  },
  cartViews: {
    // All three variants pre-fetched — client switches between them
    total: { total: number, daily: { date: string, value: number }[] },
    withProducts: { total: number, daily: { date: string, value: number }[] },
    checkouts: { total: number, daily: { date: string, value: number }[] },
    comparison?: { ... }
  },
  funnel: {
    // All 6 columns — client shows/hides based on selection
    cartViews: number,
    cartsWithProducts: number,
    couponsAttempted: number,
    couponsApplied: number,
    couponsFailed: number,
    reachedCheckout: number
    // Funnel shows totals for the date range, not daily breakdown
    // Line chart mode will need daily breakdown — add daily arrays per column
  }
}
```

### Filter application in queries

All queries must apply active filters:

Product filter:
```typescript
// If product filter active:
// Only include sessionIds where lineItems JSONB contains the selected productTitle
// Use Supabase .contains() or a subquery
```

Device filter:
```typescript
// If device filter active:
.eq('device', selectedDevice)
```

UTM source filter:
```typescript
// If UTM source active:
// Join with SessionPing table on sessionId, filter by utmSource
// Sessions without a SessionPing record → treated as "Direct"
// If filter = "Direct": include sessions with no SessionPing OR null utmSource
```

---

## BUILD SEQUENCE FOR PAGE 1

```
1. Read SPEC.md and CHANGELOG.md
2. Run npx tsc --noEmit — confirm clean before starting
3. Create supabase/sessionping-utm.sql if not already run — check first
4. Build /api/couponmaxx/analytics route — all data, tested with curl
5. Build the shared UI components:
   - CouponMaxxLayout (header bar + nav shell)
   - DateRangePicker (the date pill dropdown)
   - FilterPill (reusable for all 3 filters)
   - MetricCard (the white card with title, definition, big number, line chart)
   - LineChartInCard (recharts wrapper, 140px height, consistent styling)
   - FunnelChart (full-width bar/line chart with column selector)
6. Build the Analytics page using those components
7. Wire all filter state — page-level state, all components respond
8. Wire compare-to — adds dashed line to all MetricCards
9. Wire the 3 dropdowns in Attributed Sales card
10. Wire the column selector + bar/line toggle in Funnel
11. npx tsc --noEmit — fix all errors
12. npm run build — fix all errors
13. Test with real data on drwater
14. Append CHANGELOG.md entry
```

---

## CHANGELOG ENTRY TO APPEND AFTER BUILD

```markdown
## [DATE]: CouponMaxx — Page 1 Analytics built

**Route:** /couponmaxx/analytics
**API:** /api/couponmaxx/analytics

**What's on the page:**
- Header bar: CouponMaxx logo placeholder + Live dot + Dr.Water store name
- Date range selector: 7d/30d/90d/12m/custom
- Compare to: previous period / previous year / none
- 3 filter pills: Product, Device type, UTM source
- Row 1: Coupon success rate card + Carts with coupon applied card
- Row 2: Attributed sales card (with attribution window + pre/post dropdowns) +
         Cart views card (with metric switcher dropdown)
- Row 3: Coupon funnel — full-width bar/line chart with column selector

**UI style:** Matches Alia analytics dashboard exactly
- Chart colour: #0EA5E9
- Card style: white, 1px #E3E3E3 border, 8px radius, no shadow
- No grid lines on charts
- recharts for all charts

**Files created:**
- app/(embedded)/couponmaxx/layout.tsx
- app/(embedded)/couponmaxx/analytics/page.tsx
- app/api/couponmaxx/analytics/route.ts
- components/couponmaxx/MetricCard.tsx
- components/couponmaxx/LineChartInCard.tsx
- components/couponmaxx/FunnelChart.tsx
- components/couponmaxx/FilterPill.tsx
- components/couponmaxx/DateRangePicker.tsx
```

---

---

## PAGE 2 — CART SESSIONS
**Route:** /couponmaxx/sessions
**API:** /api/couponmaxx/sessions

---

### PURPOSE LINE
Below the page title "Cart Sessions", one line of grey subtext:
"Click a card to filter the table. Click View on any row to see the full journey."
13px, #6B7280.

---

### SECTION: Time filter + Refresh

Sits between the page title and the four KPI boxes.
Same date range pill as Analytics page (1h / 24h / 7d / Custom).
Default: 24h.
Refresh button on the far right:
  Icon: circular arrows (Heroicons)
  On click: re-fetches data, shows brief spinner on the button
  No text — icon only, 32×32px, subtle border, grey icon

---

### SECTION: Four KPI filter boxes

One horizontal row. Four equal-width boxes.
These are BOTH metric displays AND clickable filters.

Visual style per box:
  Background: #FFFFFF
  Border: 1px solid #E3E3E3
  Border-radius: 8px
  Padding: 16px
  Cursor: pointer

Active state (when clicked):
  Border: 1.5px solid #0EA5E9
  Background: #F0F9FF
  The table below immediately filters to matching sessions

Inactive state: default white/grey border as above.
Click active box again: deselects filter, shows all sessions.
Only one box can be active at a time.

---

#### BOX 1 — Carts Opened

```
Big number:   COUNT(DISTINCT sessionId) FROM CartEvent
              WHERE occurredAt IN range AND shopId = shop
              Format: integer, e.g. "336"

Sub-line 1:   "[X] with products"
              X = sessions where cartValue > 0 OR cartItemCount > 0
              13px #6B7280

Sub-line 2:   "[Y] empty"
              Y = total - X
              13px #6B7280

When clicked: table shows ALL sessions (default, no filter)
```

---

#### BOX 2 — With Products

```
Big number:   COUNT(DISTINCT sessionId) WHERE cartValue > 0 OR cartItemCount > 0
              AND occurredAt IN range AND shopId = shop
              Format: integer, e.g. "50"

Sub-line 1:   "[X]% of carts opened"
              X = (with products / carts opened) * 100, one decimal
              e.g. "14.9% of carts opened"
              13px #6B7280

Sub-line 2:   (empty — only one sub-line for this box)

When clicked: table filters to sessions where cartValue > 0 OR cartItemCount > 0
```

---

#### BOX 3 — Coupon Attempted

```
Big number:   COUNT(DISTINCT sessionId) WHERE any coupon event exists
              AND occurredAt IN range AND shopId = shop
              Format: integer, e.g. "22"

Sub-line 1:   "[X]% of product carts"
              X = (coupon sessions / with-products sessions) * 100
              e.g. "44.0% of product carts"
              13px #6B7280

Sub-line 2:   (empty)

When clicked: table filters to sessions with any coupon event
              (applied, failed, or recovered)
```

---

#### BOX 4 — Reached Checkout

```
Big number:   COUNT(DISTINCT sessionId) WHERE cart_checkout_clicked exists
              OR sessionId in CheckoutEvent with checkout_started
              AND occurredAt IN range AND shopId = shop
              Format: integer, e.g. "19"

Sub-line 1:   "[X]% of product carts"
              X = (checkout sessions / with-products sessions) * 100
              e.g. "38.0% of product carts"
              13px #6B7280

Sub-line 2:   "[Y] had a coupon  ·  [Z] did not"
              Y = checkout sessions that had any coupon event
              Z = checkout sessions with no coupon events
              13px #9CA3AF (lighter — secondary context)

When clicked: table filters to sessions that reached checkout
```

---

### SECTION: Filter bar

Sits between the four boxes and the table.
Row of filter pills — same visual style as Analytics page filter pills.

Filters available (left to right):

```
1. Country
   Dropdown: All countries (default) + distinct country values, flag emoji + code
   e.g. 🇺🇸 US, 🇮🇳 IN, 🇬🇧 GB

2. Device
   Dropdown: All devices / Desktop / Mobile / Tablet
   Icon: device icon

3. Product
   Dropdown: All products + distinct productTitles from lineItems
   Sorted by frequency DESC

4. Cart value
   Dropdown: Any value / Under $50 / $50–$100 / $100–$150 / $150–$200 / $200+ / Custom
   Based on highest cartValue seen in the session

5. Coupon
   Dropdown: Any / Used a coupon / No coupon / Applied successfully /
             Failed (never recovered) / Recovered
   Applied successfully = cart_coupon_applied OR cart_coupon_recovered
   Failed = cart_coupon_failed with no subsequent recovery for same code

6. Outcome
   Dropdown: Any / Ordered / Reached checkout / Abandoned
   Ordered = sessionId in CheckoutEvent with checkout_completed
   Reached checkout = checkout_started or cart_checkout_clicked, no completed
   Abandoned = product cart, no checkout action
   Note: "Abandoned" label has tooltip:
   "Session-level status only. Customer may have returned in a later session."
```

Active filters shown as dismissible tags below the filter bar.
"Clear all" link at right when any filter active.

All filters AND the four box filters work together.
If box 3 (Coupon Attempted) is active AND Country filter = US:
table shows coupon sessions from US only.

---

### SECTION: Scoped counts (inline, above table)

Updates live as filters change.

```
Format:
"Showing [X] sessions  ·  [Y]% reached checkout  ·  [Z]% completed order"

X = COUNT matching current filters
Y = of those, % with checkout action
Z = of those, % with checkout_completed
```

---

### SECTION: Session table

No horizontal scroll. Ever.
All columns must fit without scrolling.
Products and coupons stack vertically within their cells.

Column widths (approximate, flexible within these bounds):
```
Time:         110px
Country:       50px
Device:        50px (icon only)
Source:        80px
Products:     flexible (takes remaining space)
Cart value:   110px
Coupons:      130px
Outcome:       90px
View:          48px
```

---

#### Column: Time

Three lines stacked vertically:

```
Line 1 (13px #1A1A1A weight 500):
  Relative time — "32m ago" / "2h 14m ago" / "yesterday" / "Mar 14"
  Logic:
    < 60 min ago:    "Xm ago"
    < 24h ago:       "Xh Ym ago"
    yesterday:       "yesterday"
    older:           "Mar 14" format

Line 2 (11px #6B7280):
  Absolute local time in merchant's timezone
  Format: "2:32 PM IST" / "9:14 AM EST"
  Timezone: from Shopify shop data (already in auth session)

Line 3 (11px #9CA3AF):
  Session duration — "8m 14s" / "55s" / "< 1s"
  Calculated: lastEvent.occurredAt - firstEvent.occurredAt
  If < 1 second: "< 1s"
```

---

#### Column: Country

```
Flag emoji + country code, stacked or inline depending on space
e.g. "🇮🇳 IN"
12px #374151
If country is null: "—"
```

---

#### Column: Device

```
Icon only — no text label (saves column space)
Desktop: laptop SVG icon (16px, #6B7280)
Mobile:  phone SVG icon (16px, #6B7280)
Tablet:  tablet SVG icon (16px, #6B7280)
Unknown: "—"
Tooltip on hover: "Desktop" / "Mobile" / "Tablet"
```

---

#### Column: Source

```
Derived from SessionPing.utmSource for this sessionId.
If no SessionPing record: "Direct"

Display as a small chip (not just text):
  Background: #F3F4F6
  Border: 1px solid #E5E7EB
  Border-radius: 4px
  Padding: 2px 6px
  Font: 11px #374151

Source display names:
  null or empty → "Direct"
  google/bing → "Paid"
  instagram/facebook/tiktok → "Social"
  klaviyo/email → "Email"
  anything else → first 10 chars of raw utmSource value

Tooltip on hover: shows full UTM breakdown
  "utm_source: instagram
   utm_medium: story
   utm_campaign: STPAT_MAR25"
  Dark tooltip (#1F2937 bg, white text, 12px)
  Only shown if UTM data exists
```

---

#### Column: Products

```
Each product on its own line (no horizontal truncation):
  "[Product name] ×[qty]  $[price]"
  "[Product name]" — 12px #1A1A1A, truncated at 28 chars with "..."
  "×[qty]" — 11px #6B7280
  "$[price]" — 11px #6B7280

If no products (empty cart): "Empty cart" in 12px #9CA3AF italic
If more than 3 products: show first 2, then "+ X more" link in blue
  Clicking "+ X more" expands the cell inline (no modal)

Price shown is item unit price from lineItems.price (cents/100)
```

---

#### Column: Cart value

```
Two lines:

Line 1 (13px #1A1A1A weight 500):
  If value changed during session: "$[start] → $[end]"
    Start = first cartValue > 0 (cents/100)
    End = last cartValue > 0 (cents/100)
    Arrow (→) in #9CA3AF
  If value unchanged: "$[value]"
  If always zero/null: "—"

Line 2 (11px #6B7280):
  Only shown if a coupon was successfully applied:
  "after coupon: $[post-discount value]"
  post-discount value = cartValue at cart_coupon_applied event - discountAmount
  If no successful coupon: line 2 is empty (don't show blank line)
```

---

#### Column: Coupons

```
Each unique code attempted gets its own line (vertical stack):

Format per code:
  Applied (couponSuccess=true):
    Green text: "✓ [CODE]  −$[discount]"
    discount = discountAmount (cents/100), shown as $X.XX
    Text colour: #15803D
    
  Failed and never recovered (couponSuccess=false, no recovery):
    Red text: "✗ [CODE]"
    No discount amount (it never applied)
    Text colour: #B91C1C

  Recovered (couponRecovered=true):
    Amber text: "↑ [CODE]  −$[discount]"
    Text colour: #B45309

  Neutral (no success field — shouldn't happen but handle):
    Grey text: "[CODE]"
    Text colour: #6B7280

Font: 12px monospace for the code, regular for the symbols and amount
If no coupon events: "—" in #9CA3AF
If more than 3 codes: show first 2, "+ X more" link
```

---

#### Column: Outcome

```
Badge (pill shape, soft colour):

Ordered:
  Background: #F0FDF4
  Text: #15803D
  Border: 1px solid #BBF7D0
  Label: "Ordered"

Reached checkout:
  Background: #FFFBEB
  Text: #B45309
  Border: 1px solid #FDE68A
  Label: "Checkout"

Abandoned:
  Background: #F9FAFB
  Text: #6B7280
  Border: 1px solid #E5E7EB
  Label: "Abandoned"

Badge: border-radius 20px, padding 3px 10px, font 11px weight 500

Tooltip on "Abandoned":
  "Based on this session only. Customer may have returned later."
```

---

#### Column: View

```
"View →" text link
Colour: #0EA5E9
Font: 12px
Cursor: pointer
On click: opens session timeline panel (right-side sheet)
```

---

### SESSION TIMELINE PANEL

Right-side sheet. Width: 480px. Full height. Slides in from right.
Background: #FFFFFF. Left border: 1px solid #E3E3E3.
Overlay: semi-transparent dark overlay on the table behind it.
Close: X button top-right of panel.

```
Panel header:
  Session ID: small monospace text, 11px #9CA3AF, truncated
  
  One-line summary (template, not LLM):
    Rules (first match wins):
    1. checkout_completed: "[Product] [+X more], [coupon action], completed order"
    2. checkout clicked, no complete: "[Product], [coupon action], reached checkout"
    3. cartValue > 0, no checkout: "[Product], [coupon action], abandoned"
    4. empty cart: "Browsed without adding to cart"

    Coupon action phrases:
      applied:   "applied [CODE] (saved $X)"
      failed:    "tried [CODE] (failed)"
      recovered: "unlocked [CODE] after adding items"
      none:      omit

  Cart value, item count, outcome badge (same colours as table)
  Country + device icon inline

Products section:
  "[Product name]  ×[qty]  $[unit price]"
  Total at right: "$[cartValue]"
  Subtle divider below

Timeline section:
  Merged CartEvent + CheckoutEvent, sorted by occurredAt ASC
  
  Per event row:
    Left:  clock time (HH:MM:SS AM/PM) in merchant timezone
           elapsed since previous event below it: "+12s" / "+3m 45s"
           First event: no elapsed
    Badge: "Cart" (grey pill) or "Checkout" (blue pill)
    Right: label + detail line
           Label colour: green=positive, red=negative, default=#1A1A1A
           Detail: smaller grey text below label

  Label map:
    cart_item_added       → "Added to cart"            detail: "[product]  Cart: $X"
    cart_item_changed     → "Changed quantity to [N]"  detail: "Cart: $X"
    cart_item_removed     → "Removed item"             detail: "Cart: $X"
    cart_coupon_applied   → "Applied [CODE]"           detail: "Saved $X" (green)
    cart_coupon_failed    → "Tried [CODE]"             detail: "Not applicable" (red)
    cart_coupon_recovered → "Unlocked [CODE]"          detail: "Added items · Saved $X" (green)
    cart_coupon_removed   → "Removed [CODE]"           detail: ""
    cart_checkout_clicked → "Clicked checkout"         detail: "Cart: $X"
    cart_page_hidden      → "Left the page"            detail: "[pageUrl]"
    cart_drawer_opened    → "Opened cart drawer"       detail: ""
    cart_atc_clicked      → "Clicked add to cart"      detail: "[pageUrl]"
    checkout_started               → "Reached checkout"
    checkout_contact_submitted     → "Filled contact info"
    checkout_address_submitted     → "Filled shipping address"
    checkout_shipping_submitted    → "Selected shipping"
    payment_submitted              → "Entered payment"
    checkout_completed             → "Order completed ✓" (green, bold)
    alert_displayed                → "Checkout alert: [errorMessage]" (red)
```

---

### TABLE: Sort + Pagination

```
Sort: occurredAt DESC by default (most recent first)
Allow resort by: Time, Cart value (click column headers)
Pagination: 25 rows per page
Prev / Next buttons below table, right-aligned
"Page X of Y  ·  Z total sessions" text, left of pagination buttons
```

---

## API ROUTE SPEC — /api/couponmaxx/sessions

```typescript
// GET /api/couponmaxx/sessions
// Query params: shop, start, end, page (default 1),
//               country?, device?, product?, minCart?, maxCart?,
//               coupon?, outcome?
//               boxFilter?: 'all' | 'products' | 'coupon' | 'checkout'

// Response shape:
{
  boxes: {
    cartsOpened: number,
    withProducts: number,
    couponAttempted: number,
    reachedCheckout: number,
    // For sub-labels:
    emptyCount: number,
    withProductsPct: number,       // of cartsOpened
    couponAttemptedPct: number,    // of withProducts
    reachedCheckoutPct: number,    // of withProducts
    checkoutWithCoupon: number,    // for box 4 sub-line 2
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

type CartSessionRow = {
  sessionId: string,
  firstSeen: string,          // ISO — for relative time calculation
  lastSeen: string,           // ISO — for duration calculation
  country: string | null,
  device: string | null,
  utmSource: string | null,
  utmMedium: string | null,
  utmCampaign: string | null,
  products: {
    productTitle: string,
    quantity: number,
    price: number             // dollars (cents/100)
  }[],
  cartValueStart: number | null,   // dollars
  cartValueEnd: number | null,     // dollars
  postDiscountValue: number | null, // dollars — cart value after coupon applied
  coupons: {
    code: string,
    status: 'applied' | 'failed' | 'recovered',
    discountAmount: number | null  // dollars
  }[],
  outcome: 'ordered' | 'checkout' | 'abandoned'
}
```

---

## DEEPER IDEAS — WHAT PAGE 2, 3, 4 CAN DO

This section captures ideas discussed. Pages to be specced one by one.

**Page 2 — Cart Sessions**
The session-level investigation view. Full filter bar. Session table.
Session timeline panel. Exactly as specced in V3 but with CouponMaxx styling.

**Page 3 — Discounts**
The deepest coupon intelligence page.
Code health table + revenue per session chart + product breakdown +
recovery detail. Everything from the V3 Discounts spec, same Alia styling.

**Page 4 — Notifications**
Alert feed + settings. Slack/email toggles. Same as V3 spec, Alia styling.

**Future pages / depth ideas discussed:**

Code-level attribution:
  For each discount code: revenue attributed to it vs what would have happened
  without it. The true incremental lift question. Requires a control group
  (sessions that didn't use the code) matched by cart value range and device.

Coupon cannibalization detector:
  When two codes are used in the same session, which one is redundant?
  If WELCOME10 + PITCHER15 both applied — did WELCOME10 add any conversion
  lift or did PITCHER15 alone drive the purchase?

Time-of-day coupon performance:
  Are certain codes more effective at certain times? Late-night mobile
  shoppers might respond differently to threshold discounts vs morning desktop.
  Heatmap: day of week × hour of day, coloured by coupon success rate.

Coupon velocity tracking:
  How fast is a code being used? If a code is on a 500-use limit and is
  being redeemed 50 times/day, alert the merchant 3 days before it hits
  the cap — not after.

AOV threshold optimizer:
  Given the merchant's current AOV and the conversion band data,
  suggest the optimal minimum order amount for a threshold discount.
  "Your $125 average cart converts at 31%. Sessions over $150 convert
  at 68%. A threshold discount at $140 would capture that jump."
  This is a pure data calculation, no LLM.

Repeat coupon users:
  Customers who use discount codes on every purchase. Are they buying
  because of the discount or would they buy anyway? If their average
  order value with a code is the same as the store average without one,
  they're discount-dependent. Merchant insight: stop sending them codes,
  test if they still convert.

Campaign performance:
  Group codes by UTM campaign. If SUMMER_SALE campaign drove traffic
  and those sessions all used SUMMER20 code — what was the total
  attributed revenue for that campaign? What was the net (post-discount)?
  This is a mini campaign reporting tool built purely from cart data.
```
