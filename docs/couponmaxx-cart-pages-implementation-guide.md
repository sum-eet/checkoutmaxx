# CouponMaxx — Cart Pages Implementation Guide
> **Page 5: `/couponmaxx/cart` — Conversion + Activity Tabs**  
> Appended to the existing couponmaxx-ui-spec.md spec set.  
> For Claude Code — read in full before writing a single line.

---

## Table of Contents
1. [Guardrails](#1-guardrails)
2. [Build Sequence](#2-build-sequence)
3. [Database — Postgres Functions](#3-database--postgres-functions)
4. [API Routes](#4-api-routes)
5. [Page Header & Tabs](#5-page-header--tabs)
6. [Conversion Tab](#6-conversion-tab)
7. [Activity Tab](#7-activity-tab)
8. [New Components](#8-new-components)
9. [Empty States](#9-empty-states)
10. [Data Rules & Gotchas](#10-data-rules--gotchas)
11. [TypeScript Type Definitions](#11-typescript-type-definitions)
12. [Shopify Embedded App Patterns](#12-shopify-embedded-app-patterns)
13. [Changelog Entry](#13-changelog-entry)
14. [Pre-Deploy Checklist](#14-pre-deploy-checklist)

---

## 1. Guardrails

### ✕ Never Touch

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
All existing /api/couponmaxx/* routes   ← read before touching
All existing /couponmaxx/* pages        ← read before touching
shopify.app.toml
vercel.json
```

> ⚠️ These are production-critical. Modifying any of the above will break the pixel, ingest, and session ping pipelines.

---

### ✓ Files to Create (New Only)

```
app/(embedded)/couponmaxx/cart/page.tsx
app/api/couponmaxx/cart/conversion/route.ts
app/api/couponmaxx/cart/activity/route.ts
components/couponmaxx/ToggleGroup.tsx
components/couponmaxx/SideBySideComparison.tsx
supabase/cart-analytics-functions.sql
```

---

### ✎ One File to Update

```
app/(embedded)/couponmaxx/layout.tsx
```

Add exactly **one line** between Coupons and Notifications:

```tsx
<Link href="/couponmaxx/cart">Cart</Link>
```

Nothing else in `layout.tsx` changes.

---

## 2. Build Sequence

Execute in this exact order. Do not skip ahead.

| Step | Action | Success Criterion |
|------|--------|-------------------|
| 1 | `npx tsc --noEmit` | Zero pre-existing type errors |
| 2 | Write `supabase/cart-analytics-functions.sql` (all 9 functions) | File exists — print reminder to run in Supabase SQL editor |
| 3 | Build `/api/couponmaxx/cart/conversion/route.ts` | curl returns product, source, device data |
| 4 | Build `/api/couponmaxx/cart/activity/route.ts` | curl returns all fields without null panics |
| 5 | Build `components/couponmaxx/ToggleGroup.tsx` | No TS errors, renders pill group |
| 6 | Build `components/couponmaxx/SideBySideComparison.tsx` | No TS errors, renders two-column card |
| 7 | Build `app/(embedded)/couponmaxx/cart/page.tsx` | Both tabs render, toggles switch data |
| 8 | Add Cart nav item to `layout.tsx` | Exactly one line added |
| 9 | `npx tsc --noEmit` | Zero type errors |
| 10 | `npm run build` | Zero build errors |
| 11 | Test on drwater store with real data | KPIs show real numbers |
| 12 | Verify Shopify sidebar shows "Cart" | Nav item visible in embedded admin |
| 13 | `git add -A && git commit -m "feat: Cart Conversion and Cart Activity pages" && git push` | Clean push |

> ⚠️ **Step 2 (SQL) must be run in the Supabase SQL editor BEFORE testing the API routes.** The API routes call `supabase.rpc()` — if the functions do not exist in Postgres, every request will 500.

---

## 3. Database — Postgres Functions

**Rule: all analytics are computed in Postgres via `supabase.rpc()`. Never fetch raw `CartEvent` rows and compute in JS/TS — this will time out on large shops.**

File to create: `supabase/cart-analytics-functions.sql`

> 🖨️ **Print reminder at end of session:** "Run `supabase/cart-analytics-functions.sql` in Supabase SQL editor before testing."

---

### 3.1 Function Inventory

| # | Function | Returns | Used By |
|---|----------|---------|---------|
| 1 | `product_cart_conversion(shop, start, end)` | `ProductConversionRow[]` | Conversion → Products toggle |
| 2 | `median_time_to_checkout(shop, start, end, device?)` | `median_ms: bigint` | Activity KPI 1 + Devices comparison |
| 3 | `cart_time_distribution(shop, start, end)` | `{bucket, sessions}[]` | Activity → Time distribution chart |
| 4 | `source_cart_conversion(shop, start, end)` | `SourceConversionRow[]` | Conversion → Sources toggle |
| 5 | `device_cart_metrics(shop, start, end, device)` | `DeviceMetrics` | Conversion → Devices comparison |
| 6 | `top_countries_conversion(shop, start, end)` | `CountryRow[]` (top 5) | Conversion → below Devices |
| 7 | `cart_value_trend(shop, start, end)` | grew/shrank/unchanged + avgs | Activity → Cart value trend |
| 8 | `session_patterns(shop, start, end)` | oneAndDone, deliberate, lost | Activity → Session patterns |
| 9 | `product_removals(shop, start, end)` | `RemovalRow[]` | Activity → Products removed table |

---

### 3.2 Functions 1–3 (Provided in Spec — Copy Verbatim)

#### Function 1 — `product_cart_conversion`

```sql
CREATE OR REPLACE FUNCTION product_cart_conversion(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  product_title text,
  added_to_cart bigint,
  checked_out_with bigint,
  cart_to_checkout_rate numeric,
  removed_from_cart bigint,
  remove_rate numeric,
  avg_cart_value_when_added numeric
)
LANGUAGE sql STABLE AS $$
  WITH added AS (
    SELECT
      item->>'productTitle' as product_title,
      COUNT(DISTINCT "sessionId") as added_count,
      AVG("cartValue") as avg_cart_value
    FROM "CartEvent",
    jsonb_array_elements("lineItems") as item
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND "eventType" = 'cart_item_added'
      AND "lineItems" IS NOT NULL
    GROUP BY item->>'productTitle'
  ),
  removed AS (
    SELECT
      item->>'productTitle' as product_title,
      COUNT(*) as removed_count
    FROM "CartEvent",
    jsonb_array_elements("lineItems") as item
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND "eventType" = 'cart_item_removed'
      AND "lineItems" IS NOT NULL
    GROUP BY item->>'productTitle'
  ),
  checked_out AS (
    SELECT
      item->>'productTitle' as product_title,
      COUNT(DISTINCT ce."sessionId") as checkout_count
    FROM "CartEvent" ce,
    jsonb_array_elements(ce."lineItems") as item
    WHERE ce."shopId" = p_shop_id
      AND ce."occurredAt" >= p_start
      AND ce."occurredAt" <= p_end
      AND ce."eventType" = 'cart_checkout_clicked'
      AND ce."lineItems" IS NOT NULL
    GROUP BY item->>'productTitle'
  )
  SELECT
    a.product_title,
    a.added_count,
    COALESCE(c.checkout_count, 0),
    CASE WHEN a.added_count = 0 THEN 0
    ELSE ROUND(COALESCE(c.checkout_count, 0)::numeric / a.added_count * 100, 1)
    END,
    COALESCE(r.removed_count, 0),
    CASE WHEN a.added_count = 0 THEN 0
    ELSE ROUND(COALESCE(r.removed_count, 0)::numeric / a.added_count * 100, 1)
    END,
    ROUND(COALESCE(a.avg_cart_value, 0) / 100, 2)
  FROM added a
  LEFT JOIN checked_out c ON a.product_title = c.product_title
  LEFT JOIN removed r ON a.product_title = r.product_title
  WHERE a.added_count >= 3
  ORDER BY a.added_count DESC
$$;
```

> **Note:** The spec's original function has placeholder zeroes for `removed_from_cart` and `remove_rate`. The version above completes those with a proper removal subquery.

---

#### Function 2 — `median_time_to_checkout`

```sql
CREATE OR REPLACE FUNCTION median_time_to_checkout(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz,
  p_device text DEFAULT NULL
)
RETURNS TABLE(median_ms bigint)
LANGUAGE sql STABLE AS $$
  WITH session_times AS (
    SELECT
      ce."sessionId",
      MIN(ce."occurredAt") as first_add,
      MAX(CASE WHEN ce."eventType" = 'cart_checkout_clicked'
          THEN ce."occurredAt" END) as checkout_click
    FROM "CartEvent" ce
    WHERE ce."shopId" = p_shop_id
      AND ce."occurredAt" >= p_start
      AND ce."occurredAt" <= p_end
      AND (p_device IS NULL OR ce.device = p_device)
    GROUP BY ce."sessionId"
    HAVING MAX(CASE WHEN ce."eventType" = 'cart_checkout_clicked'
               THEN 1 END) = 1
  )
  SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (checkout_click - first_add)) * 1000
    )::bigint
  FROM session_times
  WHERE checkout_click IS NOT NULL
    AND first_add IS NOT NULL
    AND checkout_click > first_add
$$;
```

---

#### Function 3 — `cart_time_distribution`

```sql
CREATE OR REPLACE FUNCTION cart_time_distribution(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(bucket text, sessions bigint)
LANGUAGE sql STABLE AS $$
  WITH buckets(bucket, min_s, max_s) AS (
    VALUES
      ('Under 1 min', 0,    60),
      ('1-3 min',     60,   180),
      ('3-5 min',     180,  300),
      ('5-10 min',    300,  600),
      ('10-30 min',   600,  1800),
      ('30 min+',     1800, 999999)
  ),
  session_times AS (
    SELECT
      "sessionId",
      EXTRACT(EPOCH FROM (
        MAX(CASE WHEN "eventType" = 'cart_checkout_clicked'
            THEN "occurredAt" END) -
        MIN("occurredAt")
      )) as seconds
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
    GROUP BY "sessionId"
    HAVING MAX(CASE WHEN "eventType" = 'cart_checkout_clicked'
               THEN 1 END) = 1
  )
  SELECT
    b.bucket,
    COUNT(s."sessionId")
  FROM buckets b
  LEFT JOIN session_times s
    ON s.seconds >= b.min_s AND s.seconds < b.max_s
    AND s.seconds IS NOT NULL AND s.seconds > 0
  GROUP BY b.bucket, b.min_s
  ORDER BY b.min_s
$$;
```

> ⚠️ **Always return all 6 buckets — even if count = 0.** The `LEFT JOIN` against the `buckets` CTE above guarantees this. The spec's original version does not — this version fixes it.

---

### 3.3 Functions 4–9 (You Must Write)

Follow the `LANGUAGE sql STABLE` pattern from functions 1–3.

---

#### Function 4 — `source_cart_conversion`

Join `CartEvent` with `SessionPing` on `sessionId`. Group by `utmSource`.

**Display name rules:**
- `null` / empty → `"Direct"`
- `google` / `bing` + medium → `"Paid search · [medium]"`
- `instagram` / `facebook` / `tiktok` → `"Social · [source]"`
- `klaviyo` / `email` + campaign → `"Email · [campaign]"`
- anything else → raw `utmSource` value

**Return columns:**
- `source` (display name), `utm_source` (raw), `utm_medium`
- `cart_sessions`, `checked_out`, `cart_to_checkout_rate`
- `avg_cart_value` (dollars), `coupon_used_pct`

Sessions with no matching `SessionPing` row = `"Direct"`. This join must happen in the Postgres function, not the route handler.

---

#### Function 5 — `device_cart_metrics`

Filter `CartEvent` by `device` field. Accepts `p_device: 'mobile' | 'desktop' | 'tablet'`.

**Return columns:**
- `cart_sessions` (where `cartValue > 0`)
- `cart_to_checkout_rate`
- `median_time_to_checkout_ms` (reuse Function 2 pattern)
- `avg_cart_value_at_checkout` (`cartValue` at `cart_checkout_clicked` events, cents/100)
- `avg_items_in_cart` (`cartItemCount` at checkout, as decimal)
- `coupon_attempt_rate` (% sessions with any coupon event)

---

#### Function 6 — `top_countries_conversion`

Group by `country` field on `CartEvent`. 

**Rules:**
- Return top 5 by `cart_sessions` volume
- Include an `"Other"` aggregate row if more than 5 countries exist
- Minimum 3 sessions per country to appear

**Return columns:** `country`, `cart_sessions`, `cart_to_checkout_rate`, `avg_cart_value` (dollars)

---

#### Function 7 — `cart_value_trend`

Per session that reached checkout: compare `cartValue` at `first cart_item_added` vs `cartValue` at `cart_checkout_clicked`.

**Return:**
- `grew_pct` — % of sessions where checkout cartValue > first-add cartValue
- `grew_avg_increase_dollars` — avg dollar increase for growing sessions
- `shrank_pct` — % of sessions where checkout < first-add
- `shrank_avg_decrease_dollars` — avg dollar decrease for shrinking sessions
- `unchanged_pct` — `100 - grew - shrank`

---

#### Function 8 — `session_patterns`

**Three counts:**

1. **oneAndDone** — sessions with exactly 1 `cart_item_added` event AND `checkout_click`, no remove/change events
2. **deliberate** — sessions with 3+ `cart_item_added` + `cart_item_removed` + `cart_item_changed` events AND checked out
3. **lostAfterAdding** — sessions with `cart_item_added` AND no `checkout_click` AND last event timestamp > 5 minutes after first add

**Return each count + percentage of its respective total** (`oneAndDonePct` and `deliberatePct` = % of checked-out sessions; `lostAfterAddingPct` = % of all product sessions).

---

#### Function 9 — `product_removals`

Group `cart_item_removed` events by `productTitle`.

**Return columns:**
- `product_title`
- `times_removed`
- `remove_rate` — `(removed / added) * 100`
- `avg_cart_value_at_removal` — `AVG(cartValue)` at removal moment, cents/100
- `product_that_stayed` — most frequent co-occurring `productTitle` in `lineItems` at time of removal within the same session. `NULL` if no consistent pattern.

**Minimum 3 removal events to appear.**

> ⚠️ `product_that_stayed` requires a window function or lateral join over `lineItems` JSONB within the same session. Write and test this independently before integrating.

---

## 4. API Routes

### 4.1 `GET /api/couponmaxx/cart/conversion`

**Params:** `shop` (string), `start` (ISO datetime), `end` (ISO datetime)

Pre-fetches **all three toggle views** in a single response. The client switches between them without additional API calls.

**Response shape:**

```typescript
{
  kpis: {
    cartToCheckoutRate: number,         // 0–100
    cartToCheckoutRateDelta: number,    // pp change vs previous period
    cartSessions: number,
    cartSessionsDelta: number,          // % change
    abandonedCarts: number,
    abandonedCartsDelta: number,
    abandonedCartsPct: number,          // % of product sessions
  },
  products: ProductConversionRow[],
  sources:  SourceConversionRow[],
  devices: {
    mobile:  DeviceMetrics,
    desktop: DeviceMetrics,
    tablet?: DeviceMetrics,             // omit if < 10 tablet sessions in range
  },
  topCountries: CountryRow[],
}
```

**KPI delta:** Compute value for `start→end`, then for the immediately preceding range of the same length. `delta = current − previous`. Rate deltas in percentage points (pp); count deltas as % change.

**Abandoned carts:** `cartValue > 0` AND no `cart_checkout_clicked` AND no `checkout_started`, in range, for `shopId`.

---

### 4.2 `GET /api/couponmaxx/cart/activity`

**Params:** `shop`, `start`, `end`

**Response shape:**

```typescript
{
  kpis: {
    medianTimeToCheckoutMs: number,
    medianTimeToCheckoutDeltaMs: number,
    avgCartEditsPerSession: number,     // adds + removes + changes per session
    avgCartEditsDelta: number,
    avgCartValueChangePct: number,      // +ve = grew, -ve = shrank
    avgCartValueChangeDelta: number,
  },
  timeDistribution: {
    bucket: string,
    sessions: number
  }[],                                  // always exactly 6 items
  removals: RemovalRow[],
  cartValueTrend: {
    grewPct: number,
    grewAvgIncreaseDollars: number,
    shrankPct: number,
    shrankAvgDecreaseDollars: number,
    unchangedPct: number,
  },
  sessionPatterns: {
    oneAndDone: number,
    oneAndDonePct: number,
    deliberate: number,
    deliberatePct: number,
    lostAfterAdding: number,
    lostAfterAddingPct: number,
  },
}
```

**`avgCartEditsPerSession`:** sum of `cart_item_added` + `cart_item_removed` + `cart_item_changed` events per session, averaged across all product sessions in range. `1.0` = add and done. `4.5` = significant deliberation.

---

## 5. Page Header & Tabs

**Route:** `/couponmaxx/cart`  
**Default tab:** Conversion

### Header

| Property | Value |
|----------|-------|
| Title | `"Cart"` |
| Subtitle | `"Where your carts are leaking and what happens inside them."` |
| Subtitle style | 13px `#6B7280` |
| Date picker | Top-right, same as all pages. Default: Last 7 days |

### Tab Bar

Renders below the title, above content.

| State | Style |
|-------|-------|
| Active | 14px weight 500 `#111827`, `border-bottom: 2px #0EA5E9` |
| Inactive | 14px weight 400 `#6B7280`, no border |

---

## 6. Conversion Tab

> Answers: Where is the cart leaking? Which product, source, or device has the lowest cart-to-checkout rate?

---

### 6.1 KPI Row — Three Boxes

Same `KpiBox` component as other pages. Display only — not clickable filters.

#### Box 1 — Cart-to-checkout rate

| Field | Spec |
|-------|------|
| Label | `"Cart-to-checkout rate"` |
| Value | `COUNT(sessions with checkout) / COUNT(sessions with cartValue > 0 OR cartItemCount > 0) * 100` |
| Format | `XX.X%` |
| Sub-line 1 | `"[X] sessions reached checkout"` |
| Sub-line 2 | Delta: `"+X.Xpp"` green if improved, red if declined |

#### Box 2 — Cart sessions

| Field | Spec |
|-------|------|
| Label | `"Cart sessions"` |
| Value | `COUNT(DISTINCT sessionId) WHERE cartValue > 0 OR cartItemCount > 0, in range, for shop` |
| Format | Integer with comma separator e.g. `"1,284"` |
| Sub-line 1 | `"[X] with a coupon attempted"` |
| Sub-line 2 | Delta: `"+X%"` or `"-X%"` |

#### Box 3 — Abandoned carts

| Field | Spec |
|-------|------|
| Label | `"Abandoned carts"` |
| Value | `COUNT(DISTINCT sessionId) WHERE cartValue > 0 AND no checkout event` |
| Format | Integer |
| Sub-line 1 | `"[X]% of product sessions"` (abandoned / product sessions * 100) |
| Sub-line 2 | Delta vs previous period |

---

### 6.2 Toggle Table — Products / Sources / Devices

Full-width card. Three-way pill toggle right-aligned in the card header. Card title (left): `"Cart conversion by [active label]"`.

| Toggle element | Style |
|---------------|-------|
| Active button | Background `#0EA5E9`, white text, `border-radius: 6px` |
| Inactive button | Transparent bg, `#6B7280` text, `1px border #E3E3E3` |

---

#### Products toggle

| Column | Formula / Notes |
|--------|----------------|
| Product | `productTitle` from `lineItems`, truncated 35 chars, tooltip on hover |
| Added to cart | `COUNT(DISTINCT sessionId)` with this product + `cart_item_added` |
| Checked out with | `COUNT(DISTINCT sessionId)` with this product + checkout action |
| Cart-to-checkout rate | `(checked out / added) * 100` — ≥60% `#15803D` green · 40–59% `#B45309` amber · <40% `#B91C1C` red |
| Removed from cart | `COUNT cart_item_removed` events matching this `productTitle` — `"—"` if 0 |
| Remove rate | `(removed / added) * 100` — only shown if `removed > 0` — >30% amber |
| Avg cart value when added | `AVG(cartValue)` at `cart_item_added` for this product — cents/100 → `$XXX` |

- Minimum **3 sessions** to appear
- Default sort: **Added to cart descending**
- All column headers clickable for re-sort

---

#### Sources toggle

| Column | Formula / Notes |
|--------|----------------|
| Source | Display name (see rules below) |
| Sub-line | `utm_medium` if available, 11px grey |
| Cart sessions | `COUNT(DISTINCT sessionId)` with this `utmSource` AND `cartValue > 0` |
| Checked out | `COUNT(DISTINCT sessionId)` with this `utmSource` AND checkout action |
| Cart-to-checkout rate | Same colour coding as Products toggle |
| Avg cart value | `AVG(highest cartValue per session)` for this source — `$XXX` |
| Coupon used % | `% of sessions with any coupon event / sessions with cartValue > 0` |

**Display name rules:**
- `null` / empty → `"Direct"`
- `google` / `bing` → `"Paid search · [medium]"` e.g. `"Paid search · cpc"`
- `instagram` / `facebook` / `tiktok` → `"Social · [source]"`
- `klaviyo` / `email` → `"Email · [campaign]"` if campaign available
- anything else → raw `utmSource` value

Default sort: Cart sessions descending.

> ⚠️ Source data requires joining `CartEvent` with `SessionPing` on `sessionId`. Sessions with no matching `SessionPing` = `"Direct"`. This join must be in a Postgres function, not the route handler.

---

#### Devices toggle

**Not a table.** Uses `SideBySideComparison` component — two cards (1fr 1fr grid). Mobile card: phone icon. Desktop card: laptop icon. Each metric as a label + value row.

| Metric row | Formula |
|------------|---------|
| Cart sessions | `COUNT(DISTINCT sessionId)` WHERE `device = X` AND `cartValue > 0` |
| Cart-to-checkout rate | Same formula, filtered by device — colour coded |
| Avg time to checkout | `MEDIAN(first_add → checkout_click)` for checked-out sessions by device. Format: `"Xm Ys"` |
| Avg cart value at checkout | `AVG(cartValue at checkout_click)` per device — `$XXX` |
| Avg items in cart | `AVG(cartItemCount at checkout click)` per device — `X.X` |
| Coupon attempt rate | % of sessions per device with any coupon event |

**Tablet handling:** <10 tablet sessions → fold into Desktop column with note `"(includes X tablet sessions)"`. ≥10 tablet sessions → add a third column.

**Amber banner:** If Mobile cart-to-checkout rate is more than **15pp below** Desktop, show a subtle amber banner below the comparison:
> `"Mobile conversion is significantly lower than desktop"`

No recommendation — just the observation.

---

#### Top 5 Countries — below Devices

Always visible when Devices toggle is active. Title: `"By country"`.

| Column | Notes |
|--------|-------|
| Country | Flag emoji + country code |
| Cart sessions | Volume (used for ranking) |
| Cart-to-checkout rate | Colour coded |
| Avg cart value | `$XXX` |

- Minimum 3 sessions per country to appear
- `"Other"` row aggregates remaining countries if >5 exist

---

## 7. Activity Tab

> Answers: What happens inside the cart? How long do customers spend, what gets removed, how does cart value change?

---

### 7.1 KPI Row — Three Boxes

#### Box 1 — Median time to checkout

| Field | Spec |
|-------|------|
| Label | `"Median time to checkout"` |
| Value | `PERCENTILE_CONT(0.5)` of `(checkout_click.occurredAt − first cart_item_added.occurredAt)` for sessions that reached checkout |
| Format | `"Xm Ys"` e.g. `"6m 12s"` / `"45s"` / `"18m 4s"` |
| Why median | Outliers (tabs left open) skew the average badly — median is more honest |
| Sub-line 1 | `"For sessions that reached checkout"` |
| Sub-line 2 | Delta: `"+Xs"` or `"-Xm Ys"` |

#### Box 2 — Avg cart edits per session

| Field | Spec |
|-------|------|
| Label | `"Avg cart edits per session"` |
| Value | `AVG(cart_item_added + cart_item_removed + cart_item_changed per session)` across all product sessions |
| Format | `X.X` e.g. `"2.4"` |
| Sub-line 1 | `"Adds, removes, and quantity changes"` |
| Sub-line 2 | Delta: `"+X.X"` or `"-X.X"`. Note: higher = more deliberation |

#### Box 3 — Avg cart value change

| Field | Spec |
|-------|------|
| Label | `"Avg cart value change"` |
| Value | `AVG((cartValue_checkout − cartValue_first_add) / cartValue_first_add * 100)` for checked-out sessions |
| Format | `"+XX.X%"` positive / `"-XX.X%"` negative / `"0%"` flat |
| Colour | Green if positive · Red if negative · Grey if within ±2% |
| Sub-line 1 | Positive → `"Carts are growing before checkout"` / Negative → `"Customers are trimming carts before checkout"` / ~0 → `"Most customers buy what they first added"` |
| Sub-line 2 | Delta vs previous period |

---

### 7.2 Time Distribution Chart

| Property | Value |
|----------|-------|
| Title | `"How long customers take before checking out"` |
| Sub | `"Sessions that reached checkout, by time spent in cart"` |
| Component | `recharts BarChart`, vertical bars |
| Height | `200px` |
| X axis | Time bucket labels |
| Y axis | Session count |
| Bar colour | `#0EA5E9` |
| Bar radius | `[4, 4, 0, 0]` (rounded top) |
| Tooltip | `"X sessions took [bucket label]"` |

**Buckets (always all 6, even if count = 0):**

| Bucket label | Range |
|-------------|-------|
| `Under 1 min` | 0–59s |
| `1-3 min` | 60–179s |
| `3-5 min` | 180–299s |
| `5-10 min` | 300–599s |
| `10-30 min` | 600–1799s |
| `30 min+` | 1800s+ |

No insight line — just the raw distribution. Merchant reads the shape.

---

### 7.3 Products Removed Table

| Property | Value |
|----------|-------|
| Title | `"Products removed before checkout"` |
| Sub | `"What customers add then take out"` |
| Default sort | Times removed descending |
| Minimum threshold | 3 removal events to appear |

| Column | Formula / Notes |
|--------|----------------|
| Product removed | `productTitle` from `cart_item_removed` events — truncated 35 chars, tooltip |
| Times removed | `COUNT cart_item_removed` events for this product in range |
| Remove rate | `(removed / added) * 100` — ≥30% amber · ≥50% red |
| Avg cart value at removal | `AVG(cartValue)` at removal moment — cents/100 → `$XXX` |
| Product that stayed | Most frequent co-occurring `productTitle` in `lineItems` at time of removal. `"—"` if no consistent pattern |

**Avg cart value at removal interpretation (surface in tooltips):**
- High value at removal = sticker shock on the cart total, not the product itself
- Low value at removal = reconsidering the product itself

---

### 7.4 Cart Value Trend

Three metric cards in a row (same `KpiBox` style). No chart — pure numbers.

| Card | Value | Sub-line |
|------|-------|----------|
| Cart value increased | `COUNT(checkout > first-add) / checked-out sessions * 100` | `"avg increase: +$XX per session"` |
| Cart value decreased | `COUNT(checkout < first-add) / checked-out sessions * 100` | `"avg trimmed: -$XX per session"` |
| Cart value unchanged | `100 − grew% − shrank%` | `"one product, straight to checkout"` |

---

### 7.5 Session Patterns

Three stat blocks in a row. **Not cards** — numbers with labels and a bottom border separator.

| Element | Style |
|---------|-------|
| Big number | `28px weight 700 #111827` |
| Label | `13px #6B7280` |
| Small % | `12px #9CA3AF` |

| Block | Count definition | Label | % of |
|-------|-----------------|-------|------|
| One and done | Sessions with exactly 1 `cart_item_added` AND checked out (no edits) | `"Added one product, checked out"` | All checked-out sessions |
| Deliberate buyers | Sessions with 3+ add/remove/change events AND checked out | `"Edited cart 3+ times before checkout"` | All checked-out sessions |
| Lost after adding | `cart_item_added` exists AND no `checkout_click` AND last event >5 min after first add | `"Added to cart, then disappeared"` | All product sessions |

**Below the three blocks (full width, `12px` `#6B7280`):**  
`"View these [X] sessions →"` in `#0EA5E9` — links to Cart Sessions page filtered to `lostAfterAdding` sessions. This drives the merchant from a number to an investigation.

---

## 8. New Components

### 8.1 `ToggleGroup`

**File:** `components/couponmaxx/ToggleGroup.tsx`

```typescript
interface ToggleGroupProps {
  options: string[]
  active: string
  onChange: (option: string) => void
}
```

- Active: background `#0EA5E9`, white text, `border-radius: 6px`
- Inactive: transparent bg, `#6B7280` text, `1px border #E3E3E3`
- Stateless, controlled — parent holds active state

---

### 8.2 `SideBySideComparison`

**File:** `components/couponmaxx/SideBySideComparison.tsx`

```typescript
type ComparisonRow = {
  label: string
  leftValue: string
  rightValue: string
}

interface SideBySideComparisonProps {
  leftLabel: string       // e.g. "Mobile"
  rightLabel: string      // e.g. "Desktop"
  leftIcon: ReactNode
  rightIcon: ReactNode
  rows: ComparisonRow[]
  showAmberBanner?: boolean
  amberMessage?: string
}
```

- Layout: `1fr 1fr` CSS grid
- Each device = card with header (icon + label) + metric rows
- Optional amber banner below both cards when `showAmberBanner={true}`
- The amber banner logic (`mobileCTR < desktopCTR - 15`) lives in the parent — component just renders what it receives

---

### 8.3 Reuse Existing Components

Do not re-implement these:

| Component | Used for |
|-----------|---------|
| `DateRangePicker` | Date range state — default Last 7 days |
| `KpiBox` | All 6 KPI boxes across both tabs |
| `Header` | Page title + subtitle |
| `FilterPill` | Available for future filters — not used in this spec |

---

## 9. Empty States

| Condition | Text |
|-----------|------|
| Conversion — no product data | `"No cart sessions with products in this period."` |
| Conversion — no source data | `"No UTM source data yet. Source tracking starts once customers arrive via a tracked link."` |
| Conversion — no device data | `"No device data in this period."` |
| Activity — no checkout sessions | `"No sessions reached checkout in this period. Time and cart edit metrics require at least one checkout session."` |
| Activity — no removals | `"No products were removed from carts in this period."` + Sub: `"Customers kept everything they added."` |

The "no removals" state is a **positive signal** — call it out as such.

---

## 10. Data Rules & Gotchas

### 10.1 Dollar formatting
All `cartValue` fields stored as **cents (integer)**. Divide by 100 before displaying. Format: `$XXX`. Never display raw cent values.

### 10.2 Median vs average
Any "time" metric uses **median** (`PERCENTILE_CONT`), never average. Outliers (tabs left open overnight) destroy the average. Median is honest.

### 10.3 Minimum thresholds
- Products toggle: 3 session minimum
- Countries table: 3 session minimum
- Removals table: 3 removal events minimum

Prevents single-session noise from dominating.

### 10.4 Tablet sessions
- <10 sessions in range → fold into Desktop column, note `"(includes X tablet sessions)"`
- ≥10 sessions → add third column to `SideBySideComparison`

### 10.5 All Postgres, no JS aggregation
> ✕ **Never** fetch raw `CartEvent` rows into the route handler and compute metrics in JavaScript. For large shops this will time out. Every aggregate, join, and median belongs in a Postgres function called via `supabase.rpc()`.

### 10.6 Toggle — no additional API calls
The conversion route pre-fetches products, sources, AND devices in one request. Use `useState` to track active toggle and conditionally render from the already-fetched payload.

### 10.7 Time buckets — always 6
`cart_time_distribution` must always return all 6 buckets. Bucket with 0 sessions → return it with `sessions: 0`. The chart must render all 6 bars.

---

## 11. TypeScript Type Definitions

```typescript
type ProductConversionRow = {
  productTitle: string
  addedToCart: number
  checkedOutWith: number
  cartToCheckoutRate: number
  removedFromCart: number
  removeRate: number
  avgCartValueWhenAdded: number    // dollars
}

type SourceConversionRow = {
  source: string                   // display name
  utmSource: string | null
  utmMedium: string | null
  cartSessions: number
  checkedOut: number
  cartToCheckoutRate: number
  avgCartValue: number             // dollars
  couponUsedPct: number
}

type DeviceMetrics = {
  cartSessions: number
  cartToCheckoutRate: number
  medianTimeToCheckoutMs: number
  avgCartValueAtCheckout: number   // dollars
  avgItemsInCart: number
  couponAttemptRate: number
}

type CountryRow = {
  country: string
  cartSessions: number
  cartToCheckoutRate: number
  avgCartValue: number             // dollars
}

type RemovalRow = {
  productTitle: string
  timesRemoved: number
  removeRate: number               // 0–100
  avgCartValueAtRemoval: number    // dollars
  productThatStayed: string | null
}
```

---

## 12. Shopify Embedded App Patterns

### 12.1 Embedded rendering
This page renders inside Shopify Admin via App Bridge. The `/couponmaxx/*` route group is already handled by the embedded layout. The Cart page inherits the same session token and authentication — no extra Shopify config needed.

### 12.2 Nav in Shopify sidebar
Adding the Cart link to `layout.tsx` causes it to appear in the Shopify Admin left sidebar. Verify in an embedded dev session — `"Cart"` should appear between `"Coupons"` and `"Notifications"`.

### 12.3 API route authentication
The two new routes must follow the **same auth pattern** as all other `/api/couponmaxx/*` routes. Read the existing routes before implementing — do not invent a new auth approach.

### 12.4 Rate limits
These routes query Supabase directly (not the Shopify Admin API), so Shopify GraphQL rate limits do not apply. The Postgres functions avoid N+1 queries by design.

---

## 13. Changelog Entry

Append to the project changelog before ending the session:

```markdown
## [DATE]: Cart Conversion and Cart Activity pages

**Route:** /couponmaxx/cart (two internal tabs)
**APIs:**  /api/couponmaxx/cart/conversion
           /api/couponmaxx/cart/activity

**Conversion tab:**
- 3 KPI boxes: cart-to-checkout rate, cart sessions, abandoned carts
- Three-way toggle table: Products | Sources | Devices
  - Products: add count, checkout rate, remove rate, avg cart at add
  - Sources:  UTM-based grouping, cart sessions, checkout rate, coupon %
  - Devices:  mobile vs desktop side-by-side, median time to checkout
- Top 5 countries table below device comparison

**Activity tab:**
- 3 KPI boxes: median time to checkout, avg cart edits, avg value change
- Time distribution bar chart (6 buckets, Under 1 min to 30 min+)
- Products removed table with "product that stayed" column
- Cart value trend (grew/shrank/unchanged with avg $ amounts)
- Session patterns (one-and-done, deliberate buyers, lost after adding)
- "View these X sessions →" link drives to Cart Sessions page

**DB:** supabase/cart-analytics-functions.sql — 9 Postgres functions
All analytics via supabase.rpc() — no raw row fetching, no Prisma.

**Nav:** Cart added between Coupons and Notifications in layout.tsx

**Files created:**
- app/(embedded)/couponmaxx/cart/page.tsx
- app/api/couponmaxx/cart/conversion/route.ts
- app/api/couponmaxx/cart/activity/route.ts
- components/couponmaxx/ToggleGroup.tsx
- components/couponmaxx/SideBySideComparison.tsx
- supabase/cart-analytics-functions.sql

**File updated:**
- app/(embedded)/couponmaxx/layout.tsx (one Cart nav item added)
```

---

## 14. Pre-Deploy Checklist

| # | Check | How to verify |
|---|-------|---------------|
| 1 | No existing files modified (except `layout.tsx`) | `git diff --name-only` — only new files + `layout.tsx` |
| 2 | `layout.tsx` has exactly one new line | `git diff app/(embedded)/couponmaxx/layout.tsx` |
| 3 | `cart-analytics-functions.sql` run in Supabase | `SELECT proname FROM pg_proc WHERE proname LIKE '%cart%'` |
| 4 | All 9 Postgres functions exist | Query above returns 9 rows |
| 5 | Conversion API returns all three toggle datasets | `curl GET /api/couponmaxx/cart/conversion?shop=X&start=Y&end=Z` |
| 6 | Activity API returns all fields without null panics | `curl GET /api/couponmaxx/cart/activity?shop=X&start=Y&end=Z` |
| 7 | `timeDistribution` always returns 6 buckets | Test with a range where one bucket would be 0 |
| 8 | KPI deltas use correct preceding period | Delta = same duration, immediately preceding range |
| 9 | Dollar values are cents/100 (not raw cents) | Check `$XXX` format in API response |
| 10 | Default tab is Conversion | Page load lands on Conversion, not Activity |
| 11 | Toggle switches without additional API call | Network tab — no new request when toggling |
| 12 | `npx tsc --noEmit` | Zero errors |
| 13 | `npm run build` | Zero errors |
| 14 | Cart nav item visible in Shopify sidebar | Test embedded on drwater |
| 15 | Amber banner triggers at 15pp gap | Set mobile CTR to `desktopCTR - 16` in test data |
| 16 | Empty states render correctly | Test with date range that has no data |
| 17 | Commit message matches spec | `feat: Cart Conversion and Cart Activity pages` |

---

*CouponMaxx Cart Pages — Page 5 of the spec set — v1.0 — March 2026*
