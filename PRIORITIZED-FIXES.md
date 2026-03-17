# CouponMaxx — Prioritized Fix Plan

Ordered by: **Data Accuracy** → **UI/Polaris** → **Everything Else**

Every data accuracy fix must be a proper structural fix. No hardcoded patches, no magic numbers, no "good enough" workarounds. If the formula is wrong, fix the formula at the source (SQL function), not in the JS that consumes it.

---

# TIER 1 — DATA ACCURACY

These directly cause wrong numbers shown to merchants. A merchant making decisions based on wrong data is worse than no data at all.

---

### DA-1. Funnel mixes event counts and session counts

**Impact**: The entire funnel chart shows nonsensical numbers. `couponsFailed + couponsApplied` can exceed `couponsAttempted` because failed/applied are event-level `COUNT(*)` but attempted is session-level `COUNT(DISTINCT sessionId)`. Any merchant looking at the funnel will see steps that don't add up.

**Files**: 
- `supabase/analytics-functions.sql` → `couponmaxx_daily_cart_metrics`
- `app/api/couponmaxx/analytics/route.ts` lines 133-141

**Approach**: 
1. The unit for everything in the funnel must be **sessions**, not events. A session either had a coupon succeed or it didn't — retries within a session shouldn't inflate the count.
2. Modify `couponmaxx_daily_cart_metrics` SQL function to return session-based coupon columns:
```sql
COUNT(DISTINCT CASE WHEN "eventType" IN ('cart_coupon_applied','cart_coupon_failed','cart_coupon_recovered')
                    THEN "sessionId" END) AS sessions_coupon_attempted,
COUNT(DISTINCT CASE WHEN "eventType" = 'cart_coupon_applied' OR "couponRecovered" = true
                    THEN "sessionId" END) AS sessions_coupon_applied,
COUNT(DISTINCT CASE WHEN "eventType" = 'cart_coupon_failed' AND NOT COALESCE("couponRecovered", false)
                    THEN "sessionId" END) AS sessions_coupon_failed_only
```
3. Update the JS funnel builder to use these new columns directly. No arithmetic — each funnel step is its own SQL column.
4. Verify: for any date range, `sessions_coupon_applied + sessions_coupon_failed_only <= sessions_coupon_attempted`. If this invariant breaks, there's a bug in the SQL.

---

### DA-2. Funnel totals and funnel daily disagree on how to count failures

**Impact**: The summary numbers at the top of the funnel don't match the sum of the daily bars. Merchant sees "200 failed" in the total but daily bars sum to "260 failed."

**Files**: 
- `supabase/analytics-functions.sql` → `couponmaxx_funnel_totals` vs `couponmaxx_daily_cart_metrics`
- `app/api/couponmaxx/analytics/route.ts`

**Approach**:
1. After DA-1 is done, both functions will use session-based columns with the same logic. Verify they return consistent numbers.
2. The daily function's `sessions_coupon_failed_only` must use the same `AND NOT COALESCE("couponRecovered", false)` exclusion as `couponmaxx_funnel_totals`. 
3. Add a sanity check in the API route: sum daily values and compare to totals. Log a warning if they diverge by more than a rounding margin. Don't ship the divergent data — prefer the totals function as the source of truth and note the discrepancy.

---

### DA-3. Recovered coupons double-counted as applied

**Impact**: Success rate is inflated. A recovered coupon may generate both a `cart_coupon_applied` event AND have `couponRecovered=true`, counting it twice in the applied column.

**File**: `supabase/analytics-functions.sql` → `couponmaxx_daily_cart_metrics` line 36-38

**Approach**:
1. This is fully resolved by DA-1's session-based approach — a session can only be counted once regardless of how many events fired.
2. As a belt-and-suspenders check, the applied column should be:
```sql
COUNT(DISTINCT CASE WHEN "eventType" = 'cart_coupon_applied' OR "couponRecovered" = true
                    THEN "sessionId" END)
```
The `DISTINCT sessionId` prevents any double-counting even if a session has both event types.

---

### DA-4. Attributed sales includes sessions where the coupon FAILED

**Impact**: Revenue attribution is overstated. Sessions where someone tried a code that didn't work, then bought anyway at full price, are counted as "coupon-attributed sales." This tells the merchant their coupons drove revenue they didn't actually drive.

