# Cart Page — Restructured Spec for Claude Code

## CONTEXT
This replaces the current Cart page which has two tabs: Conversion and Activity.
The current Conversion tab shows a product/source/device toggle table that displays 0% CTR and $0 values — it's not useful.
The current Activity tab shows time distribution and removals — partially useful.

This spec describes a SINGLE page (no tabs) with 5 sections that replace both tabs.

## SAFETY
- DO NOT modify any other pages (Analytics, Cart Sessions, Coupons, Notifications)
- DO NOT modify layout.tsx nav (keep "Cart" link as-is)
- DO NOT modify any API routes for other pages
- DO NOT modify the pixel extensions
- `npx next build` must succeed before pushing
- Test on Dr.Water before any deployment

## FILE CHANGES

### Files to DELETE:
None — we're modifying the existing cart page, not deleting files.

### Files to MODIFY:
```
app/(embedded)/couponmaxx/cart/page.tsx  — complete rewrite
app/api/couponmaxx/cart/route.ts         — new API (create if doesn't exist, or modify)
```

### Files to CREATE:
None — everything goes in the existing cart page file and one API route.

---

## PAGE LAYOUT

URL: `/couponmaxx/cart`
Nav label: "Cart" (unchanged)

Page title: "Cart & Checkout"
Subtitle: "What happens between add-to-cart and purchase"

Date picker: top right (reuse existing DateRangePicker component)

The page has 5 sections, stacked vertically. No tabs. Scroll down to see all.

---

## SECTION 1: TODAY VS NORMAL

### Purpose
The merchant opens this page when something feels wrong. This section immediately shows whether today is different from the recent average, and WHERE in the funnel the difference is.

### Layout
A horizontal funnel with 4 steps. Each step shows today's value AND the 7-day trailing average, with the percentage point change.

### Data

The funnel has 4 steps:

| Step | Definition | Source |
|------|-----------|--------|
| Sessions | Distinct sessions with at least one page_viewed OR product_viewed event | CartEvent where eventType IN ('page_viewed', 'product_viewed') — if these events aren't captured in CartEvent, use cart_item_added as the top of funnel instead |
| Added to cart | Distinct sessions with at least one cart_item_added event | CartEvent where eventType = 'cart_item_added' |
| Started checkout | Distinct sessions with a cart_checkout_clicked event | CartEvent where eventType = 'cart_checkout_clicked' |
| Completed checkout | Distinct sessions with a checkout_completed event | CartEvent where eventType = 'checkout_completed' OR CheckoutEvent where eventType = 'checkout_completed' |

IMPORTANT: Check if page_viewed events exist in CartEvent. If they do NOT exist in CartEvent (they may only be in CheckoutEvent or not stored at all), then the funnel starts at "Added to cart" as step 1, making it a 3-step funnel. Do NOT show a Sessions step with 0 data.

For each step, calculate:
- Today's count (using the current UTC date)
- 7-day trailing average (average daily count for the 7 days before today)
- Change: ((today - avg) / avg) * 100, displayed as "▲ X%" or "▼ X%"

### Visual

