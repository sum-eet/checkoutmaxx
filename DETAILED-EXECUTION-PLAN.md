# CouponMaxx — Detailed Execution Plan
# Every file, every line, every RPC, every verification step

---

## ⛔ CRITICAL SAFETY RULES — READ BEFORE DOING ANYTHING ⛔

### DEPLOYMENT ARCHITECTURE
There are TWO Vercel projects pointing to the SAME GitHub repo (main branch):

| Project | URL | Auto-deploy? | Purpose |
|---------|-----|-------------|---------|
| checkoutmaxx-rt55 | checkoutmaxx-rt55.vercel.app | YES — deploys on every push to main | Dr.Water production store (LIVE, real customers) |
| couponmaxx | couponmaxx.vercel.app | NO — manual redeploy only | Public Shopify app (UNDER REVIEW by Shopify) |

### RULES — VIOLATING ANY OF THESE WILL BREAK THE APP SUBMISSION

1. **NEVER run `npx shopify app deploy`** unless explicitly told to AND you have verified the `client_id` in `shopify.app.toml` matches the intended app. Running this with the wrong client_id will push couponmaxx extension URLs to Dr.Water or vice versa.

2. **NEVER manually redeploy couponmaxx on Vercel.** The couponmaxx deployment is FROZEN for Shopify review. Any change to that deployment could break the reviewer's experience and get the app rejected.

3. **NEVER modify `shopify.app.toml`** and commit it. This file contains the couponmaxx client_id. If it changes, checkoutmaxx-rt55 auto-deploys with the wrong app credentials and Dr.Water breaks.

4. **NEVER modify files inside `extensions/`** (cart-monitor, checkout-monitor) unless explicitly told to. Extension code is deployed separately via `npx shopify app deploy` and changes to these files have no effect until that command is run. But if you change the hardcoded URLs in these files and someone later runs the deploy command, it could break data flow.

5. **NEVER delete or modify these files** — they are critical infrastructure:
   - `app/api/auth/callback/route.ts` — OAuth flow
   - `app/api/auth/begin/route.ts` — OAuth flow
   - `app/api/webhooks/` — all webhook routes (GDPR compliance)
   - `app/api/cart/ingest/route.ts` — cart event ingestion (LIVE data flowing)
   - `app/api/pixel/ingest/route.ts` — checkout event ingestion (LIVE data flowing)
   - `app/layout.tsx` — contains App Bridge script tag with NEXT_PUBLIC_SHOPIFY_API_KEY
   - `lib/prisma.ts` — database connection
   - `lib/supabase.ts` — database connection
   - `lib/verify-session-token.ts` — session token auth
   - `vercel.json` — cron job definitions

6. **NEVER change any environment variable references** in `app/layout.tsx`. The `NEXT_PUBLIC_SHOPIFY_API_KEY` reference in the App Bridge script tag was the root cause of a day-long debugging session. Do not touch it.

7. **After EVERY batch of changes**, run:
   ```bash
   npx next build 2>&1 | tail -10
   ```
   If the build fails, DO NOT push. Fix the build error first. A broken push will auto-deploy to Dr.Water and break the live store.

8. **After pushing**, wait 2 minutes for checkoutmaxx-rt55 to auto-deploy, then verify on Dr.Water:
   - Open https://admin.shopify.com/store/jg2svv-pc/apps/checkoutmaxx
   - Confirm the app loads
   - Confirm nav shows (Cart Sessions, Coupons, Notifications)
   - Confirm data appears in the dashboard
   If ANY of these fail, immediately revert: `git revert HEAD && git push`

### SAFE WORKFLOW
```
1. Make changes to code
2. npx next build          → MUST succeed
3. git add -A
4. git commit -m "..."
5. git push                → auto-deploys to checkoutmaxx-rt55 (Dr.Water)
6. Wait 2 min
7. Test on Dr.Water admin  → MUST load, show nav, show data
8. If broken → git revert HEAD && git push
9. Do NOT touch couponmaxx Vercel deployment
```

### FILES YOU CAN SAFELY MODIFY
```
app/(embedded)/couponmaxx/analytics/page.tsx    — analytics page UI
app/(embedded)/couponmaxx/sessions/page.tsx     — sessions page UI
app/(embedded)/couponmaxx/coupons/page.tsx      — coupons page UI
app/(embedded)/couponmaxx/notifications/page.tsx — notifications page UI
app/(embedded)/couponmaxx/layout.tsx            — couponmaxx layout (nav is here)
app/api/couponmaxx/analytics/route.ts           — analytics API
app/api/couponmaxx/sessions/route.ts            — sessions API
app/api/couponmaxx/coupons/route.ts             — coupons API
app/api/couponmaxx/coupons/[code]/route.ts      — single coupon API
app/api/couponmaxx/notifications/route.ts       — notifications API
app/api/couponmaxx/settings/route.ts            — settings API
app/api/couponmaxx/session/route.ts             — single session detail API
app/api/jobs/evaluate-alerts/route.ts           — alert cron job
components/couponmaxx/*                         — all CouponMaxx components
lib/alert-engine.ts                             — alert logic
```

