# Hotfix Batch 2 — KPI behavior, visual feedback, row hints, data check

## DO NOT redeploy couponmaxx. Push to main only. Test on Dr.Water.

---

## Fix 1: KPI boxes — keep UNFILTERED totals, only filter the table

**Problem:** When you click "Reached Checkout" (25), ALL KPI boxes change to show filtered counts. "Carts Opened" drops from 974 to 25. This is confusing because the boxes ARE the funnel — they should always show the full funnel numbers so the merchant can see the dropoff.

**The behavior should be:**
- KPI boxes ALWAYS show unfiltered totals: 974 → 63 → 18 → 25
- The ACTIVE box gets a visual highlight (see Fix 2)
- The TABLE below filters to show only sessions matching the clicked box
- The "Showing X sessions" line below the filters reflects the filtered count

**File:** `app/(embedded)/couponmaxx/sessions/page.tsx`

Find where KpiBox values are set. Claude Code added `scopedBoxes` logic that overrides box values when a filter is active. REVERT this — always use the unfiltered `data.boxes` values:

```tsx
// FIND something like:
const activeBoxes = boxFilter !== '' && data?.scopedBoxes ? data.scopedBoxes : data?.boxes;

// REPLACE with:
const activeBoxes = data?.boxes;
```

Or if the KpiBox values are set inline:
```tsx
// Always use data.boxes, never data.scopedBoxes
<KpiBox
  label="Carts Opened"
  value={data?.boxes?.cartsOpened ?? '—'}
  ...
/>
```

The `scopedBoxes` can stay in the API response (it's used for the "Showing X sessions" line), but the KPI boxes themselves should NEVER change when a filter is clicked.

---

## Fix 2: KPI boxes — visual feedback for active filter

**Problem:** When you click a KPI box, there's no visible indicator of which one is active. The outline was added but it's not showing or too subtle.

**File:** `components/couponmaxx/KpiBox.tsx`

The active state needs to be MORE obvious. Add a colored top border and background:

Replace the style object on the outer div:

```tsx
style={{
  cursor: onClick ? 'pointer' : undefined,
  borderRadius: 'var(--p-border-radius-300)',
  borderTop: active ? '3px solid #2C6ECB' : '3px solid transparent',
  background: active ? '#F4F6F8' : undefined,
  height: '100%',
  minHeight: 110,
  transition: 'all 0.15s ease',
}}
```

Key changes:
- `borderTop: 3px solid #2C6ECB` — visible blue top border when active (not outline which can be clipped)
- `background: #F4F6F8` — subtle grey background when active
- Removed `outline` — outlines get clipped by overflow:hidden on parent cards

Also add hover state for non-active boxes to hint they're clickable:

```tsx
onMouseEnter={(e) => { if (!active && onClick) (e.currentTarget as HTMLElement).style.background = '#FAFBFB'; }}
onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = ''; }}
```

---

## Fix 3: KPI boxes — same height

**Problem:** Boxes have different heights due to varying subtitle text lengths.

**File:** Find where KpiBox components are wrapped. If it's `<InlineGrid columns={4}>`, replace with raw CSS grid:

```tsx
// FIND:
<InlineGrid columns={4} gap="400">

// REPLACE:
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'stretch' }}>
```

And change the closing tag:
```tsx
// FIND:
</InlineGrid>

// REPLACE:
</div>
```

The `alignItems: 'stretch'` forces all grid children to the same height. Combined with `height: '100%'` on KpiBox, all boxes will match the tallest one.

Apply this on BOTH the sessions page and the coupons page (anywhere KpiBox is used in a 4-column grid).

---

## Fix 4: Clickable rows — add hover hint

**Problem:** Rows are clickable but there's no visual cue. New users won't know to click.

**File:** `app/(embedded)/couponmaxx/sessions/page.tsx`

Find where table rows render. Add a hover background:

```tsx
// On each row element, add:
style={{
  cursor: 'pointer',
  transition: 'background 0.1s ease',
}}
onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F6F6F7'}
onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = ''}
```

Also add a small "chevron right" icon (›) at the end of each row as a visual hint:

```tsx
// At the end of each row, add a cell:
<td style={{ color: 'var(--p-color-text-subdued)', fontSize: 16, padding: '0 8px' }}>›</td>
```

Or if using IndexTable, add it as the last column content.

---

## Fix 5: Data verification — ordered vs checkout

**Problem:** 25 sessions show "Reached Checkout" but only 1 shows "Ordered." Shopify admin shows 9 orders for Mar 20-21.

**Root cause options:**
1. The checkout pixel doesn't capture `checkout_completed` events — only `checkout_started`
2. The session builder marks outcome as 'ordered' only for a specific eventType that isn't being sent
3. The CheckoutEvent table (from the web pixel) has order data, but the session builder only looks at CartEvent

**File:** `app/api/couponmaxx/sessions/route.ts`

Find the `sessionFromSummary` function. Look at how outcome is determined:

```ts
let outcome: 'ordered' | 'checkout' | 'abandoned' = 'abandoned';
if (row.has_ordered)          outcome = 'ordered';
else if (row.has_checkout_started || row.has_checkout_clicked) outcome = 'checkout';
```

The column `has_ordered` comes from the `couponmaxx_session_summaries` RPC. Check what SQL logic sets this flag — it likely checks for a specific eventType in CartEvent like `checkout_completed` or `order_completed`.

**The checkout pixel** (`extensions/checkout-monitor/src/index.ts`) fires events to `/api/pixel/ingest/`. These go into the `CheckoutEvent` table, NOT `CartEvent`. So if orders are tracked via the pixel → CheckoutEvent, but session summaries only look at CartEvent, orders will never show as "ordered."

**The fix depends on what query 3 returns.** Run this SQL:

```sql
-- What checkout/order events exist in CartEvent?
SELECT DISTINCT "eventType", COUNT(*)
FROM "CartEvent"
WHERE "shopId" = '<SHOP_ID>'
AND "occurredAt" >= '2026-03-20T00:00:00Z'
AND "eventType" LIKE '%check%' OR "eventType" LIKE '%order%' OR "eventType" LIKE '%complet%'
GROUP BY "eventType";

-- What events exist in CheckoutEvent?
SELECT DISTINCT "eventType", COUNT(*)
FROM "CheckoutEvent"
WHERE "shopId" = '<SHOP_ID>'
AND "occurredAt" >= '2026-03-20T00:00:00Z'
GROUP BY "eventType";
```

If `checkout_completed` is in CheckoutEvent but NOT in CartEvent, the fix is:
- The `couponmaxx_session_summaries` RPC needs to JOIN with CheckoutEvent to detect completed orders
- OR the pixel ingest route needs to also write a CartEvent row with eventType='checkout_completed' when it receives that event

Send me the query results and I'll write the exact RPC fix.

---

## VERIFY

```bash
npx next build 2>&1 | tail -5

# KPI boxes always show unfiltered values:
grep -c "scopedBoxes" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Should be 0 or only used for "Showing X sessions" line, NOT for KpiBox values

# Active state uses borderTop:
grep "borderTop" components/couponmaxx/KpiBox.tsx
# Should exist

# CSS grid instead of InlineGrid for KPI boxes:
grep "gridTemplateColumns.*repeat(4" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Should exist

# Row hover:
grep "onMouseEnter" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Should exist (on table rows)
```

## COMMIT

```bash
git add -A
git commit -m "fix: KPI boxes always unfiltered, active state visible, equal height, row hover hints"
git push
```