**File**: `supabase/analytics-functions.sql` → `couponmaxx_attributed_sales_daily` lines 97-104

**Approach**:
1. Change the `coupon_sessions` CTE to only include sessions with successful coupon applications:
```sql
coupon_sessions AS (
  SELECT DISTINCT "sessionId"
  FROM "CartEvent"
  WHERE "shopId" = p_shop_id
    AND "occurredAt" >= p_start
    AND "occurredAt" <= p_end
    AND ("eventType" = 'cart_coupon_applied' OR "couponRecovered" = true)
    AND (p_session_ids IS NULL OR "sessionId" = ANY(p_session_ids))
)
```
2. Do NOT add a separate "attempted but failed" attributed number — that's a different metric (could be useful later but shouldn't pollute the core attribution number).

---

### DA-5. Coupon success rate metric card uses events, funnel uses sessions

**Impact**: The "Coupon success rate" big number on the analytics page tells a different story than the funnel below it. Merchant sees "72% success rate" in the card but the funnel shows 80 attempted / 70 applied (87.5%). This erodes trust.

**Files**: 
- `app/api/couponmaxx/analytics/route.ts` lines 119-125, 149

**Approach**:
1. After DA-1, the daily data has session-based columns. Replace the metric card's average calculation:
```ts
// Before (event-level):
let totalApplied = 0, totalAttempted = 0;
for (...) { totalApplied += b.applied; totalAttempted += b.attempted; }

// After (session-level):
let totalAppliedSessions = 0, totalAttemptedSessions = 0;
for (...) { totalAppliedSessions += b.sessionsApplied; totalAttemptedSessions += b.sessionsAttempted; }
```
2. The daily sparkline in the card should also use session-based rates.
3. This ensures the big number, the sparkline, and the funnel all say the same thing.

---

### DA-6. Checkout events capped at 500 sessions — silently corrupts all downstream data

**Impact**: For any date range with >500 unique sessions, sessions 501+ have no checkout data. They all appear "abandoned" even if they completed orders. This corrupts: AOV with/without coupon, handoff rate, abandoned-after-failure count, abandoned cart value, outcome distribution.

**Files**: 
- `app/api/couponmaxx/coupons/route.ts` line 38
- `app/api/couponmaxx/coupons/[code]/route.ts` line 43

**Approach**:
1. The real fix is DA-7 (move to SQL). But if the JS approach stays temporarily:
2. Batch the `.in('sessionId', ...)` queries in groups of 500:
```ts
async function fetchCheckoutEvents(shopId: string, sessionIds: string[]) {
  const batchSize = 500;
  const results = [];
  for (let i = 0; i < sessionIds.length; i += batchSize) {
    const batch = sessionIds.slice(i, i + batchSize);
    const { data } = await supabase.from('CheckoutEvent')
      .select('sessionId, eventType, totalPrice, occurredAt')
      .eq('shopId', shopId)
      .in('sessionId', batch)
      .limit(5000);
    results.push(...(data ?? []));
  }
  return results;
}
```
3. Also increase the 20K CartEvent limit or add pagination — document what happens when the limit is hit.

---

### DA-7. Coupons page fetches 20K raw events and rebuilds sessions in JS

**Impact**: Slow, truncates data for active stores, uses a different code path than the Sessions page (which uses efficient SQL summaries). Same store, same date range, two different session counts.

**Files**: 
- `app/api/couponmaxx/coupons/route.ts` lines 24-43
- `app/api/couponmaxx/coupons/[code]/route.ts` lines 25-48

**Approach**:
1. Create a new SQL function `couponmaxx_coupon_code_stats` that computes per-code metrics directly in Postgres:
```sql
CREATE OR REPLACE FUNCTION couponmaxx_coupon_code_stats(
  p_shop_id text, p_start timestamptz, p_end timestamptz
) RETURNS TABLE (
  code text,
  sessions_attempted bigint,
  sessions_applied bigint,
  sessions_failed bigint,
  sessions_recovered bigint,
  avg_cart_success numeric,
  avg_cart_fail numeric,
  total_discount numeric,
  last_seen timestamptz,
  first_seen timestamptz
) ...
```
2. The daily velocity data can be a separate RPC: `couponmaxx_code_velocity_daily(p_shop_id, p_start, p_end)` returning `(day, code, attempts)`.
3. For the code detail panel, keep raw event fetches but ONLY for the specific code (which is already filtered via `ilike('couponCode', code)`) — don't fetch all 20K cart events for the store.
4. For session-level data in the detail panel (recovery, cannibalization), use `couponmaxx_session_summaries` with an additional filter.
5. Remove `buildSessionsFromEvents` from the coupons API entirely.