### FILES YOU CAN SAFELY DELETE (Batch 0 — dead code cleanup)
```
app/(embedded)/dashboard/          — entire directory (old v1/v2/v3 dashboards)
app/(embedded)/alerts/             — old alerts page
app/(embedded)/settings/           — old settings page
app/api/v2/                        — entire directory
app/api/v3/                        — entire directory
app/api/cart/all/                  — old cart API
app/api/cart/coupons/              — old cart coupons API
app/api/cart/kpis/                 — old cart KPIs API
app/api/cart/session/              — old single session API (NOT the couponmaxx one)
app/api/cart/sessions/             — old cart sessions API (NOT the couponmaxx one)
app/api/alerts/                    — old alerts API
app/api/metrics/                   — old metrics API
app/api/settings/                  — old settings API (NOT the couponmaxx settings)
app/api/debug/                     — debug endpoints
lib/v2/                            — old v2 lib
lib/v3/                            — old v3 lib (BUT check: sessions/route.ts imports deriveSourceV3 from lib/v3/session-builder — KEEP that file)
lib/cart-metrics.ts                — old cart metrics
lib/metrics.ts                     — old metrics
```

### ⚠️ SPECIAL CASE: lib/v3/session-builder.ts — DO NOT DELETE
The following LIVE files import from `lib/v3/session-builder.ts`:
```
app/(embedded)/couponmaxx/sessions/page.tsx     → deriveSourceV3, CartSessionV3, CouponV3, LineItemV3
app/api/couponmaxx/sessions/route.ts            → deriveSourceV3
app/api/couponmaxx/coupons/route.ts             → buildSessionsFromEvents
app/api/couponmaxx/coupons/[code]/route.ts      → buildSessionsFromEvents
```

**If you delete lib/v3/ without handling this, 3 API routes and the sessions page will break. Dr.Water goes down.**

**Steps to safely handle this:**
1. Create a new file `lib/session-utils.ts`
2. Copy ALL exported functions and types from `lib/v3/session-builder.ts` into `lib/session-utils.ts`
3. Update these 4 imports:
   - `app/(embedded)/couponmaxx/sessions/page.tsx` → change `'@/lib/v3/session-builder'` to `'@/lib/session-utils'`
   - `app/api/couponmaxx/sessions/route.ts` → same change
   - `app/api/couponmaxx/coupons/route.ts` → same change
   - `app/api/couponmaxx/coupons/[code]/route.ts` → same change
4. Run `npx next build` — MUST succeed
5. ONLY THEN delete `lib/v3/`

### ⚠️ SPECIAL CASE: lib/metrics.ts — DO NOT DELETE YET
The weekly digest job imports from it:
```
app/api/jobs/weekly-digest/route.ts → import { getFunnelMetrics } from "@/lib/metrics"
```

**Options:**
- Option A: Keep `lib/metrics.ts` for now. Only delete it when you rewrite the weekly digest.
- Option B: Move `getFunnelMetrics` into `lib/alert-engine.ts` or a new `lib/digest-utils.ts`, update the import, THEN delete.

**For Batch 0 (dead code cleanup): keep lib/metrics.ts. Do NOT delete it.**

### ⚠️ SPECIAL CASE: lib/cart-metrics.ts — SAFE TO DELETE
Only imported by old cart/ API routes that are being deleted in the same batch:
```
app/api/cart/coupons/route.ts   (being deleted)
app/api/cart/session/route.ts   (being deleted)
app/api/cart/kpis/route.ts      (being deleted)
app/api/cart/all/route.ts       (being deleted)
app/api/cart/sessions/route.ts  (being deleted)
```
If you delete these routes AND lib/cart-metrics.ts in the same commit, no broken imports.

### REVISED SAFE DELETE LIST FOR BATCH 0

**Step 1: Move lib/v3/session-builder.ts to lib/session-utils.ts**
```bash
cp lib/v3/session-builder.ts lib/session-utils.ts
```

**Step 2: Update 4 imports in live code**
```
app/(embedded)/couponmaxx/sessions/page.tsx:
  FIND:    from '@/lib/v3/session-builder'
  REPLACE: from '@/lib/session-utils'

app/api/couponmaxx/sessions/route.ts:
  FIND:    from '@/lib/v3/session-builder'
  REPLACE: from '@/lib/session-utils'

app/api/couponmaxx/coupons/route.ts:
  FIND:    from '@/lib/v3/session-builder'
  REPLACE: from '@/lib/session-utils'

app/api/couponmaxx/coupons/[code]/route.ts:
  FIND:    from '@/lib/v3/session-builder'
  REPLACE: from '@/lib/session-utils'
```

**Step 3: Verify build**
```bash
npx next build 2>&1 | tail -10
# MUST succeed before proceeding
```

**Step 4: Delete dead code**
```bash
rm -rf app/\(embedded\)/dashboard/
rm -rf app/\(embedded\)/alerts/
rm -rf app/\(embedded\)/settings/
rm -rf app/api/v2/
rm -rf app/api/v3/
rm -rf app/api/cart/all/
rm -rf app/api/cart/coupons/
rm -rf app/api/cart/kpis/
rm -rf app/api/cart/session/
rm -rf app/api/cart/sessions/
rm -rf app/api/alerts/
rm -rf app/api/metrics/
rm -rf app/api/settings/
rm -rf app/api/debug/
rm -rf lib/v2/
rm -rf lib/v3/
rm -f lib/cart-metrics.ts
# DO NOT delete lib/metrics.ts (used by weekly-digest)
```

**Step 5: Verify build again**
```bash
npx next build 2>&1 | tail -10
# MUST succeed
# Also check for warnings about unused imports:
npx next build 2>&1 | grep -i "Module not found\|Cannot find\|not found"
# MUST return nothing
```

