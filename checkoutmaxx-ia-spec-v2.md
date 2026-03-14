# CheckoutMaxx — IA Spec v2
> Complete specification for the new dashboard.
> Built at /dashboard/v2/* routes — old routes untouched until explicit sign-off.
> Every page. Every metric. Exact math. Exact chart type with rationale.
> No date locks. No LLMs. No generated text anywhere.

---

## GUARDRAILS — READ BEFORE TOUCHING ANYTHING

### What must not be touched
```
pixel/checkout-monitor.js              — Web Pixel, sandboxed, do not touch
extensions/cart-monitor/               — theme extension, do not touch
app/api/pixel/ingest/route.ts          — working, do not touch
app/api/cart/ingest/route.ts           — working, do not touch
app/api/session/ping/route.ts          — working, do not touch
app/api/health/route.ts                — working, do not touch
lib/supabase.ts                        — do not touch
lib/ingest-log.ts                      — do not touch
prisma/schema.prisma                   — do not touch
app/api/webhooks/                      — do not touch
app/api/auth/                          — do not touch
app/api/billing/                       — do not touch
app/api/jobs/                          — do not touch
All existing /dashboard/* routes       — do not touch, do not rename, do not redirect
All existing /api/cart/* routes        — do not touch
All existing /api/metrics route        — do not touch
All existing /api/alerts/* routes      — do not touch
```

### What is being built
```
New routes only, all under /dashboard/v2/:
  /dashboard/v2/overview
  /dashboard/v2/cart
  /dashboard/v2/performance
  /dashboard/v2/discounts
  /dashboard/v2/notifications

New API routes only, all under /api/v2/:
  /api/v2/overview
  /api/v2/cart/sessions
  /api/v2/performance
  /api/v2/discounts
  /api/v2/notifications
```

### Technology rules
```
- All DB reads: Supabase JS client only — never Prisma for queries
- All DB writes: already handled by existing ingest endpoints — v2 pages are read-only
- IDs: crypto.randomUUID() if any insert is ever needed
- No LLMs, no AI-generated text, no dynamic narratives anywhere
- All monetary values stored in cents in DB — always divide by 100 for display
- cartValue, discountAmount, totalPrice: cents in CartEvent, dollars in CheckoutEvent.totalPrice
- Supabase table names are case-sensitive: "CartEvent", "CheckoutEvent",
  "Shop", "AlertLog", "SessionPing", "IngestLog"
- sessionId field name in CartEvent and CheckoutEvent is lowercase "sessionId"
- All Supabase queries must handle null gracefully — never assume a field is populated
- npx tsc --noEmit must pass clean before any commit
- npm run build must pass clean before any commit
```

### Empty states — used across all pages
```
No sessions in range:
  Icon: empty box
  Title: "No sessions in this period"
  Body: "Cart sessions will appear here once customers visit the store."

No checkout events in range:
  Icon: empty box
  Title: "No checkout data in this period"
  Body: "Checkout events appear once customers reach the Shopify checkout."

Fewer than 10 data points for a chart:
  Icon: bar chart outline
  Title: "Not enough data yet"
  Body: "Based on X sessions. Add more data by selecting a wider date range."
  (show the number X so merchant knows how close they are)

No coupon activity:
  Icon: tag outline
  Title: "No discount codes used in this period"
  Body: "Coupon attempts will appear here once customers try discount codes."

No alerts:
  Icon: bell outline
  Title: "No alerts in this period"
  Body: "Alerts fire when conversion drops, coupons fail, or anomalies are detected."
```

---

## NAVIGATION — V2 ONLY

```
Overview          /dashboard/v2/overview        default landing
Cart Sessions     /dashboard/v2/cart
Cart Performance  /dashboard/v2/performance
Discounts         /dashboard/v2/discounts
Notifications     /dashboard/v2/notifications
```

Settings link at bottom — points to existing /settings (do not duplicate).
Nav is a separate layout component for /dashboard/v2/* only.
Does not affect existing /dashboard/* layout.

---

## GLOBAL DATE FILTER

Appears top right on every page. Every metric on every page responds to it.

```
Presets:   Today / Yesterday / Last 7 days / Last 30 days / Last 90 days / Custom
Default:   Last 7 days
Custom:    date range picker, any range, no minimum, no maximum

Comparison period (used for delta calculations):
  Always the previous equivalent duration.
  Last 7 days selected → compare to 7 days before that.
  Today selected → compare to yesterday.
  Custom range of 12 days → compare to the 12 days before the range start.

Delta display:
  Rates (CVR, checkout rate): show as percentage points → "+3.2pp" not "+10%"
  Counts (sessions, orders): show as percentage → "+12%"
  Money (AOV, revenue): show as dollar delta → "+$14.20"
  Green = improving. Red = worsening. Grey = within ±2% / ±1pp (flat).
```

---

---

# PAGE 1 — OVERVIEW
**Route:** /dashboard/v2/overview
**Purpose:** Is today normal? What are my core numbers?
**Time to read:** 30 seconds.

---

## ROW 1 — 4 KPI Cards

Single horizontal row. Each card contains:
- Metric label (small, subdued text)
- Primary value (large)
- Sparkline chart (see spec per card — tiny, no axes, no labels)
- Delta badge (vs previous period)
- Sub-label (one line of context)

Sparkline granularity:
- Today or Yesterday selected → hourly points
- Last 7 days → daily points
- Last 30 days → daily points
- Last 90 days → weekly points
- Custom → daily if range ≤ 60 days, weekly if > 60 days

---

### Card 1 — Cart Sessions

```
Label:      Cart Sessions
Value:      COUNT(DISTINCT "sessionId") FROM "CartEvent"
            WHERE "occurredAt" >= rangeStart AND "occurredAt" <= rangeEnd
            AND ("cartValue" > 0 OR "cartItemCount" > 0)
            — only sessions where something real happened

Sparkline:  Line chart. One point per granularity period.
            Y = same count per period. No baseline reference.
            Rationale: line chart shows trend over time better than bars
            for a continuous count metric.

Delta:      (current - previous) / previous * 100, shown as +X%

Sub-label:  "[X] sessions had products in cart"
            X = same count (redundant but confirms what "sessions" means here)
```

---

### Card 2 — Checkout Rate

```
Label:      Checkout Rate
Value:      COUNT(DISTINCT "sessionId" that has cart_checkout_clicked
            OR exists in CheckoutEvent with checkout_started)
            DIVIDED BY
            COUNT(DISTINCT "sessionId" from CartEvent where cartValue > 0)
            * 100
            Display: XX.X%

Sparkline:  Line chart. Daily checkout rate per day.
            Rationale: rate over time shows trend — bars would imply
            absolute counts which is misleading for a percentage.

Delta:      Percentage point change. "+X.Xpp"

Sub-label:  "X of Y sessions reached checkout"
            X = checkout session count, Y = product session count
```

---

### Card 3 — CVR (Checkout to Order)

```
Label:      CVR
Value:      COUNT(DISTINCT "sessionId") FROM "CheckoutEvent"
            WHERE "eventType" = 'checkout_completed'
            AND "occurredAt" IN range
            DIVIDED BY
            COUNT(DISTINCT "sessionId") FROM "CheckoutEvent"
            WHERE "eventType" = 'checkout_started'
            AND "occurredAt" IN range
            * 100
            Display: XX.X%

Sparkline:  Line chart. Daily CVR per day.
            Rationale: same as checkout rate — trend line for a rate.

Delta:      Percentage point change. "+X.Xpp"

Sub-label:  "X orders from Y checkout starts"
```

---

### Card 4 — AOV

```
Label:      Avg Order Value
Value:      AVG("totalPrice") FROM "CheckoutEvent"
            WHERE "eventType" = 'checkout_completed'
            AND "occurredAt" IN range
            Note: totalPrice in CheckoutEvent is in dollars (from Web Pixel)
            Display: $XXX.XX

Sparkline:  Line chart. Daily average order value per day.
            Rationale: AOV fluctuates — line shows drift clearly.

Delta:      Dollar change. "+$X.XX"

Sub-label:  "across X completed orders"
            X = count of checkout_completed events in range
```

---

## ROW 2 — Checkout Funnel

```
Title:      "Checkout Funnel"
Component:  Line chart (keep existing — it works)
            Single line connecting each step.
            X axis: Checkout → Contact → Address → Shipping → Payment → Completed
            Y axis: 0% to 100%, survival rate at each step
            Baseline: Checkout = 100%

Second line: previous period survival rates, dashed grey.
             Shows immediately if this period is better or worse per step.

Note text (static, top right of chart):
  "Uptick at Completed = accelerated checkout (Shop Pay / Apple Pay)"

Math per step (all divided by checkout_started count for the period):
  Checkout:   100% (baseline — all checkout_started sessions)
  Contact:    COUNT(checkout_contact_info_submitted) / checkout_started * 100
  Address:    COUNT(checkout_address_info_submitted) / checkout_started * 100
  Shipping:   COUNT(checkout_shipping_info_submitted) / checkout_started * 100
  Payment:    COUNT(payment_info_submitted) / checkout_started * 100
  Completed:  COUNT(checkout_completed) / checkout_started * 100

Tooltip on hover per step:
  "X sessions reached this step (Y% of checkout starts)"
  "Z sessions dropped here (W% drop rate)"
  "vs previous period: ±X.Xpp"
```

---

## ROW 3 — Two tables, side by side (50/50)

### Left — Funnel Steps

```
Title:    "Steps"
Columns:  Step | Sessions | % of starts | Drop from previous
Rows:     one per step in order
          Checkout Started, Contact, Address, Shipping, Payment, Completed

"Drop from previous" column:
  Sessions lost between this step and previous step.
  Shown as: "-X sessions (-Y%)"
  Colour: red if drop > 30%, amber if 15-30%, grey otherwise.
  Rationale: absolute drop count + rate together tell more than either alone.
```

### Right — Drop Analysis

```
Title:    "Where sessions are dropping"
Columns:  Step | Dropped | Drop rate | vs last period
Rows:     each gap between consecutive steps

"Dropped":    count of sessions lost at this step
"Drop rate":  dropped / checkout_started * 100, shown as XX%
"vs last period": current drop rate - previous period drop rate
              shown as +X.Xpp (red = more dropping, green = fewer dropping)

Rationale: this answers "is dropout at each step getting better or worse"
           which the funnel chart alone doesn't show clearly.
```

---

## ROW 4 — Recent Alerts (compact strip, full width)

```
Shows: last 3 alerts regardless of read status
Format: [severity dot] [title] [timestamp] [→ link]
One line per alert. No body text — just title and link.
"View all alerts →" link at right end of strip.
If 0 alerts in last 7 days: hide this row entirely.
```

---

---

# PAGE 2 — CART SESSIONS
**Route:** /dashboard/v2/cart
**Purpose:** Find and investigate specific sessions.
           Merged view of all sessions — converted and abandoned.
           Primary use: support investigations and session-level browsing.

---

## ROW 1 — Filter Bar

```
This is the primary interaction on this page.
Filters displayed as a horizontal bar of dropdowns + search.

Filter 1 — Outcome (single select)
  Options: All / Ordered / Reached Checkout / Abandoned
  "Ordered" = sessionId exists in CheckoutEvent with checkout_completed
  "Reached Checkout" = cart_checkout_clicked OR checkout_started exists,
                       but NOT checkout_completed
  "Abandoned" = cartValue > 0, no checkout_clicked, no CheckoutEvent

Filter 2 — Date Range
  Inherits global date range by default.
  Can be overridden here independently.
  Same presets as global filter.

Filter 3 — Country
  Dropdown of all distinct country values in CartEvent for the selected date range.
  Sorted by frequency descending.
  "All countries" default.

Filter 4 — Device
  Options: All / Desktop / Mobile
  Based on "device" field in CartEvent.

Filter 5 — Cart Value
  Options: All / Under $50 / $50–$100 / $100–$150 / $150–$200 / $200+ / Custom range
  Based on highest cartValue seen in the session.

Filter 6 — Coupon
  Options: All / Used a coupon / No coupon / Has failed coupon / Has recovered coupon
  "Used a coupon" = any coupon event in session
  "Has failed coupon" = cart_coupon_failed exists with no subsequent cart_coupon_applied
                        for the same code (code stayed broken)
  "Has recovered coupon" = cart_coupon_recovered exists in session

Filter 7 — Product
  Text search. Searches productTitle in lineItems JSON.
  Type product name, sessions containing that product appear.

Active filters shown as dismissible tags below the filter bar.
"Clear all" link when any filter is active.
```

---

## ROW 2 — Scoped Counts (inline, not cards)

```
Updates live as filters change.
Format: "Showing X sessions  ·  Y% reached checkout  ·  Z% completed order"

X = COUNT(DISTINCT sessionId) matching current filters
Y = of those X sessions, % with checkout click or checkout_started
Z = of those X sessions, % with checkout_completed
```

---

## ROW 3 — Session Table

```
Sort: occurredAt DESC by default (most recent first)
      Allow sort by: Time, Cart Value, Session Duration
Pagination: 25 rows per page

Columns:

Time
  Line 1: session start time, formatted "Mar 14, 2:34 PM"
  Line 2: session duration — time from first to last event
           Format: "8m 20s" / "1h 12m" / "< 1m"
  Rationale: two lines gives both when it happened and how long it lasted

Country + Device
  Flag emoji + country code (e.g. 🇮🇳 IN)
  Device icon below: laptop icon for desktop, phone icon for mobile
  Combined into one column to save space

Products
  Line items, comma separated, truncated at 40 chars with "..."
  If lineItems is null or empty but cartItemCount > 0:
    show "X items" (grey)
  If cartValue = 0 and cartItemCount = 0:
    show "Empty cart" (subdued)

Cart Value
  Show start value → end value if they differ.
  Format: "$50.00 → $124.99"
  If unchanged: "$124.99"
  If never had value: "—"
  Start value = cartValue of first cart event with cartValue > 0
  End value = cartValue of last cart event with cartValue > 0

Coupons
  One pill per unique code attempted.
  Pill colour:
    Green = couponSuccess: true (applied)
    Red = couponSuccess: false (failed, never recovered)
    Amber = couponRecovered: true (failed then unlocked)
  Pill label: code name only
  If no coupon events: "—"

Outcome
  Badge:
    Green "Ordered" = checkout_completed exists
    Amber "Checkout" = checkout_started or cart_checkout_clicked, no completed
    Grey "Abandoned" = cartValue > 0, no checkout action

View
  Text link "View →"
  Opens session timeline modal
```

---

## SESSION TIMELINE MODAL

```
Triggered by: clicking "View →" on any session row.
Opens as a right-side sheet (not a popup — right side panel, full height).

Header section:
  Session ID (small, subdued, truncated)
  One-line summary — generated from template (no LLM):

    Template rules (apply in order, first match wins):
    1. If checkout_completed:
       "[Product] + [Product2 if exists], [coupon action], completed order"
       Coupon action:
         applied → "applied [CODE] (saved $X)"
         failed only → "tried [CODE] (failed)"
         recovered → "unlocked [CODE] after adding items"
         no coupon → omit coupon part
    2. If cart_checkout_clicked but no checkout_completed:
       "[Product], [coupon action if any], reached checkout"
    3. If cartValue > 0 but no checkout:
       "[Product], [coupon action if any], abandoned"
    4. If cartValue = 0:
       "Browsed without adding to cart"

    Examples:
    "HydroPitcher, tried SUMMER20 (failed), reached checkout"
    "HydroPitcher + HydroFix, applied PITCHER15 (saved $18.75), completed order"
    "HydroPitcher, unlocked CREDIT565 after adding items, completed order"
    "Browsed without adding to cart"

  Cart value (final), item count, outcome badge — same as table row
  Country + device

Products section:
  List of line items: "[Product name]  ×[qty]  $[price]"
  If no line items: "No product detail captured"

Full journey section:
  Every CartEvent + CheckoutEvent for this session, merged and sorted
  by occurredAt ASC.

  Per event row:
    Column 1 — Time
      Clock time: "2:34 PM"
      Elapsed since previous event: "+12s" / "+3m 45s"
      First event: no elapsed shown
    Column 2 — Source badge
      "Cart" (grey badge) for CartEvent rows
      "Checkout" (blue badge) for CheckoutEvent rows
    Column 3 — Label + detail
      Human label (see label map below)
      Detail line below label (subdued, smaller)

  Colour coding on label text:
    Green: cart_coupon_applied, cart_coupon_recovered, checkout_completed
    Red: cart_coupon_failed
    Default: everything else

  Label map (CartEvent eventType → human label):
    cart_item_added          → "Added to cart"
                                detail: "[product name]  ·  Cart: $[cartValue]"
    cart_item_changed        → "Changed quantity to [newQuantity]"
                                detail: "Cart: $[cartValue]"
    cart_item_removed        → "Removed item"
                                detail: "Cart: $[cartValue]  ·  [pageUrl]"
    cart_bulk_updated        → "Cart updated"
                                detail: "[pageUrl]" if pageUrl exists
    cart_coupon_applied      → "Applied [couponCode]"
                                detail: "Saved $[discountAmount/100]"
    cart_coupon_failed       → "Tried [couponCode]"
                                detail: "Not applicable"
    cart_coupon_recovered    → "Unlocked [couponCode]"
                                detail: "Added items to qualify · Saved $[discountAmount/100]"
    cart_coupon_removed      → "Removed [couponCode]"
                                detail: ""
    cart_checkout_clicked    → "Clicked checkout"
                                detail: "Cart: $[cartValue]"
    cart_page_hidden         → "Left the page"
                                detail: "[pageUrl]"
    cart_drawer_opened       → "Opened cart drawer"
                                detail: "[pageUrl]"
    cart_drawer_closed       → "Closed cart drawer"
                                detail: ""
    cart_atc_clicked         → "Clicked add to cart"
                                detail: "[pageUrl]"
    cart_session_started     → "Session started"
                                detail: "[pageUrl]"

  Label map (CheckoutEvent eventType → human label):
    checkout_started                    → "Reached checkout"
    checkout_contact_info_submitted     → "Filled contact info"
    checkout_address_info_submitted     → "Filled shipping address"
    checkout_shipping_info_submitted    → "Selected shipping method"
    payment_info_submitted              → "Entered payment"
    checkout_completed                  → "Order completed"
    alert_displayed                     → "Checkout alert: [errorMessage]"
    ui_extension_errored                → "Extension error"
```

---

---

# PAGE 3 — CART PERFORMANCE
**Route:** /dashboard/v2/performance
**Purpose:** Aggregated performance data. How is the cart performing across sessions?
            What does a converting session look like vs an abandoning one?
            What is the relationship between cart value and conversion?
            How are discounts affecting revenue per session?
**Date range:** Fully flexible. No lock. All presets available.
**Note on thin data:** No warnings. Just show what's there with
                       "Based on X sessions" label on each chart.

---

## ROW 1 — Converted vs Abandoned Comparison Table

```
Title:   "Converting sessions vs abandoned sessions"
Sub:     "Based on [X] sessions with products in cart · [date range]"

Component: Two-column comparison table.
           Left column header: "Converted ([X] sessions)"
           Right column header: "Abandoned ([Y] sessions)"

Definition:
  Converted = sessionId IN (SELECT sessionId FROM CheckoutEvent
              WHERE eventType='checkout_completed' AND occurredAt IN range)
  Abandoned = cartValue > 0
              AND sessionId NOT IN converted set
              AND occurredAt IN range

Rows of the table:

Row 1 — Avg cart value at checkout
  Label: "Avg cart value"
  Converted: AVG(cartValue) FROM CartEvent
             WHERE sessionId IN converted set
             AND eventType = 'cart_checkout_clicked'
             Fallback if no checkout_clicked: last cartValue > 0 in session
             Display: $XXX.XX (divide by 100)
  Abandoned:  AVG of last cartValue > 0 per session, abandoned set
  Rationale: tells you the price point of customers who complete

Row 2 — Avg items in cart
  Label: "Avg items in cart"
  Converted: AVG("cartItemCount") from last cart event with cartItemCount > 0
             per session, converted set
  Abandoned: same, abandoned set
  Display: X.X

Row 3 — % who used a coupon
  Label: "Used a discount code"
  Converted: COUNT(DISTINCT sessionId with any coupon event) /
             COUNT(converted sessions) * 100
  Abandoned: same ratio for abandoned sessions
  Display: XX%
  Note: if Converted % > Abandoned % → coupons correlate with completion
        if Converted % < Abandoned % → coupons not helping conversions
        Do not show this note in UI — just the numbers, merchant draws conclusion

Row 4 — Median session duration
  Label: "Time in cart (median)"
  Converted: MEDIAN of (last_event.occurredAt - first_event.occurredAt)
             per session, converted set
             Display: "Xm Ys"
  Abandoned: same, abandoned set
  Note: use median not average — outliers (tabs left open for hours) skew average

Row 5 — Single product vs multi-product
  Label: "Cart composition"
  Converted: "X% single product · Y% multi-product"
             Single = cartItemCount = 1 at checkout click (or last event)
             Multi = cartItemCount > 1
  Abandoned: same ratio
  Display: "X% single · Y% multi" for each column

Row 6 — Most common product
  Label: "Most common product"
  Converted: most frequent productTitle appearing in lineItems
             across all converted sessions
  Abandoned: same, abandoned sessions
  Display: product name truncated at 35 chars

Row 7 — Most common product combination (multi-product carts only)
  Label: "Most common combination"
  Converted: most frequent pair of productTitles appearing together
             in lineItems across converted sessions with cartItemCount > 1
  Abandoned: same, abandoned sessions
  Display: "Product A + Product B"
  If insufficient data (fewer than 10 multi-product sessions): "—"
```

---

## ROW 2 — Conversion by Cart Value (full width)

```
Title:   "Conversion rate by cart value"
Sub:     "Based on [X] sessions · [date range]"

Component: Vertical bar chart
           Each bar = one cart value band
           X axis: $0–50 / $50–100 / $100–125 / $125–150 / $150–175 / $175–200 / $200+
           Note: $100–125 and $125–150 are narrower bands because drwater AOV is ~$124.
                 This gives more resolution around the expected conversion threshold.
                 For other merchants these will just be normal bands.
           Y axis: 0% to 100% conversion rate

           Rationale for bar chart (not line):
           These are discrete categories, not a continuous time series.
           Bar chart makes it easy to compare heights across categories.
           Line chart would imply a trend relationship that doesn't exist here.

Math per band:
  Numerator:   COUNT(DISTINCT sessionId) WHERE highest cartValue in session
               falls in this band AND sessionId in converted set
  Denominator: COUNT(DISTINCT sessionId) WHERE highest cartValue in session
               falls in this band AND (cart_checkout_clicked OR checkout_started)
               Use highest cartValue, not first cartValue — captures upsell effect
  Rate:        numerator / denominator * 100
  Sessions with cartValue = 0 or null: excluded entirely

Bar colours:
  Below overall avg conversion rate for the period: grey (#C4C4C4)
  At or above overall avg: Polaris blue (#2C6ECB), opacity increases with rate
  Bar with highest conversion rate: full blue, bold border

Reference lines (horizontal, across all bars):
  Line 1 — solid thin blue: merchant's AOV for the period (from card 4)
            Label: "Your AOV $XXX"
  Line 2 — dashed grey: overall conversion rate across all sessions
            Label: "Avg CVR XX%"

Tooltip on hover per bar:
  "[Band] carts"
  "Conversion rate: XX%"
  "X sessions attempted checkout in this range"
  "Y sessions completed order"

Below chart — one static insight line (template):
  Find band with highest conversion rate.
  Find band containing current AOV.
  If they are different bands:
    "Sessions with carts of [high band] convert at [X]% vs [Y]% for your
     average cart of $[AOV]."
  If same band:
    "Your average cart of $[AOV] is already in your best-converting range ([X]%)."
  If fewer than 10 sessions total: show nothing (empty state instead of chart)
```

---

## ROW 3 — Revenue Per Session by Coupon (full width)

```
Title:   "How discounts affect revenue per session"
Sub:     "Net revenue generated per session, by discount code · [date range]"

Component: Horizontal bar chart
           Each bar = one row (no coupon baseline + each code)
           X axis: revenue per session in dollars ($0 to $X max)
           Y axis: code names (No coupon at top, then codes sorted by rev/session DESC)

           Rationale for horizontal bar chart (not table):
           Visual length comparison is faster than reading numbers.
           Merchant immediately sees which bar is longest = best performing.
           A table is also shown below for the exact numbers.

First bar always: "No coupon (baseline)"
  Sessions:       COUNT(DISTINCT sessionId) WHERE no coupon events
                  AND cartValue > 0 AND occurredAt IN range
  Conv rate:      % of those sessions with checkout_completed
  Avg cart:       AVG of cartValue at checkout click, no-coupon sessions (cents/100)
  Avg discount:   $0
  Rev/session:    avg_cart_value * (conv_rate / 100)
  Bar colour:     grey

Per coupon code bar:
  Sessions:       COUNT(DISTINCT sessionId) WHERE any event has this couponCode
                  AND occurredAt IN range
  Conv rate:      sessions with this code AND checkout_completed /
                  sessions with this code * 100
  Avg cart:       AVG(cartValue) at time of coupon event for this code (cents/100)
  Avg discount:   AVG(discountAmount) WHERE couponSuccess=true AND couponCode=this
                  If no successful applications: $0
  Rev/session:    (avg_cart - avg_discount) * (conv_rate / 100)
  Bar colour:
    Higher rev/session than baseline: Polaris green (#108043)
    Lower rev/session than baseline: Polaris red (#D82C0D)
    Within ±$5 of baseline: grey

  Delta label at end of each bar:
    "+$XX vs no coupon" (green) or "-$XX vs no coupon" (red)

  Fewer than 10 sessions: bar shown in grey, "Low data" label, excluded from colour logic

Below the chart — exact numbers table:
  Columns: Code | Sessions | Conv% | Avg cart | Avg discount | Rev/session | vs baseline
  Same data as chart, for merchants who want exact figures.
  Sortable by any column.
  "No coupon" row always pinned at top.

Note below table (static):
  "Rev/session = (avg cart value − avg discount) × conversion rate.
   A code with higher rev/session than baseline generates more net revenue
   per visitor than no discount at all."
```

---

---

# PAGE 4 — DISCOUNTS
**Route:** /dashboard/v2/discounts
**Purpose:** Monitor health of every discount code.
            Is each code working? What happens when a specific code is used?
**Date range:** Default Last 30 days. All presets available.
               Rationale: discount analysis needs enough volume to be meaningful.
               Merchant can still change to any range.

---

## ROW 1 — 3 Inline Summary Numbers

```
Format: "X codes active  ·  X healthy  ·  X need attention"
Not cards — just one line of text with "|" separators.
"Active" = attempted at least once in the selected date range.
"Need attention" = Degraded or Broken status (see logic below).
```

---

## ROW 2 — Codes Table

```
Sort: default by attempts DESC (most used codes first)
Allow sort by: attempts, success rate, rev/session, last seen

Columns:

Status
  Coloured dot only (no label — dot colour is self-explanatory with legend)
  Green = Healthy: success rate >= 50%
  Amber = Degraded: success rate 20–49%
  Red = Broken: success rate < 20%
  Legend: small "● Healthy  ● Degraded  ● Broken" below table title

Code
  Code name in monospace font

Attempts
  COUNT(DISTINCT sessionId) WHERE couponCode = this code
  AND occurredAt IN range

Success rate
  COUNT(sessions where couponSuccess=true for this code) /
  COUNT(sessions where any coupon event for this code) * 100
  Display: XX% with same colour as status dot

Avg cart value
  AVG(cartValue) FROM CartEvent WHERE couponCode = this code
  AND eventType IN (cart_coupon_applied, cart_coupon_failed, cart_coupon_recovered)
  Display: $XXX.XX (divide by 100)

Recoveries
  COUNT(DISTINCT sessionId) FROM CartEvent
  WHERE couponCode = this code AND couponRecovered = true
  Display: "X unlocked" if > 0, "—" if 0
  Rationale: recoveries are a positive signal — shows threshold discount is
             changing customer behaviour, worth calling out

Rev/session
  Same math as Cart Performance page.
  Display: $XX.XX
  Grey with "Low data" label if fewer than 10 sessions

Last seen
  MAX(occurredAt) WHERE couponCode = this code
  Display: "Today" / "Yesterday" / "Mar 12" / "Feb 28"

Click any row → opens Code Detail panel (right side panel, full height)
```

---

## CODE DETAIL PANEL

```
Opens on row click. Right side panel, does not navigate away from page.
Close button top right.

Header:
  Code name (large, monospace)
  Status dot + label
  "X attempts in [date range]"

Section 1 — Attempt trend
  Component: Line chart with two lines
  X axis: daily (or hourly if Today selected)
  Y axis: count of events
  Line 1 (grey): daily attempt count (all coupon events for this code)
  Line 2 (green): daily success count (couponSuccess=true events for this code)
  Rationale: two lines on same axes shows immediately if successes
             flatlined while attempts continued = code broke on a specific day.
             Bar chart would make this comparison harder to see.

Section 2 — Summary stats (4 numbers in a 2x2 grid)
  Success rate this period vs previous period:
    "XX% success (was YY% last period)"
  Avg cart with this code vs store avg:
    "$XXX.XX (store avg $YYY.YY)"
  Rev/session vs baseline:
    "$XX.XX (baseline $YY.YY)"
  Total discount given:
    SUM(discountAmount) WHERE couponSuccess=true AND couponCode=this
    Display: "$XXX.XX given across X orders"

Section 3 — Recovery detail (only show if recoveries > 0)
  Title: "X customers unlocked this code by adding items"
  Avg cart before adding items:
    AVG(cartValue) from cart_coupon_failed event for this code (cents/100)
  Avg cart after unlocking:
    AVG(cartValue) from cart_coupon_recovered event for this code (cents/100)
  Avg cart value increase:
    recovered_avg - failed_avg, display as "+$XX.XX"
  Avg items added to qualify:
    AVG(cartItemCount) from cart_coupon_recovered - AVG(cartItemCount)
    from cart_coupon_failed for same session
  Rationale: this shows merchant exactly how their threshold discount is
             changing cart composition — the most valuable coupon intelligence
             in the product.

Section 4 — Recent sessions (last 10)
  Mini table: Time | Cart value | Outcome | Applied/Failed
  Each row: clicking "View →" opens that session in Cart Sessions modal
  Outcome badge: same as Cart Sessions table
```

---

---

# PAGE 5 — NOTIFICATIONS
**Route:** /dashboard/v2/notifications
**Purpose:** Alerts ranked by severity. What needs merchant attention?
**Date range:** Filter applies to alert timestamp (when alert fired).

---

## ROW 1 — Summary (inline)

```
"X unread  ·  X critical  ·  X warnings"
"Mark all as read" link at right end.
```

---

## ROW 2 — Filter Tabs

```
Tabs: All | Critical | Warnings | Info | Dismissed
Default: All
```

---

## ROW 3 — Alerts List

```
Each alert is one row:
  [severity dot]  [title]  [body]  [timestamp]  [link]  [dismiss X]

Severity dot:
  Red = Critical
  Amber = Warning
  Blue = Info

Title: one line, specific. See alert definitions below.
Body: one line, specific number. See alert definitions below.
Timestamp: relative — "2 hours ago" / "Yesterday at 4pm" / "Mar 12 at 9am"
Link: text link "→ View" — destination defined per alert type below
Dismiss: X button, moves alert to Dismissed tab

Unread alerts have a subtle left border in severity colour.
Clicking anywhere on the row (not the dismiss button) marks as read.
```

---

## ALERT DEFINITIONS

### Critical alerts (red)

```
Alert: Coupon broken
  Trigger: a coupon code has >= 10 attempts AND < 10% success rate
           in any rolling 2-hour window
  Title:   "[CODE] may be broken"
  Body:    "X attempts, X% success rate in the last 2 hours"
  Link:    → /dashboard/v2/discounts — opens that code's detail panel

Alert: CVR drop
  Trigger: checkout CVR drops > 40% below the 7-day rolling baseline
           for > 30 consecutive minutes
           (e.g. baseline 50% CVR → current CVR below 30%)
  Title:   "Checkout conversion dropped sharply"
  Body:    "CVR is X% — your 7-day baseline is Y%"
  Link:    → /dashboard/v2/overview
```

### Warning alerts (amber)

```
Alert: Coupon degraded
  Trigger: coupon code success rate 20–49% over last 24 hours
           with at least 5 attempts
  Title:   "[CODE] success rate is low"
  Body:    "X% success rate across Y attempts today"
  Link:    → /dashboard/v2/discounts — that code's detail panel

Alert: Step dropout spike
  Trigger: dropout at any single checkout step > 2x the 7-day baseline
           for that step, with at least 5 sessions affected
  Title:   "High dropout at [step name]"
  Body:    "X% dropping at [step] vs Y% baseline"
  Link:    → /dashboard/v2/overview (scrolled to funnel)
```

### Info alerts (blue)

```
Alert: Cart recoveries
  Trigger: at least 3 cart_coupon_recovered events today
  Title:   "X cart recoveries today"
  Body:    "[CODE] unlocked X times"
  Link:    → /dashboard/v2/discounts — that code's detail panel

Alert: New country
  Trigger: a country appears in CartEvent that has not appeared
           in the previous 30 days
  Title:   "First sessions from [Country]"
  Body:    "X sessions from [Country] in the last 24 hours"
  Link:    → /dashboard/v2/cart — filtered to that country
```

---

---

# API ROUTES — V2

All new. All read-only. No writes. All under /api/v2/.

```
GET /api/v2/overview?shop=X&start=Y&end=Z
  Returns: kpi cards (4 values + sparklines + deltas),
           funnel steps (current + previous period),
           recent alerts (last 3)

GET /api/v2/cart/sessions?shop=X&start=Y&end=Z&[filters]
  Filter params: outcome, country, device, minCart, maxCart,
                 hasCoupon, product, page (pagination)
  Returns: session list (25 per page), scoped counts

GET /api/v2/cart/session?shop=X&sessionId=Y
  Returns: full timeline for one session
           (CartEvent + CheckoutEvent merged and sorted)

GET /api/v2/performance?shop=X&start=Y&end=Z
  Returns: converted vs abandoned comparison table,
           conversion by cart value bands,
           revenue per session by coupon code

GET /api/v2/discounts?shop=X&start=Y&end=Z
  Returns: codes table with all metrics,
           summary counts (active, healthy, needs attention)

GET /api/v2/discounts/[code]?shop=X&start=Y&end=Z
  Returns: code detail panel data
           (trend chart, summary stats, recovery detail, recent sessions)

GET /api/v2/notifications?shop=X&start=Y&end=Z&severity=all
  Returns: alerts list with read/unread status

POST /api/v2/notifications/[id]/read
  Marks one alert as read. Writes to AlertLog.isRead field.
  Only write endpoint in v2.
```

---

---

# BUILD SEQUENCE FOR CLAUDE CODE

Build in this order. Each step is independently deployable.

```
Step 1: API routes + data layer
  Build all /api/v2/* routes first with real data.
  Test each with curl before building any UI.
  Confirm data is correct before touching pages.

Step 2: Layout + nav
  Create /dashboard/v2/ layout with the 5-item nav.
  No content yet — just shell pages with "Coming soon" placeholders.
  Confirm nav works and old /dashboard/* routes are completely unaffected.

Step 3: Overview page
  Build all 4 KPI cards, funnel chart, steps tables, alerts strip.

Step 4: Cart Sessions page
  Build filter bar, scoped counts, session table, timeline modal.

Step 5: Cart Performance page
  Build comparison table, conversion bands chart, revenue per session chart.

Step 6: Discounts page
  Build codes table, code detail panel.

Step 7: Notifications page
  Build alerts list with severity, filters, mark as read.

Step 8: Review on real data, fix, then merge to main.
```