---

### DA-8. AOV units unclear — potential 100x error

**Impact**: If `totalPrice` from CheckoutEvent is in cents but treated as dollars, AOV shows $5,500 instead of $55. If the opposite, AOV shows $0.55 instead of $55.

**File**: `app/api/couponmaxx/coupons/route.ts` lines 131-136

**Approach**:
1. Check the Shopify Web Pixel `checkout_completed` event spec. The `totalPrice` field in Shopify's checkout events is in the shop's currency unit (dollars/euros/etc), NOT cents.
2. Check the ingest pipeline (`app/api/pixel/ingest/`) to see if it transforms the value before storing.
3. CartEvent stores `cartValue` in cents (schema comment confirms this). If CheckoutEvent's `totalPrice` is stored in dollars, the current code is correct. Document this in the schema:
```prisma
totalPrice   Float?  // in shop currency (dollars), NOT cents
```
4. Add a runtime sanity check: if AOV exceeds $10,000, log a warning — it's likely a unit mismatch.

---

### DA-9. Previous period boundary has off-by-one overlap

**Impact**: Events on the boundary date could be counted in both current and previous period, inflating comparison numbers.

**Files**:
- `app/api/couponmaxx/analytics/route.ts` line 37
- `app/api/couponmaxx/coupons/route.ts` line 22

**Approach**:
1. Change:
```ts
// Before:
const prevEnd = start;

// After:
const prevEnd = new Date(start.getTime() - 1); // 1ms before current start
```
2. Apply to both analytics and coupons routes.
3. Since queries use `>=` for start and `<=` for end, this ensures zero overlap.

---

### DA-10. "Carts with coupon applied" title doesn't match data (shows attempted)

**Impact**: Merchant reads "68% of carts had coupon applied" but the actual metric is "68% attempted a coupon." These are meaningfully different claims.

**File**: `app/(embedded)/couponmaxx/analytics/page.tsx` lines 364-370

**Approach**:
1. Change the title to **"Carts with coupon attempted"** or **"Coupon usage rate"** — this matches the data.
2. Update the definition to: "Percent of product carts where a customer entered a coupon code"
3. Do NOT change the underlying data — "attempted" is the more useful metric for understanding coupon engagement.

---

### DA-11. Product titles in session table always show ×1 with no price

**Impact**: Every product in the sessions table shows "Product Name ×1" regardless of actual quantity. Cart values don't break down by product. Merchant can't see what's actually in the cart.

**Files**: 
- `supabase/analytics-functions.sql` → `couponmaxx_session_summaries` lines 412-416
- `app/api/couponmaxx/sessions/route.ts` → `sessionFromSummary` line 18

**Approach**:
1. The SQL already returns `line_items` as full JSONB. Change `sessionFromSummary` to use it:
```ts
// Parse real line items instead of just titles
const rawLineItems = row.line_items as Array<{ productTitle?: string; price?: number; quantity?: number }> | null;
const products = rawLineItems && rawLineItems.length > 0
  ? rawLineItems.map(item => ({
      productTitle: item.productTitle ?? null,
      price: item.price ?? null,  // already in cents from CartEvent
      quantity: item.quantity ?? 1,
    }))
  : (row.product_titles ?? []).map(t => ({ productTitle: t, price: null, quantity: 1 }));
```
2. Fall back to `product_titles` only when `line_items` is null (older sessions).

---

### DA-12. UTM source bucketing is inconsistent across SQL, JS, and frontend

**Impact**: Filtering by UTM source on different pages gives different results. A "Social" filter on Sessions page includes tiktok_ads traffic, but the same filter on Analytics page doesn't (SQL function misses tiktok_ads). Frontend shows filter options (Organic, Paid Social, Affiliate) that have no backend mapping at all.

**Files**: 
- `lib/v3/session-builder.ts` → `deriveSourceV3`
- `supabase/analytics-functions.sql` → `couponmaxx_utm_sessions`
- Session and Analytics page filter option arrays