**Step 6: Commit and push**
```bash
git add -A
git commit -m "chore: remove dead v1/v2/v3 code, move session-builder to lib/session-utils"
git push
```

**Step 7: Wait 2 min, then verify Dr.Water**
- Open https://admin.shopify.com/store/jg2svv-pc/apps/checkoutmaxx
- Confirm app loads with nav
- Go to Cart Sessions — confirm sessions load
- Go to Coupons — confirm code table loads
- If ANYTHING breaks: `git revert HEAD && git push`

---

## ARCHITECTURE MAP

### Pages → API Routes → Supabase RPCs

```
Analytics page
  └→ GET /api/couponmaxx/analytics
       ├→ couponmaxx_daily_cart_metrics      (daily session counts)
       ├→ couponmaxx_daily_checkout_sessions (daily checkout counts)
       ├→ couponmaxx_attributed_sales_daily  (daily $ from coupon sessions)
       └→ couponmaxx_funnel_totals           (aggregate funnel numbers)

Sessions page
  └→ GET /api/couponmaxx/sessions
       ├→ couponmaxx_session_kpis       (4 KPI box totals — unfiltered)
       └→ couponmaxx_session_summaries  (all sessions with detail)
       + Client-side JS filtering (boxFilter, country, device, etc.)

Coupons page
  └→ GET /api/couponmaxx/coupons
       ├→ supabase.from('CartEvent') — grouped by couponCode
       ├→ supabase.from('CartEvent') — velocity data
       └→ supabase.from('CheckoutEvent') — recovery data

Notifications page
  └→ GET /api/couponmaxx/notifications (alert history)
  └→ GET/POST /api/couponmaxx/settings (channel settings)
  + Alert engine: /api/jobs/evaluate-alerts (cron)
```

### Supabase RPCs (7 total, all in Supabase dashboard under SQL functions):

| RPC name | Used by | Returns |
|----------|---------|---------|
| couponmaxx_daily_cart_metrics | analytics API | Per-day: total_sessions, sessions_with_products, sessions_with_coupon, sessions_coupon_applied, sessions_coupon_attempted, sessions_coupon_failed, checkout_clicked_sessions |
| couponmaxx_daily_checkout_sessions | analytics API | Per-day: checkout_sessions |
| couponmaxx_attributed_sales_daily | analytics API | Per-day: attributed_value (cart $ where coupon applied + checkout) |
| couponmaxx_funnel_totals | analytics API | Single row: total_sessions, sessions_with_products, sessions_with_coupon, coupon_applied, coupon_failed, reached_checkout |
| couponmaxx_session_kpis | sessions API | Single row: carts_opened, with_products, with_coupon, reached_checkout, checkout_with_coupon, checkout_without_coupon |
| couponmaxx_session_summaries | sessions API | Per-session: session_id, first_event, duration_ms, country, device, utm_*, cart_value_*, product_titles, line_items, coupon_events, has_checkout_clicked, has_ordered |
| couponmaxx_utm_sessions | analytics API | session IDs matching UTM filter |

---

## DATA VERIFICATION

### Issue 1: Analytics "Cart views: 6,630" vs Sessions "Carts Opened: 974"

**Verdict: NOT a bug. Different date ranges.**
- Analytics page: Mar 14–21 (7 days) → 6,630 sessions → ~947/day
- Sessions page: Mar 20–21 (2 days) → 974 sessions → ~487/day
- Dr.Water traffic varies by day, so per-day rates differ. This is normal.

**But verify the RPC is counting SESSIONS not EVENTS:**
```sql
-- Run in Supabase SQL editor:

-- This should match the "total_sessions" from couponmaxx_daily_cart_metrics for Mar 20:
SELECT COUNT(DISTINCT "sessionId") as session_count
FROM "CartEvent"
WHERE "shopId" = '<DR_WATER_SHOP_ID>'
AND "occurredAt" >= '2026-03-20T00:00:00Z'
AND "occurredAt" < '2026-03-21T00:00:00Z';

-- This is the event count (should be HIGHER than session count):
SELECT COUNT(*) as event_count
FROM "CartEvent"
WHERE "shopId" = '<DR_WATER_SHOP_ID>'
AND "occurredAt" >= '2026-03-20T00:00:00Z'
AND "occurredAt" < '2026-03-21T00:00:00Z';

-- Compare: session_count should roughly match "Carts Opened" for that day
```

To find the shop ID:
```sql
SELECT id, "shopDomain" FROM "Shop" WHERE "shopDomain" = 'jg2svv-pc.myshopify.com';
```

### Issue 2: KPI boxes don't update when boxFilter is applied

**Root cause (CONFIRMED in code):**

In `app/api/couponmaxx/sessions/route.ts` line 137-143:
- `couponmaxx_session_kpis` RPC is called WITHOUT boxFilter params
- It returns total counts for the entire date range
- boxFilter is only applied AFTER the RPC, on the session list (line 171-173)
- Result: KPI boxes ALWAYS show unfiltered totals while table shows filtered rows

**The fix has two options:**

**Option A (recommended — client-side KPI recalculation):**
In `app/(embedded)/couponmaxx/sessions/page.tsx`, AFTER the API response comes back and sessions are displayed:
- If boxFilter is active, override the KPI box values with counts from the displayed sessions
- If boxFilter is empty (showing all), use the API's box values