Each step is a card in a horizontal row. Between each pair of cards, show the RATE (step N / step N-1 * 100) and the rate change vs average.

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Sessions         │    │ Added to cart    │    │ Started checkout │    │ Completed        │
│ Today: 112       │ →  │ Today: 14        │ →  │ Today: 4         │ →  │ Today: 2          │
│ 7d avg: 130      │    │ 7d avg: 18       │    │ 7d avg: 9        │    │ 7d avg: 7          │
│ ▼ 14%            │    │ ▼ 22%            │    │ ▼ 56%            │    │ ▼ 71%              │
│                  │    │                  │    │                  │    │                    │
│          Rate: 12.5%  │         Rate: 28.6% │          Rate: 50%   │
│          Avg: 13.8%   │         Avg: 50.0%  │          Avg: 77.8%  │
│          ▼ 1.3pp      │         ▼ 21pp  🔴  │          ▼ 28pp  🔴  │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Highlighting rule
If a rate drops by more than 5 percentage points vs the 7-day average, highlight that rate in RED (#D72C0D). This draws the merchant's eye to the broken step.

If ALL rates are within 5pp of average, show a subtle green message: "All funnel steps are within normal range today."

### Below the funnel: UTM source breakdown (ONLY show problems)

A small table that appears ONLY if any source has a rate drop > 10pp vs its 7-day average. If no source has a significant drop, don't show this table at all.

| Column | Content |
|--------|---------|
| Source / Medium | UTM source + medium |
| Checkout start rate today | % |
| Checkout start rate 7d avg | % |
| Change | pp difference, red if negative |

Only show rows where the drop is > 10pp. Limit to top 5 sources by session volume.

### Supabase RPC: `cart_funnel_today_vs_avg`

Parameters: `p_shop_id TEXT, p_today_start TIMESTAMP, p_today_end TIMESTAMP`

Returns:
```json
{
  "today": {
    "sessions": 112,        // or null if page_viewed not captured
    "added_to_cart": 14,
    "started_checkout": 4,
    "completed_checkout": 2
  },
  "avg_7d": {
    "sessions": 130,
    "added_to_cart": 18,
    "started_checkout": 9,
    "completed_checkout": 7
  }
}
```

### Supabase RPC: `cart_funnel_by_source_today`

Parameters: `p_shop_id TEXT, p_today_start TIMESTAMP, p_today_end TIMESTAMP`

Returns array of:
```json
{
  "source": "google",
  "medium": "cpc",
  "today_atc": 8,
  "today_checkout": 1,
  "avg_atc": 10,
  "avg_checkout": 5
}
```

---

## SECTION 2: CHECKOUT STEP FUNNEL

### Purpose
Shows where INSIDE checkout people drop off. This uses checkout-monitor pixel events that capture each checkout step.

### Data

Count distinct sessions that reached each checkout step:

| Step | Event |
|------|-------|
| Started checkout | checkout_started |
| Contact info entered | checkout_contact_info_submitted |
| Address entered | checkout_address_info_submitted |
| Shipping selected | checkout_shipping_info_submitted |
| Payment entered | payment_info_submitted |
| Completed | checkout_completed |

IMPORTANT: These events may be in CheckoutEvent table, NOT CartEvent. Check which table has these eventTypes. The checkout-monitor extension sends to `/api/pixel/ingest` which stores in CheckoutEvent. The cart-monitor extension sends to `/api/cart/ingest` which stores in CartEvent. Query BOTH tables or the correct one.

If checkout step events are NOT being captured (0 results), show a message: "Checkout step data requires the checkout pixel extension. Contact support to enable." and skip this section.

### Visual

A vertical funnel. Each step is a horizontal bar. Width proportional to count. Show count and % of started.

```
Started checkout        ████████████████████████████████  52 (100%)
Contact info            ██████████████████████████████    48 (92%)   — 4 dropped
Address                 ████████████████████████████      45 (87%)   — 3 dropped
Shipping                ██████████████████████            38 (73%)   — 7 dropped  🔴
Payment                 █████████████████                 31 (60%)   — 7 dropped  🔴
Completed               ██████████████                    28 (54%)   — 3 dropped
```

### Highlighting rule
The step with the LARGEST absolute drop gets a red marker. If two steps tie, mark both.

### Supabase RPC: `checkout_step_funnel`

Parameters: `p_shop_id TEXT, p_start TIMESTAMP, p_end TIMESTAMP`

Query logic:
```sql
SELECT
  COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_started' THEN "sessionId" END) as started,
  COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_contact_info_submitted' THEN "sessionId" END) as contact,
  COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_address_info_submitted' THEN "sessionId" END) as address,
  COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_shipping_info_submitted' THEN "sessionId" END) as shipping,
  COUNT(DISTINCT CASE WHEN "eventType" = 'payment_info_submitted' THEN "sessionId" END) as payment,
  COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_completed' THEN "sessionId" END) as completed
FROM "CheckoutEvent"
WHERE "shopId" = p_shop_id
AND "occurredAt" >= p_start AND "occurredAt" <= p_end;
```

If all values are 0, this section should be hidden entirely (checkout pixel not active).

---

## SECTION 3: LAST ACTIVITY IN ABANDONED SESSIONS

### Purpose
For sessions that had cart activity but never checked out, show what the LAST event was. Pure data — no interpretation, no "why" labels.

### Data

For each session where:
- Has at least one cart_item_added event
- Does NOT have a cart_checkout_clicked event (abandoned)

Find the LAST CartEvent (by occurredAt) and bucket by eventType:

| Last event | Label to display |
|-----------|-----------------|
| cart_coupon_failed | Coupon attempt (failed) |
| cart_coupon_applied | Coupon attempt (succeeded) |
| cart_item_removed | Item removed from cart |
| cart_item_added | Item added to cart |
| cart_item_changed | Quantity changed |
| cart_page_hidden | Left the page |
| cart_viewed or cart_fetched | Cart viewed (no action) |

Also detect: sessions that have cart_checkout_clicked BUT do NOT have checkout_completed, AND have cart events AFTER the checkout click. Label: "Returned from checkout to cart"

### Visual

A horizontal bar chart. Each bar is a "last event" category. Bar width = session count. Show count and % of total abandoned.

```
Last activity in abandoned sessions (280 sessions, Mar 19-26)

Item added to cart          ████████████████████  89  (31.8%)
Cart viewed, no action      ███████████████       67  (23.9%)
Item removed from cart      ██████████            34  (12.1%)
Returned from checkout      ██████                22  (7.9%)
Coupon attempt (failed)     █████                 18  (6.4%)
Quantity changed            ███                    9  (3.2%)
Coupon attempt (succeeded)  █                      4  (1.4%)
Page left                   ████████████          37  (13.2%)
```

Sort by count descending.

### Supabase RPC: `cart_abandoned_last_event`

Parameters: `p_shop_id TEXT, p_start TIMESTAMP, p_end TIMESTAMP`

This is complex SQL. Approach:

```sql
WITH abandoned AS (
  -- Sessions with cart activity but no checkout click
  SELECT DISTINCT "sessionId"
  FROM "CartEvent"
  WHERE "shopId" = p_shop_id
  AND "occurredAt" >= p_start AND "occurredAt" <= p_end
  AND "eventType" = 'cart_item_added'
  EXCEPT
  SELECT DISTINCT "sessionId"
  FROM "CartEvent"
  WHERE "shopId" = p_shop_id
  AND "occurredAt" >= p_start AND "occurredAt" <= p_end
  AND "eventType" = 'cart_checkout_clicked'
),
returned_from_checkout AS (
  -- Sessions that clicked checkout but then had MORE cart events after
  SELECT DISTINCT ce1."sessionId"
  FROM "CartEvent" ce1
  WHERE ce1."shopId" = p_shop_id
  AND ce1."eventType" = 'cart_checkout_clicked'
  AND EXISTS (
    SELECT 1 FROM "CartEvent" ce2
    WHERE ce2."sessionId" = ce1."sessionId"
    AND ce2."occurredAt" > ce1."occurredAt"
    AND ce2."eventType" IN ('cart_item_added', 'cart_item_removed', 'cart_item_changed', 'cart_coupon_applied', 'cart_coupon_failed')
  )
  AND ce1."sessionId" NOT IN (
    SELECT "sessionId" FROM "CartEvent"
    WHERE "eventType" = 'checkout_completed' AND "shopId" = p_shop_id
  )
),
last_events AS (
  SELECT DISTINCT ON ("sessionId")
    "sessionId",
    "eventType"
  FROM "CartEvent"
  WHERE "shopId" = p_shop_id
  AND "occurredAt" >= p_start AND "occurredAt" <= p_end
  AND "sessionId" IN (SELECT "sessionId" FROM abandoned)
  ORDER BY "sessionId", "occurredAt" DESC
)
SELECT
  CASE
    WHEN le."sessionId" IN (SELECT "sessionId" FROM returned_from_checkout) THEN 'returned_from_checkout'
    ELSE le."eventType"
  END as last_event,
  COUNT(*) as session_count
FROM last_events le
GROUP BY 1
ORDER BY session_count DESC;
```

Note: The "returned from checkout" detection may need to query both CartEvent and CheckoutEvent. If checkout_completed is only in CheckoutEvent, adjust the NOT IN subquery accordingly.

---

## SECTION 4: CHECKOUT TIMING

### Purpose
Show how long checkout takes for people who complete it, and how long people who DON'T complete it stay before leaving.

### Data

**For completed sessions:**
Time from cart_checkout_clicked to checkout_completed.

**For abandoned checkout sessions (started but didn't complete):**
Time from cart_checkout_clicked (or checkout_started) to their last checkout event.

### Visual

Two side-by-side distributions:

**Left: "Time to complete checkout" (completed sessions)**
Bar chart. Buckets: Under 1 min, 1-3 min, 3-5 min, 5-10 min, 10+ min.

**Right: "Time in checkout before leaving" (abandoned checkout sessions)**
Bar chart. Same buckets.

The comparison tells the merchant: if completed checkouts take 2-3 minutes but abandoned ones leave within 30 seconds, the abandoners saw something immediately and bounced (likely shipping cost or total).

### Below the charts: The existing "How long customers take before checking out" chart

Keep the existing time-to-checkout distribution from the Activity tab. This shows time from first add-to-cart to checkout click. It's good data — just move it here under the checkout timing section.

### Supabase RPC: `checkout_timing_distribution`

Parameters: `p_shop_id TEXT, p_start TIMESTAMP, p_end TIMESTAMP`

```sql
-- Completed: time from checkout_started to checkout_completed
WITH completed AS (
  SELECT
    ce."sessionId",
    MIN(CASE WHEN ce."eventType" IN ('cart_checkout_clicked', 'checkout_started') THEN ce."occurredAt" END) as start_time,
    MIN(CASE WHEN ce."eventType" = 'checkout_completed' THEN ce."occurredAt" END) as end_time
  FROM (
    SELECT * FROM "CartEvent" WHERE "shopId" = p_shop_id AND "occurredAt" >= p_start AND "occurredAt" <= p_end
    UNION ALL
    SELECT * FROM "CheckoutEvent" WHERE "shopId" = p_shop_id AND "occurredAt" >= p_start AND "occurredAt" <= p_end
  ) ce
  WHERE ce."eventType" IN ('cart_checkout_clicked', 'checkout_started', 'checkout_completed')
  GROUP BY ce."sessionId"
  HAVING MIN(CASE WHEN ce."eventType" = 'checkout_completed' THEN ce."occurredAt" END) IS NOT NULL
),
-- Abandoned: time from checkout_started to last event
abandoned AS (
  SELECT
    ce."sessionId",
    MIN(CASE WHEN ce."eventType" IN ('cart_checkout_clicked', 'checkout_started') THEN ce."occurredAt" END) as start_time,
    MAX(ce."occurredAt") as last_event_time
  FROM (
    SELECT * FROM "CartEvent" WHERE "shopId" = p_shop_id AND "occurredAt" >= p_start AND "occurredAt" <= p_end
    UNION ALL
    SELECT * FROM "CheckoutEvent" WHERE "shopId" = p_shop_id AND "occurredAt" >= p_start AND "occurredAt" <= p_end
  ) ce
  WHERE ce."sessionId" IN (
    -- Sessions that started checkout but didn't complete
    SELECT DISTINCT "sessionId" FROM "CartEvent"
    WHERE "eventType" = 'cart_checkout_clicked' AND "shopId" = p_shop_id
    EXCEPT
    SELECT DISTINCT "sessionId" FROM "CheckoutEvent"
    WHERE "eventType" = 'checkout_completed' AND "shopId" = p_shop_id
  )
  GROUP BY ce."sessionId"
)
SELECT 'completed' as type,
  CASE
    WHEN EXTRACT(EPOCH FROM (end_time - start_time)) < 60 THEN 'under_1_min'
    WHEN EXTRACT(EPOCH FROM (end_time - start_time)) < 180 THEN '1_3_min'
    WHEN EXTRACT(EPOCH FROM (end_time - start_time)) < 300 THEN '3_5_min'
    WHEN EXTRACT(EPOCH FROM (end_time - start_time)) < 600 THEN '5_10_min'
    ELSE '10_plus_min'
  END as bucket,
  COUNT(*) as count
FROM completed
WHERE start_time IS NOT NULL AND end_time IS NOT NULL
GROUP BY 1, 2

UNION ALL

SELECT 'abandoned' as type,
  CASE
    WHEN EXTRACT(EPOCH FROM (last_event_time - start_time)) < 60 THEN 'under_1_min'
    WHEN EXTRACT(EPOCH FROM (last_event_time - start_time)) < 180 THEN '1_3_min'
    WHEN EXTRACT(EPOCH FROM (last_event_time - start_time)) < 300 THEN '3_5_min'
    WHEN EXTRACT(EPOCH FROM (last_event_time - start_time)) < 600 THEN '5_10_min'
    ELSE '10_plus_min'
  END as bucket,
  COUNT(*) as count
FROM abandoned
WHERE start_time IS NOT NULL
GROUP BY 1, 2;
```

---

## SECTION 5: CONVERTERS VS NON-CONVERTERS

### Purpose
Show how sessions that started checkout DIFFER from sessions that didn't. Pure data comparison. Merchant sees the patterns and draws their own conclusions.

### Data

Two groups:
- **Converters:** Sessions that have cart_checkout_clicked
- **Non-converters:** Sessions that have cart_item_added but NOT cart_checkout_clicked

### Visual

A side-by-side comparison table:

```
                              Started checkout    Didn't start
Avg time in cart:             1m 42s              4m 12s
Avg items in cart:            1.8                 2.4
Avg cart value:               $94                 $67
Used a coupon:                62%                 28%
Coupon failed:                3%                  14%
Had item removed:             8%                  31%
From paid traffic:            45%                 72%
On mobile:                    52%                 71%
```

Each row is a fact. The merchant reads: "Non-converters were more likely to be on mobile (71% vs 52%), from paid traffic (72% vs 45%), had more coupon failures (14% vs 3%), and removed items more (31% vs 8%)."

### Supabase RPC: `cart_converter_comparison`

Parameters: `p_shop_id TEXT, p_start TIMESTAMP, p_end TIMESTAMP`

```sql
WITH sessions AS (
  SELECT
    "sessionId",
    BOOL_OR("eventType" = 'cart_checkout_clicked') as converted,
    MAX("cartValue") as max_cart_value,
    COUNT(DISTINCT CASE WHEN "eventType" = 'cart_item_added' THEN "occurredAt" END) as items_added,
    BOOL_OR("eventType" = 'cart_coupon_applied') as used_coupon,
    BOOL_OR("eventType" = 'cart_coupon_failed') as coupon_failed,
    BOOL_OR("eventType" = 'cart_item_removed') as had_removal,
    MAX("device") as device,
    MAX("utmSource") as utm_source,
    MIN("occurredAt") as first_event,
    MAX(CASE WHEN "eventType" = 'cart_checkout_clicked' THEN "occurredAt" END) as checkout_time,
    COUNT(*) as total_events
  FROM "CartEvent"
  WHERE "shopId" = p_shop_id
  AND "occurredAt" >= p_start AND "occurredAt" <= p_end
  AND "eventType" LIKE 'cart_%'
  GROUP BY "sessionId"
  HAVING BOOL_OR("eventType" = 'cart_item_added')
)
SELECT
  converted,
  COUNT(*) as session_count,
  ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(checkout_time, first_event + interval '1 second') - first_event)))) as avg_time_seconds,
  ROUND(AVG(items_added), 1) as avg_items,
  ROUND(AVG(max_cart_value) / 100.0, 2) as avg_cart_value_dollars,
  ROUND(COUNT(*) FILTER (WHERE used_coupon)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as coupon_usage_pct,
  ROUND(COUNT(*) FILTER (WHERE coupon_failed)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as coupon_failed_pct,
  ROUND(COUNT(*) FILTER (WHERE had_removal)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as removal_pct,
  ROUND(COUNT(*) FILTER (WHERE utm_source IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as paid_traffic_pct,
  ROUND(COUNT(*) FILTER (WHERE device = 'mobile')::numeric / NULLIF(COUNT(*), 0) * 100, 1) as mobile_pct
FROM sessions
GROUP BY converted;
```

Note: "paid traffic" is approximated as "has any UTM source." This isn't perfect — some UTM sources are email, not paid. But it's a reasonable proxy. The column label should say "From UTM-tagged traffic" not "From paid traffic" to be honest.

Note: avg_time_seconds for non-converters should be the time from first event to LAST event (total session duration), not to checkout. Adjust the COALESCE to use MAX(occurredAt) instead.

---

## API ROUTE

### File: `app/api/couponmaxx/cart/route.ts`

Single route that calls all 5 RPCs and returns combined data.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getShopFromRequest } from "@/lib/verify-session-token";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const shopDomain = getShopFromRequest(req);
  if (!shopDomain) {
    return NextResponse.json({ error: "Missing shop" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "Missing date range" }, { status: 400 });
  }

  // Get shop ID
  const { data: shop } = await supabase
    .from("Shop")
    .select("id")
    .eq("shopDomain", shopDomain)
    .eq("isActive", true)
    .single();

  if (!shop) {
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  // Calculate today boundaries for Section 1
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = now.toISOString();

  // Run all RPCs in parallel
  const [funnelToday, funnelBySource, checkoutSteps, lastEvents, checkoutTiming, converterComparison] = await Promise.all([
    supabase.rpc("cart_funnel_today_vs_avg", { p_shop_id: shop.id, p_today_start: todayStart, p_today_end: todayEnd }),
    supabase.rpc("cart_funnel_by_source_today", { p_shop_id: shop.id, p_today_start: todayStart, p_today_end: todayEnd }),
    supabase.rpc("checkout_step_funnel", { p_shop_id: shop.id, p_start: start, p_end: end }),
    supabase.rpc("cart_abandoned_last_event", { p_shop_id: shop.id, p_start: start, p_end: end }),
    supabase.rpc("checkout_timing_distribution", { p_shop_id: shop.id, p_start: start, p_end: end }),
    supabase.rpc("cart_converter_comparison", { p_shop_id: shop.id, p_start: start, p_end: end }),
  ]);

  return NextResponse.json({
    funnelToday: funnelToday.data,
    funnelBySource: funnelBySource.data,
    checkoutSteps: checkoutSteps.data,
    lastEvents: lastEvents.data,
    checkoutTiming: checkoutTiming.data,
    converterComparison: converterComparison.data,
  });
}
```

---

## FRONTEND COMPONENTS

### Page file: `app/(embedded)/couponmaxx/cart/page.tsx`

Must have `'use client'` on line 1.

Use existing components:
- `DateRangePicker` from `components/couponmaxx/DateRangePicker`
- `KpiBox` from `components/couponmaxx/KpiBox` (if it exists, otherwise inline)
- `LoadingBar` from `components/couponmaxx/LoadingBar`

Use Recharts for charts:
- `BarChart`, `Bar`, `XAxis`, `YAxis`, `Tooltip`, `ResponsiveContainer` from 'recharts'
- ALL recharts imports must be in a file with `'use client'` directive

Use Polaris for layout:
- `Page`, `Card`, `BlockStack`, `InlineStack`, `Text`, `Badge` from '@shopify/polaris'

### Component structure:

```tsx
'use client';

export default function CartPage() {
  const shop = useShop();
  const [dateRange, setDateRange] = useState({ start, end });

  const { data, isLoading, error } = useSWR(
    shop ? `/api/couponmaxx/cart?shop=${shop}&start=${dateRange.start}&end=${dateRange.end}` : null,
    fetcher
  );

  return (
    <Page title="Cart & Checkout">
      <DateRangePicker ... />
      <LoadingBar loading={isLoading} />

      {/* Section 1: Today vs Normal */}
      <FunnelSection data={data?.funnelToday} sources={data?.funnelBySource} />

      {/* Section 2: Checkout Step Funnel */}
      <CheckoutStepsSection data={data?.checkoutSteps} />

      {/* Section 3: Last Activity in Abandoned Sessions */}
      <AbandonedLastEventSection data={data?.lastEvents} />

      {/* Section 4: Checkout Timing */}
      <CheckoutTimingSection data={data?.checkoutTiming} />

      {/* Section 5: Converters vs Non-Converters */}
      <ConverterComparisonSection data={data?.converterComparison} />
    </Page>
  );
}
```

Each section is a separate component defined in the same file or in `components/couponmaxx/cart/`. Keep it simple — define inline unless the file gets over 500 lines.

---

## STYLING RULES

- Background: #F1F1F1 (matches existing app background)
- Cards: white background, 8px border-radius, Polaris Card component
- Text: system font stack (already set in layout)
- KPI numbers: 28px, bold, #202223
- Rates that dropped significantly: #D72C0D (Polaris critical color)
- Rates that are normal/improved: #202223 (default text color) — do NOT make them green. Only highlight problems.
- Charts: bars in #202223 (black). No blue. No gradients. Single color.
- Red markers (🔴): use Polaris `<Badge status="critical">` component
- Section spacing: 24px between sections
- Card padding: Polaris default (16px)

---

## EMPTY STATES

If no data exists for the selected date range:
- Section 1: Show "No cart activity recorded for today" with greyed-out funnel
- Section 2: Show "Checkout step data not available" if all values are 0 (checkout pixel may not be active)
- Section 3: Show "No abandoned sessions in this period"
- Section 4: Show "No checkout timing data available"
- Section 5: Show "Not enough sessions to compare" if total sessions < 5

---

## VERIFICATION

After building, verify:

1. `npx next build` succeeds
2. Open on Dr.Water: Cart page loads without hydration errors
3. Section 1 shows today's funnel with comparison to average
4. Section 2 shows checkout steps (or "not available" message if no checkout events)
5. Section 3 shows last events for abandoned sessions
6. Section 4 shows timing distributions
7. Section 5 shows converter vs non-converter comparison
8. Date picker changes the data for sections 2-5 (section 1 always shows "today")
9. No console errors
10. Loading state shows LoadingBar while data fetches

---

## SUPABASE RPC CREATION

All 6 RPCs must be created in Supabase SQL Editor BEFORE the frontend is deployed.

Order of creation:
1. `cart_funnel_today_vs_avg`
2. `cart_funnel_by_source_today`
3. `checkout_step_funnel`
4. `cart_abandoned_last_event`
5. `checkout_timing_distribution`
6. `cart_converter_comparison`

Test each RPC in Supabase SQL editor with Dr.Water's shop ID before connecting to the frontend.

Important: Some RPCs need to query BOTH CartEvent and CheckoutEvent tables. Verify which eventTypes exist in which table:
- CartEvent: cart_item_added, cart_item_removed, cart_item_changed, cart_coupon_applied, cart_coupon_failed, cart_checkout_clicked, cart_page_hidden, cart_fetched, cart_viewed
- CheckoutEvent: checkout_started, checkout_contact_info_submitted, checkout_address_info_submitted, checkout_shipping_info_submitted, payment_info_submitted, checkout_completed, page_viewed, product_viewed

Run this verification query:
```sql
SELECT "eventType", COUNT(*) FROM "CartEvent" WHERE "shopId" = '<dr_water_shop_id>' GROUP BY 1 ORDER BY 2 DESC;
SELECT "eventType", COUNT(*) FROM "CheckoutEvent" WHERE "shopId" = '<dr_water_shop_id>' GROUP BY 1 ORDER BY 2 DESC;
```

The results will tell you exactly which events exist where and inform the RPC queries.