**Approach**:
1. Make the SQL function the single source of truth. Update `couponmaxx_utm_sessions` to match `deriveSourceV3` exactly — add `tiktok_ads` to Social, add Organic/Affiliate/Referral buckets.
2. Have the JS `deriveSourceV3` call the same bucketing logic (or just use it for display labeling, not filtering).
3. Remove frontend filter options that don't exist in the backend. Only show options the SQL function can actually match.
4. If adding new buckets, define them:
   - Organic: `utmMedium = 'organic'` or `utmSource = 'google' AND utmMedium = 'organic'`
   - Paid Social: `utmMedium = 'paid' AND utmSource IN ('facebook','instagram','tiktok',...)`
   - Affiliate: `utmMedium = 'affiliate'` or `utmSource` matches known affiliate platforms
   - Referral: has utmSource but doesn't match any known bucket

---

### DA-13. Country/device uses last event in SQL but first event in JS

**Impact**: Minor — Sessions page (SQL path) and Coupons page (JS path) may show different country/device for the same session. Low practical impact since most sessions don't change country mid-session.

**File**: `supabase/analytics-functions.sql` → `couponmaxx_session_summaries` lines 337-346

**Approach**:
1. Change SQL from `ORDER BY "occurredAt" DESC` to `ORDER BY "occurredAt" ASC` for country and device columns. First event is semantically correct (where the user started).

---

### DA-14. Coupon health thresholds are too generous

**Impact**: A code with 49% success rate is labeled "degraded" not "broken." Half your coupon users are hitting errors — that's broken. A code with 5 attempts is given a definitive status when the sample is too small to be meaningful.

**File**: `app/api/couponmaxx/coupons/route.ts` lines 146-151

**Approach**:
1. Update thresholds to be more operationally useful:
```ts
function getStatus(successRate: number, attempts: number): CouponStatus {
  if (attempts < 15) return 'low_data';
  if (successRate >= 80) return 'healthy';
  if (successRate >= 50) return 'degraded';
  return 'broken';
}
```
2. These should eventually be configurable per-store via the notification settings. The infrastructure for this exists already (`settings.brokenCoupon.threshold`). Wire it up.

---

### DA-15. Settings API reads columns that may not exist in DB

**Impact**: If the DB doesn't have `notificationSettings`, `notificationEmail`, `slackChannelName` columns, the settings page shows defaults and saves don't persist. Merchants configure alerts that silently don't stick.

**Files**: 
- `app/api/couponmaxx/settings/route.ts` line 30
- `prisma/schema.prisma` (Shop model)

**Approach**:
1. Check the actual Supabase DB schema. If the columns exist there but not in Prisma, add them to Prisma:
```prisma
model Shop {
  // ... existing fields ...
  notificationSettings Json?
  notificationEmail    String?
  slackChannelName     String?
}
```
2. Run `prisma db pull` to verify actual DB shape, then `prisma generate`.
3. If the columns DON'T exist in the DB, create a migration to add them.

---

### DA-16. Dead code in zombie detection

**Impact**: None (dead code), but confusing for anyone reading the codebase.

**File**: `app/api/couponmaxx/coupons/route.ts` lines 203-209

**Approach**: Delete lines 203-209. The actual zombie logic on line 211 is fine.

---

# TIER 2 — UI / POLARIS COMPLIANCE

All CouponMaxx pages use custom inline-styled components instead of native Shopify Polaris. Fix order is by visibility and complexity.

---

### UI-1. Remove custom Header component

**Impact**: Non-standard chrome at the top of every CouponMaxx page. Looks alien inside Shopify admin.

**Files**: `components/couponmaxx/Header.tsx`, `app/(embedded)/couponmaxx/layout.tsx`

**Approach**:
1. Delete `Header.tsx`
2. Remove `<Header />` from `couponmaxx/layout.tsx`
3. If "Live" indicator is needed, use a `<Badge tone="success">Live</Badge>` inside each page's `<Page>` component title area

---

### UI-2. DateRangePicker overflows in embedded iframe

**Impact**: User-reported bug. The date picker "opens in a smaller window on top" — the hardcoded 680×460 popover overflows the Shopify admin iframe.

**File**: `components/couponmaxx/DateRangePicker.tsx`