```tsx
// In the sessions page component, after data is loaded:
// data.boxes has the unfiltered counts from the RPC
// data.sessions has the filtered+paginated session list
// data.total has the total filtered count (before pagination)

// For the ACTIVE filter, show scoped counts:
const displayBoxes = {
  cartsOpened: boxFilter === '' ? data.boxes.cartsOpened : data.total,
  // NOTE: We don't have filtered sub-counts in the API response
  // So either:
  //   - pass boxFilter to the API and let it return filtered KPIs
  //   - OR calculate from the full session list (but we only have paginated)
};
```

**PROBLEM:** The API returns paginated sessions (25 per page) but total is the pre-pagination count. We can't calculate "withProducts" from 25 rows when there are 974 total.

**Better approach — Option B (server-side):**
In `app/api/couponmaxx/sessions/route.ts`, calculate scoped KPIs from the filtered (but un-paginated) session list:

```ts
// AFTER all filters are applied but BEFORE pagination:
// (Around line 175, after boxFilter/search filters)

const scopedBoxes = {
  cartsOpened: sessions.length,
  withProducts: sessions.filter(s => s.products.length > 0 || (s.cartValueEnd ?? 0) > 0).length,
  couponAttempted: sessions.filter(s => s.coupons.length > 0).length,
  reachedCheckout: sessions.filter(s => s.outcome !== 'abandoned').length,
};

// Then in the JSON response, add:
// scopedBoxes alongside boxes
```

Then in the frontend, when a boxFilter is active, show scopedBoxes instead of boxes.

**FILE CHANGES:**

**File: `app/api/couponmaxx/sessions/route.ts`**

FIND (around line 185):
```ts
const total           = sessions.length;
const paginated       = sessions.slice((page - 1) * perPage, page * perPage);
```

ADD BEFORE THAT:
```ts
  // Scoped KPI boxes — reflect whatever filters are active
  const scopedBoxes = {
    cartsOpened:     sessions.length,
    withProducts:    sessions.filter(s => s.products.length > 0 || (s.cartItemCount ?? 0) > 0 || (s.cartValueEnd ?? 0) > 0).length,
    couponAttempted: sessions.filter(s => s.coupons.length > 0).length,
    reachedCheckout: sessions.filter(s => s.outcome !== 'abandoned').length,
  };
```

FIND (around line 188):
```ts
  return NextResponse.json({
    boxes: {
```

ADD to the response object:
```ts
    scopedBoxes,
```

**File: `app/(embedded)/couponmaxx/sessions/page.tsx`**

Where KpiBox components render (around line 810), change the value source:

For each KpiBox, use scopedBoxes when a non-empty boxFilter is active:
```tsx
// Instead of always using data.boxes:
const activeBoxes = boxFilter !== '' && data?.scopedBoxes ? data.scopedBoxes : data?.boxes;
```

Then use `activeBoxes?.cartsOpened` etc for the KpiBox values.

### Issue 3: Coupon success rate: 34.3% (coupons page) vs 56.1% (analytics page)

**Cause: different date ranges.** Analytics page shows Mar 14–21 (7 days), Coupons page shows Feb 19–Mar 21 (30 days). Longer period includes older data with different rates. NOT a bug.

**Verify they use the same formula:**

Analytics API (`analytics/route.ts` line ~157):
```ts
const avgSuccessRate = totalAttempted > 0
  ? Math.round((totalApplied / totalAttempted) * 1000) / 10
  : 0;
```
Where totalApplied = sum of `sessions_coupon_applied` from daily_cart_metrics
And totalAttempted = sum of `sessions_coupon_attempted` from daily_cart_metrics

Coupons API: need to check — the coupons page queries CartEvent directly, grouping by code.

```sql
-- Verify analytics success rate for Mar 14-21:
SELECT
  COUNT(DISTINCT CASE WHEN "eventType" = 'cart_coupon_applied' THEN "sessionId" END) as applied,
  COUNT(DISTINCT CASE WHEN "eventType" IN ('cart_coupon_applied', 'cart_coupon_failed') THEN "sessionId" END) as attempted
FROM "CartEvent"
WHERE "shopId" = '<SHOP_ID>'
AND "occurredAt" >= '2026-03-14T00:00:00Z'
AND "occurredAt" <= '2026-03-21T23:59:59Z';
-- applied / attempted * 100 should ≈ 56.1%

-- Verify coupons page success rate for Feb 19 - Mar 21:
-- Same query but with different dates
-- should ≈ 34.3%
```

### Issue 4: Attributed sales ($209.98)

The RPC `couponmaxx_attributed_sales_daily` should return:
- Sum of cart values from sessions where a coupon was successfully applied AND the session reached checkout within the attribution window

**Verify:**
```sql
-- Find sessions with applied coupon + checkout in Mar 14-21:
SELECT ce."sessionId", MAX(ce."cartValue") / 100.0 as cart_value
FROM "CartEvent" ce
WHERE ce."shopId" = '<SHOP_ID>'
AND ce."occurredAt" >= '2026-03-14T00:00:00Z'
AND ce."occurredAt" <= '2026-03-21T23:59:59Z'
AND ce."eventType" = 'cart_coupon_applied'
AND EXISTS (
  SELECT 1 FROM "CartEvent" ce2
  WHERE ce2."sessionId" = ce."sessionId"
  AND ce2."eventType" = 'cart_checkout_clicked'
)
GROUP BY ce."sessionId";
-- Sum of cart_value should ≈ $209.98
```

### Issue 5: Coupons page — $0 for Avg cart (Success) on broken codes

**File:** `app/api/couponmaxx/coupons/route.ts`

The API returns avgCart = 0 when a code has 0 successful applications. This is technically correct but the frontend should display "—" instead of $0.

**File:** `app/(embedded)/couponmaxx/coupons/page.tsx`

FIND where Avg cart (Success) column renders. Change:
```tsx
// FIND something like:
{row.avgCart === 0 ? '$0' : `$${row.avgCart}`}

// REPLACE with:
{row.successRate === 0 ? '—' : `$${row.avgCart}`}
```
Show "—" when the code has ZERO success rate (broken), because $0 implies "free" not "no data."

---

## UI FIXES (DETAILED)

### Fix 1: Default boxFilter to 'products'

**File:** `app/(embedded)/couponmaxx/sessions/page.tsx`
**Line:** 589

```
FIND:    const [boxFilter, setBoxFilter] = useState('');
REPLACE: const [boxFilter, setBoxFilter] = useState('products');
```

This changes the initial view from 974 (mostly empty) to 63 (with products). Merchant sees useful data immediately.

### Fix 2: KPI box active state (already partially working)

**File:** `components/couponmaxx/KpiBox.tsx`

The component already has `outline: active ? '2px solid var(--p-color-border-interactive)' : undefined`. This works but is subtle.

Enhance by also adding a background change:

```
FIND:
  outline: active ? '2px solid var(--p-color-border-interactive)' : undefined,

REPLACE:
  outline: active ? '2px solid var(--p-color-border-interactive)' : '2px solid transparent',
  background: active ? 'var(--p-color-bg-surface-selected)' : undefined,
```

### Fix 3: Human event labels in session timeline

**File:** `app/(embedded)/couponmaxx/sessions/page.tsx`

Find where the session detail modal/panel renders timeline events. There will be a map over events showing `event.eventType`. Add a translation map at the top of the file:

```ts
const EVENT_LABELS: Record<string, string> = {
  cart_bulk_updated: 'Cart updated',
  cart_item_added: 'Added item to cart',
  cart_item_removed: 'Removed item from cart',
  cart_coupon_applied: '✓ Coupon applied',
  cart_coupon_failed: '✗ Coupon failed',
  cart_coupon_removed: 'Coupon removed',
  cart_checkout_clicked: 'Proceeded to checkout',
  cart_page_hidden: 'Left the page',
  cart_page_visible: 'Returned to page',
  cart_atc_clicked: 'Add to cart clicked',
  cart_viewed: 'Viewed cart',
  checkout_started: 'Checkout started',
  checkout_completed: 'Order completed',
  payment_info_submitted: 'Entered payment info',
};
```

Then replace the raw eventType display:
```
FIND:    {event.eventType}
REPLACE: {EVENT_LABELS[event.eventType] || event.eventType}
```

Note: The session detail opens from a modal. The actual timeline data comes from a separate API call: `GET /api/couponmaxx/session?shop=X&sessionId=Y` which returns raw CartEvent rows. Check that route for the exact event fields.

### Fix 4: Session detail as right-side panel

**File:** `app/(embedded)/couponmaxx/sessions/page.tsx`

Find where `<Modal>` is used for the session detail (search for `panelSession` or `Modal`).

Replace the Polaris `<Modal>` with a custom slide-in panel:

```tsx
{/* Overlay */}
{panelSession && (
  <div
    onClick={() => setPanelSession(null)}
    style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.3)', zIndex: 99,
    }}
  />
)}

{/* Slide-in panel */}
<div style={{
  position: 'fixed',
  top: 0,
  right: 0,
  width: 480,
  height: '100vh',
  background: '#fff',
  boxShadow: '-4px 0 20px rgba(0,0,0,0.08)',
  overflowY: 'auto',
  zIndex: 100,
  transform: panelSession ? 'translateX(0)' : 'translateX(100%)',
  transition: 'transform 0.2s ease',
  padding: '20px',
}}>
  {panelSession && (
    <>
      {/* Close button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={() => setPanelSession(null)} style={{
          background: 'none', border: 'none', fontSize: 20, cursor: 'pointer',
          color: 'var(--p-color-text-subdued)',
        }}>✕</button>
      </div>
      {/* Session detail content — move existing modal body here */}
      {/* ... existing session detail JSX ... */}
    </>
  )}
</div>
```

Also make table rows clickable:
```tsx
// On each IndexTable.Row or <tr>, add:
onClick={() => setPanelSession(session)}
style={{ cursor: 'pointer' }}
```

Remove the "View →" button column.

### Fix 5: Coupons page bar chart label overlap

**File:** `app/(embedded)/couponmaxx/coupons/page.tsx`

Find the horizontal bar chart (Success rate by code). The `<BarChart>` from recharts needs:
- More height: increase from whatever it is to at least `height={Math.max(300, codes.length * 35)}`
- Truncate Y-axis labels: add `tickFormatter={(v) => v.length > 12 ? v.slice(0, 12) + '…' : v}` to the `<YAxis>`
- Or limit to top 8 codes by attempt volume

### Fix 6: Onboarding banner auto-dismiss

**File:** `components/couponmaxx/OnboardingBanner.tsx`

The banner shows "Cart monitor: Not active" even when data is flowing. It receives `hasData` prop.

If `hasData` is true AND CartEvent count > 0, all 3 steps should show as complete:
- Cart monitor: ✓ Active (data is flowing)
- Checkout pixel: ✓ Active (or at least "optional")
- Receiving data: ✓ Yes