**Approach**:
1. Replace with a simpler pattern: `<Select>` for preset ranges (Today, Yesterday, Last 7/14/30/90 days, Custom)
2. Only show `<Popover>` with `<DatePicker>` when "Custom" is selected
3. Remove the hardcoded dimensions entirely — let Polaris handle sizing
4. The preset list sidebar becomes unnecessary (it's built into the Select)
5. Use Polaris `<Button>` and `<ButtonGroup>` for Cancel/Apply

---

### UI-3. Sessions table → Polaris `<IndexTable>`

**Impact**: Biggest single Polaris violation. Custom table, custom hover, custom pagination, custom icons. ~200 lines of inline-styled HTML that Polaris handles natively.

**File**: `app/(embedded)/couponmaxx/sessions/page.tsx`

**Approach**:
1. Replace `<table>` with `<IndexTable>` — each session becomes an `<IndexTable.Row>`, each column an `<IndexTable.Cell>`
2. Replace pagination buttons with Polaris `<Pagination>`
3. Replace custom SVG icons with `@shopify/polaris-icons`: `DesktopIcon`, `MobileIcon`, `TabletIcon`, `RefreshIcon`, `XSmallIcon`
4. Keep `<OutcomeBadge>` as-is (already uses Polaris `<Badge>`)
5. The "View →" button becomes the row's clickable action

---

### UI-4. Coupons table → Polaris `<IndexTable>`

**Impact**: Same as UI-3. Custom table with custom sort pills, status filter pills, and colored left-border status indicators.

**File**: `app/(embedded)/couponmaxx/coupons/page.tsx`

**Approach**:
1. Replace `<table>` with `<IndexTable>` with sortable column headers (built into IndexTable)
2. Replace status filter pills with `<Tabs>` for All / Healthy / Degraded / Broken / Low data
3. Replace sort buttons with `<IndexTable>` column sorting
4. The colored left-border can become a `<Badge>` in the first column with the appropriate `tone`
5. Replace zombie codes collapsible section with `<Collapsible>` + `<Card>`

---

### UI-5. MetricCard → Polaris `<Card>` with proper components

**Impact**: 4 instances on analytics page, all custom. The title dropdowns are hand-rolled menus.

**File**: `components/couponmaxx/MetricCard.tsx`

**Approach**:
1. Wrap in `<Card>`
2. Use `<Text variant="headingMd">` for title, `<Text variant="bodySm" tone="subdued">` for definition
3. Replace `TitleDropdown` with Polaris `<Select labelInline>` or `<Popover>` + `<ActionList>`
4. Replace the "···" button with `<Popover>` + `<ActionList>` if it should do something, or remove it
5. Use `<SkeletonDisplayText>` for loading state instead of static "—"
6. Keep the Recharts `<LineChartInCard>` as-is (Polaris has no chart component)

---

### UI-6. KpiBox → Polaris `<Card>`

**Impact**: 4 instances on Sessions page, 4 on Coupons page. All custom.

**File**: `components/couponmaxx/KpiBox.tsx`

**Approach**:
1. Replace with `<Card>` 
2. Use `<Text variant="headingLg">` for the big number
3. Use `<Text variant="bodySm" tone="subdued">` for sub-lines
4. For clickable/active state, wrap `<Card>` in a `<div>` with conditional `outline` or `border` style
5. Parent layout should use `<InlineGrid columns={4}>` instead of `display: flex`

---

### UI-7. All page wrappers → Polaris `<Page>` + `<Layout>`

**Impact**: Every page uses raw `<div>` with inline styles for the page title, layout, spacing.

**Files**: All 4 CouponMaxx page files

**Approach**:
1. Each page should be:
```tsx
<Page title="Analytics" subtitle="optional subtitle">
  <Layout>
    <Layout.Section>
      {/* controls row */}
    </Layout.Section>
    <Layout.Section>
      {/* content */}
    </Layout.Section>
  </Layout>
</Page>
```
2. Replace `<h1 style={{...}}>` with the `<Page title="">` prop
3. Replace `display: grid; gridTemplateColumns: '1fr 1fr'` with `<InlineGrid columns={2}>`
4. Replace `display: flex; flexDirection: column; gap: 16` with `<BlockStack gap="400">`

---

### UI-8. All card containers → `<Card>`

**Impact**: Dozens of instances across all pages:
```tsx
<div style={{ background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8, padding: 20 }}>
```

**Approach**: Find-and-replace all these patterns with `<Card>`. Use `<Card.Section>` for internal padding breaks.

---

### UI-9. FunnelChart toggle and column selector → Polaris components

**File**: `components/couponmaxx/FunnelChart.tsx`

**Approach**:
1. Replace Bar/Line toggle with `<ButtonGroup segmented>` + `<Button>`
2. Replace column selector pills with `<Tag>` or `<ChoiceList allowMultiple>` in a `<Popover>`
3. Keep Recharts charts as-is

---

### UI-10. Toggle component → Polaris `<Checkbox>` or `<SettingToggle>`

**File**: `components/couponmaxx/Toggle.tsx`

**Approach**:
1. For notification settings rows, replace with `<SettingToggle>` pattern (already imported in old settings page)
2. For simple on/off, use `<Checkbox>`
3. Delete the custom Toggle component

---

### UI-11. Slide-over panels → Polaris `<Modal>` or consistent z-index

**Files**: 
- `app/(embedded)/couponmaxx/coupons/page.tsx` (CodeDetailPanel, z-index 40/50)
- `app/(embedded)/couponmaxx/sessions/page.tsx` (TimelinePanel, z-index 200/201)

**Approach**:
1. **Option A (recommended)**: Replace both with `<Modal large>`. Use `<Modal.Section>` for internal layout. This gives proper overlay, focus trap, escape-to-close, accessibility.
2. **Option B**: If drawer UX is important, keep it but normalize z-index (both use 200/201), use Polaris `<Button icon={XSmallIcon} variant="plain">` for close, add keyboard escape handler.

---

### UI-12. Coupons page has double padding from page + layout

**File**: `app/(embedded)/couponmaxx/coupons/page.tsx` line 560

**Approach**: Remove the outer wrapper div with `background: '#F1F1F1', minHeight: '100vh', padding: 24`. The layout already provides this.

---

### UI-13. Custom text styling → Polaris `<Text>`

**Impact**: Hundreds of instances of inline font-size, font-weight, color.

**Approach**: Sweep all pages. Replace:
- `fontSize: 20, fontWeight: 600` → `<Text variant="headingLg">`
- `fontSize: 15, fontWeight: 600` → `<Text variant="headingMd">`
- `fontSize: 13, color: '#6B7280'` → `<Text variant="bodySm" tone="subdued">`
- `fontSize: 32, fontWeight: 700` → `<Text variant="heading2xl">`

---

### UI-14. Custom buttons → Polaris `<Button>`

**Impact**: Pagination, filter pills, save buttons, refresh — all custom styled.

**Approach**: Replace all `<button style={{...}}>` with `<Button>` using appropriate variant: `primary`, `plain`, `tertiary`. Use `<Pagination>` for table navigation.

---

### UI-15. Loading states → Polaris skeletons

**Approach**: Replace centered `<Spinner>` with `<SkeletonPage>` / `<SkeletonBodyText>` / `<SkeletonDisplayText>` that mirror the actual page layout.

---

### UI-16. Delete unused FilterPill component

**File**: `components/couponmaxx/FilterPill.tsx`

**Approach**: Delete the file. It's not imported by any CouponMaxx page.

---

# TIER 3 — FEATURE FIXES & EVERYTHING ELSE

---

### F-1. Compare mode only returns 1 of 4 metric comparisons

**Impact**: Feature partially broken. 3 of 4 metric cards show no comparison line.

**File**: `app/api/couponmaxx/analytics/route.ts` lines 152-171

**Approach**:
1. Extend the comparison block to compute all 4 metrics for the previous period.
2. Run the same RPCs (`couponmaxx_daily_cart_metrics`, `couponmaxx_daily_checkout_sessions`, `couponmaxx_attributed_sales_daily`) with `prevStart/prevEnd`.
3. Add these to the existing `Promise.all` to parallelize.
4. Build comparison arrays for: `cartsWithCoupon.comparison`, `attributedSales.comparison`, `cartViews.comparison` (total, withProducts, checkouts).
5. The `LineChartInCard` index-based merge (Issue 13 from original doc) is fine IF the API guarantees same-length arrays. Pad the shorter array with zero-value entries if needed.

---

### F-2. "Previous year" compare option is ignored

**File**: `app/api/couponmaxx/analytics/route.ts` lines 36-38, 154

**Approach**:
1. Read the `compareTo` value:
```ts
const compareMode = p.get('compareTo') ?? '';
let prevStart: Date, prevEnd: Date;
if (compareMode === 'previous_year') {
  prevStart = new Date(start); prevStart.setFullYear(prevStart.getFullYear() - 1);
  prevEnd = new Date(end); prevEnd.setFullYear(prevEnd.getFullYear() - 1);
} else if (compareMode === 'previous_period') {
  prevEnd = new Date(start.getTime() - 1);
  prevStart = new Date(prevEnd.getTime() - rangeMs);
} else {
  // no comparison
}
```

---

### F-3. Welcome page says "CheckoutMaxx" and links to old routes

**File**: `app/(embedded)/welcome/page.tsx`

**Approach**:
1. Change title to "Welcome to CouponMaxx"
2. Update feature cards to: Broken coupon alerts, Coupon analytics, Code performance tracking
3. Update buttons to link to `/couponmaxx/analytics` and `/couponmaxx/notifications`

---

### F-4. Analytics filter options are hardcoded and don't reflect real data

**File**: `app/(embedded)/couponmaxx/analytics/page.tsx` lines 246-265

**Approach**:
1. Have the analytics API return available filter values alongside the data:
```ts
// In the response:
filterOptions: {
  devices: ['Desktop', 'Mobile', 'Tablet'], // distinct from actual data
  utmSources: ['Direct', 'Email', 'Social'], // distinct from actual data
}
```
2. Or: remove filters that don't work yet. A non-functional filter is worse than no filter.
3. Remove the product filter entirely until the API supports it.

---

### F-5. Old dashboard routes should redirect to CouponMaxx

**File**: `app/(embedded)/layout.tsx`

**Approach**:
1. If the product identity is now CouponMaxx, update the NavMenu to only show CouponMaxx routes
2. Add redirects from old routes (`/dashboard/*`, `/alerts`, `/settings`) to CouponMaxx equivalents
3. Or keep both if the old dashboard still serves a purpose — but clarify the relationship

---

### F-6. Inconsistent default date ranges across pages

**Files**: Sessions (24h), Analytics (7d), Coupons (30d)

**Approach**:
1. Standardize to 7 days across all pages
2. Or make the date range shared via React context / URL search params that persist across page navigation

---

### F-7. No API caching

**Files**: All `app/api/couponmaxx/*` routes

**Approach**:
1. Add `Cache-Control: s-maxage=60, stale-while-revalidate=120` to analytics and coupons routes
2. Add `dedupingInterval: 30000` to SWR configs on the frontend
3. The SQL-based approach (DA-7) eliminates the biggest performance issue; caching is secondary

---

### F-8. Dual ORM (Prisma + Supabase client)

**Approach**: Not urgent. Document the convention: Supabase for reads/RPCs, Prisma for auth/billing mutations. Don't mix within a single route.

---

# EXECUTION ORDER

**Phase 1 — Data accuracy (do first, nothing else matters if numbers are wrong)**
1. DA-1 (funnel sessions vs events)
2. DA-2 (funnel totals/daily consistency) 
3. DA-3 (double-counting recovered)
4. DA-4 (attributed sales overcounting)
5. DA-5 (success rate metric consistency)
6. DA-6 (500 session cap)
7. DA-9 (off-by-one overlap)

**Phase 2 — Data infrastructure**
8. DA-7 (SQL-based coupons page — eliminates 20K fetch + multiple issues)
9. DA-11 (product qty/price)
10. DA-12 (UTM consistency)
11. DA-8 (AOV units verification)

**Phase 3 — UI/Polaris (can parallelize with Phase 2)**
12. UI-1 (remove header)
13. UI-2 (date picker)
14. UI-3 (sessions table)
15. UI-4 (coupons table)
16. UI-5 (metric cards)
17. UI-6 (KPI boxes)
18. UI-7 (page wrappers)
19. UI-8 through UI-16 (sweep)

**Phase 4 — Features and cleanup**
20. F-1 + F-2 (compare mode)
21. F-3 (welcome page)
22. DA-10, DA-13, DA-14, DA-15, DA-16 (minor data fixes)
23. F-4 through F-8 (everything else)