Check the component's internal logic. If it queries `shopify.app.extensions()` and doesn't find the cart-monitor, it shows "Not active" even though the extension IS working. The fix: if `hasData === true`, force all checks to green regardless of extension API response.

---

## ANALYTICS PAGE — Add "Revenue at risk" card

**File:** `app/api/couponmaxx/analytics/route.ts`

After the existing RPC calls, add a calculation:

```ts
// Revenue at risk: cart value of sessions where coupon failed + outcome = abandoned
// We already have session summaries from the funnel/cart metrics
// But we need per-session data. Query CartEvent directly:
const { data: riskSessions } = await supabase
  .from('CartEvent')
  .select('sessionId, cartValue')
  .eq('shopId', shopId)
  .eq('eventType', 'cart_coupon_failed')
  .gte('occurredAt', start.toISOString())
  .lte('occurredAt', end.toISOString());

// Deduplicate by sessionId, take max cartValue per session
const riskBySession = new Map<string, number>();
for (const row of (riskSessions ?? [])) {
  const current = riskBySession.get(row.sessionId) ?? 0;
  riskBySession.set(row.sessionId, Math.max(current, row.cartValue ?? 0));
}

// Filter to only sessions that were abandoned (no checkout event)
// Check against sessions that DID reach checkout
const { data: checkoutSessions } = await supabase
  .from('CartEvent')
  .select('sessionId')
  .eq('shopId', shopId)
  .eq('eventType', 'cart_checkout_clicked')
  .gte('occurredAt', start.toISOString())
  .lte('occurredAt', end.toISOString());

const checkoutSet = new Set((checkoutSessions ?? []).map(r => r.sessionId));

let revenueAtRisk = 0;
let riskSessionCount = 0;
for (const [sid, value] of riskBySession) {
  if (!checkoutSet.has(sid)) {
    revenueAtRisk += value;
    riskSessionCount++;
  }
}
revenueAtRisk = Math.round(revenueAtRisk) / 100; // cents to dollars
```

Add to the response JSON:
```ts
revenueAtRisk: {
  total: revenueAtRisk,
  sessions: riskSessionCount,
  avgCart: riskSessionCount > 0 ? Math.round(revenueAtRisk / riskSessionCount * 100) / 100 : 0,
},
```

**File:** `app/(embedded)/couponmaxx/analytics/page.tsx`

Add `revenueAtRisk` to the AnalyticsData type:
```ts
revenueAtRisk?: {
  total: number;
  sessions: number;
  avgCart: number;
};
```

Add a new MetricCard in Row 2, making it a 3-column grid:

```tsx
<InlineGrid columns={3} gap="400">
  <MetricCard title="Attributed sales" ... />
  <MetricCard
    title="Revenue at risk"
    definition="Cart value lost from sessions where a coupon failed and the customer abandoned"
    bigNumber={data ? `$${data.revenueAtRisk?.total.toLocaleString() ?? 0}` : '—'}
    emptyMessage="No failed coupon abandonments"
    loading={isLoading}
    error={!!error}
  />
  <MetricCard title="Cart views" ... />
</InlineGrid>
```

If MetricCard doesn't support rendering without chart data (no `data` prop), add a simple variant or just use a KpiBox-style card.

---

## NOTIFICATIONS — Make alerts actually fire

### Current state:
- `lib/alert-engine.ts` queries `CheckoutEvent` via Prisma
- Cron at 2 AM UTC: `GET /api/jobs/evaluate-alerts`
- Notifications page already has settings UI with toggles for: brokenCoupon, cvrDrop, productRestricted, zombieCodeSpike, couponDegraded, stepDropout, abandonedAfterFail, cartRecoveries, newTrafficSource
- Email via Resend, Slack via webhook

### What needs to change:
The alert engine needs to query `CartEvent` (via Supabase JS) instead of `CheckoutEvent` (via Prisma). The primary alert type for v1 is "broken coupon" — a specific code failing repeatedly.

### File: `lib/alert-engine.ts`

**FULL REWRITE:**

```ts
import { supabase } from './supabase';
import prisma from './prisma';
import { sendAlertEmail } from './send-email';
import { sendSlackMessage } from './send-slack';

const COOLDOWN_HOURS = 4;

export async function evaluateAlerts() {
  // Get all active shops
  const shops = await prisma.shop.findMany({ where: { isActive: true } });
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000);

  for (const shop of shops) {
    try {
      // 1. Get coupon failure counts in last 2 hours, grouped by code
      const { data: failEvents } = await supabase
        .from('CartEvent')
        .select('couponCode, eventType')
        .eq('shopId', shop.id)
        .gte('occurredAt', twoHoursAgo.toISOString())
        .in('eventType', ['cart_coupon_applied', 'cart_coupon_failed']);

      if (!failEvents || failEvents.length === 0) continue;

      // Group by code
      const codeStats = new Map<string, { applied: number; failed: number }>();
      for (const ev of failEvents) {
        if (!ev.couponCode) continue;
        const code = ev.couponCode.toUpperCase();
        const stats = codeStats.get(code) ?? { applied: 0, failed: 0 };
        if (ev.eventType === 'cart_coupon_applied') stats.applied++;
        else stats.failed++;
        codeStats.set(code, stats);
      }

      // 2. Check each code against threshold
      const threshold = (shop as Record<string, unknown>).discountFailureMin as number ?? 3;

      for (const [code, stats] of codeStats) {
        if (stats.failed < threshold) continue;

        const failRate = Math.round((stats.failed / (stats.failed + stats.applied)) * 100);

        // Check cooldown — was a similar alert sent recently?
        const recentAlert = await prisma.alertLog.findFirst({
          where: {
            shopId: shop.id,
            title: { contains: code },
            firedAt: { gte: cooldownCutoff },
          },
        });
        if (recentAlert) continue;

        // 3. Fire alert
        const title = `Code ${code} failed ${stats.failed} times (${failRate}% failure rate)`;
        const body = `In the last 2 hours, ${stats.failed} customers tried code ${code} and it didn't work. ${stats.applied} uses succeeded. Check if this code has expired, hit its usage limit, or has collection restrictions.`;

        // Log to AlertLog
        await prisma.alertLog.create({
          data: {
            shopId: shop.id,
            title,
            body,
            severity: failRate >= 80 ? 'critical' : 'warning',
          },
        });

        // Send email
        const alertEmail = (shop as Record<string, unknown>).alertEmail as string | null;
        if (alertEmail) {
          await sendAlertEmail({
            to: alertEmail,
            title,
            body,
            actionUrl: `https://couponmaxx.vercel.app/couponmaxx/coupons`,
            actionLabel: 'View coupons',
            shopDomain: shop.shopDomain,
          });
        }

        // Send Slack
        const slackUrl = (shop as Record<string, unknown>).slackWebhookUrl as string | null;
        if (slackUrl) {
          await sendSlackMessage({
            webhookUrl: slackUrl,
            title,
            body,
            actionUrl: `https://couponmaxx.vercel.app/couponmaxx/coupons`,
            actionLabel: 'View coupons',
            shopDomain: shop.shopDomain,
          });
        }

        console.log(`[evaluate-alerts] Fired alert for ${shop.shopDomain}: ${title}`);
      }
    } catch (err) {
      console.error(`[evaluate-alerts] Error for ${shop.shopDomain}:`, (err as Error).message);
    }
  }
}
```

### Verify alerts work:
```bash
# Trigger manually:
curl https://checkoutmaxx-rt55.vercel.app/api/jobs/evaluate-alerts

# Check Vercel logs for "[evaluate-alerts]" lines
# Check Supabase AlertLog table for new rows
# Check your email for the alert
```

### RESEND_API_KEY env var:
Verify it exists on BOTH Vercel projects:
- checkoutmaxx-rt55 (Dr.Water): Settings → Environment Variables → RESEND_API_KEY
- couponmaxx (public): same

If missing, add it. Get the key from https://resend.com/api-keys

### Cron requires Vercel Pro ($20/mo):
- `vercel.json` has 3 crons defined
- They only run on paid Vercel plans
- For testing: trigger manually with curl
- For production: upgrade checkoutmaxx-rt55 to Vercel Pro

---

## EXECUTION ORDER

### Batch 0: Dead code cleanup (DEV-ROADMAP P1)
Delete all v1/v2/v3 files. Verify build succeeds.
```bash
git add -A && git commit -m "chore: remove dead v1/v2/v3 code" && git push
```

### Batch 1: Sessions page — data accuracy
1. Add scopedBoxes to sessions API response
2. Use scopedBoxes in frontend when boxFilter is active
3. Default boxFilter to 'products'
4. KPI box enhanced active state
```bash
git add -A && git commit -m "fix: KPIs match active filter, default to products view" && git push
```

### Batch 2: Sessions page — UI
1. Human event labels in timeline
2. Right-side panel instead of modal
3. Clickable rows, remove View button column
4. Truncate Products column, icon for Device
```bash
git add -A && git commit -m "feat: slide-in session panel, human event labels, clickable rows" && git push
```

### Batch 3: Analytics page
1. Add revenue at risk calculation to analytics API
2. Add revenue at risk MetricCard to analytics page
3. Auto-dismiss onboarding banner when hasData=true
4. Remove debug console.log lines
```bash
git add -A && git commit -m "feat: revenue at risk metric, auto-dismiss onboarding" && git push
```

### Batch 4: Coupons page polish
1. $0 → "—" for broken code avg cart
2. Bar chart label overlap fix (height + truncation)
3. Verify color thresholds for dots (red/orange/yellow/green/grey)
```bash
git add -A && git commit -m "fix: coupons page null states, chart labels" && git push
```

### Batch 5: Notifications — alert engine
1. Rewrite lib/alert-engine.ts (CartEvent queries via Supabase)
2. Verify RESEND_API_KEY env var
3. Test with manual curl
```bash
git add -A && git commit -m "feat: coupon failure alerts from CartEvent data" && git push
```

### After each batch:
1. `npx next build` — must succeed
2. Push to main → checkoutmaxx-rt55 auto-deploys → test on Dr.Water
3. When batch works on Dr.Water → manually redeploy couponmaxx
4. Do NOT run `npx shopify app deploy` unless changing extension code

---

## CALENDAR / DATE PICKER

The DateRangePicker component uses an OptionList for presets (Today, Yesterday, Last 7 days, etc.) and a custom calendar for date range selection.

**Known issue from screenshots:** The calendar opens correctly but:
- No visual indication of selected range (start/end highlights)
- The calendar navigation (month arrows) may not work smoothly

**File:** `components/couponmaxx/DateRangePicker.tsx`

Read this file to check:
1. Does the calendar highlight the selected start/end dates?
2. Do the month navigation arrows work?
3. Does "Apply" button correctly set the date range?

If the calendar is fundamentally broken, replace it with Polaris `<DatePicker>` which handles all of this natively.

---

## Batch 6: Date picker + Loading bar

### Fix 1: Date picker — Alia-style layout (presets left, calendar right)

**File:** `components/couponmaxx/DateRangePicker.tsx`

The current implementation shows presets OR calendar (toggled via `showCalendar` state). Change to show BOTH at once when "Custom range" is clicked, side by side.

**Replace the entire return block** inside the `<Popover>` with:

```tsx
<Popover
  active={active}
  activator={activator}
  onClose={() => setActive(false)}
  preferredAlignment="left"
  fluidContent
>
  <div style={{ display: 'flex', minWidth: showCalendar ? 560 : 200 }}>
    {/* Left: Presets */}
    <div style={{ 
      borderRight: showCalendar ? '1px solid var(--p-color-border-subdued)' : 'none',
      minWidth: 160,
    }}>
      <OptionList
        onChange={handlePresetSelect}
        options={[
          ...PRESETS.map(p => ({ label: p.label, value: p.value })),
          { label: 'Custom range...', value: 'custom' },
        ]}
        selected={matched ? [matched] : showCalendar ? ['custom'] : []}
      />
    </div>

    {/* Right: Calendar (only when custom is selected) */}
    {showCalendar && (
      <div style={{ padding: 16 }}>
        <BlockStack gap="300">
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--p-color-text)' }}>
            {fmtShort(pending.start)} – {fmtShort(pending.end)}
          </div>
          <DatePicker
            month={month}
            year={year}
            onChange={({ start, end }) => {
              setPending({ start: startOfDay(start), end: endOfDay(end) });
            }}
            onMonthChange={(m, y) => setDate({ month: m, year: y })}
            selected={{ start: pending.start, end: pending.end }}
            allowRange
            multiMonth
          />
          <InlineStack gap="200" align="end">
            <Button onClick={() => setShowCalendar(false)}>Back</Button>
            <Button variant="primary" onClick={handleApply}>Apply</Button>
          </InlineStack>
        </BlockStack>
      </div>
    )}
  </div>
</Popover>
```

Key changes:
- `display: flex` puts presets and calendar side by side
- `multiMonth` on `<DatePicker>` shows two months like Alia
- Presets always visible on the left, calendar appears on the right when "Custom range" is selected
- Popover width expands from 200px (presets only) to 560px (presets + dual calendar)

Also change `handlePresetSelect` so clicking a preset while calendar is open closes the calendar:
```ts
const handlePresetSelect = useCallback((selected: string[]) => {
  const val = selected[0];
  if (val === 'custom') {
    setShowCalendar(true);
    return;
  }
  setShowCalendar(false);  // <-- ADD THIS LINE
  onChange(getPresetRange(Number(val)));
  setActive(false);
}, [onChange]);
```

### Fix 2: Loading bar at top of content area

**File:** `app/(embedded)/couponmaxx/layout.tsx`

Alia shows a thin animated bar at the top of the iframe while content loads. We can do this with a simple CSS animation that renders when any child page is loading.

Better approach: add it per-page since each page has its own `isLoading` state from SWR.

**File:** `app/(embedded)/couponmaxx/analytics/page.tsx` (and sessions, coupons, notifications)

Add at the top of the page return, inside `<Page>`:

```tsx
{isLoading && (
  <div style={{
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    zIndex: 200,
    overflow: 'hidden',
  }}>
    <div style={{
      height: '100%',
      background: 'var(--p-color-bg-fill-info)',
      animation: 'loadingSlide 1.2s ease-in-out infinite',
      width: '30%',
    }} />
    <style>{`
      @keyframes loadingSlide {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }
    `}</style>
  </div>
)}
```

This gives a thin blue bar that slides across the top while data is loading — exactly like Alia's.

Add this to ALL 4 pages (analytics, sessions, coupons, notifications). Or create a shared `<LoadingBar loading={boolean} />` component and import it.

**Commit:** `"feat: Alia-style date picker with dual calendar, loading bar"`

---

## VERIFICATION CHECKLIST (run after all batches)

```bash
# 1. Build succeeds:
npx next build 2>&1 | tail -5

# 2. No dead code left:
ls app/\(embedded\)/dashboard/ 2>/dev/null && echo "FAIL: dashboard still exists" || echo "PASS"
ls app/api/v2/ 2>/dev/null && echo "FAIL: v2 still exists" || echo "PASS"
ls app/api/v3/ 2>/dev/null && echo "FAIL: v3 still exists" || echo "PASS"

# 3. No debug logs:
grep -rn "DEBUG\|!!!!" app/ --include="*.ts" --include="*.tsx" | grep -v node_modules | wc -l
# Should be 0

# 4. scopedBoxes in sessions API:
grep "scopedBoxes" app/api/couponmaxx/sessions/route.ts
# Should exist

# 5. Revenue at risk in analytics API:
grep "revenueAtRisk" app/api/couponmaxx/analytics/route.ts
# Should exist

# 6. Human event labels:
grep "EVENT_LABELS" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Should exist

# 7. Alert engine uses CartEvent:
grep "CartEvent" lib/alert-engine.ts
# Should exist
grep "checkoutEvent" lib/alert-engine.ts
# Should NOT exist (old code)

# 8. Default boxFilter:
grep "useState('products')" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Should exist
```
