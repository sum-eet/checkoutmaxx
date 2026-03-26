# Hotfix Batch 3 — Date picker side-by-side, KPI box height, blue→black, sessions filter bug

## DO NOT redeploy couponmaxx. Push to main only. Test on Dr.Water.

---

## Fix 1: Date picker — calendar opens to the RIGHT, not below

**Problem:** Custom range calendar opens below the preset list, making the popover too tall. It should open side-by-side: presets on the left, calendar on the right.

**File:** `components/couponmaxx/DateRangePicker.tsx`

Find the section that renders presets and calendar. Currently the calendar is BELOW the presets (stacked vertically). Change to side-by-side (flex row).

**Find the structure that looks like:**
```tsx
<div style={{ padding: '8px 0', minWidth: mode === 'calendar' ? 280 : 180 }}>
  {/* Presets */}
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    {PRESETS.map(...)}
    <button ... >Custom range...</button>
  </div>

  {/* Calendar below */}
  {mode === 'calendar' && (
    <>
      <div style={{ borderTop: '1px solid #e1e3e5', margin: '8px 0' }} />
      <div style={{ padding: '4px 16px 8px' }}>
        ...MiniCalendar...
      </div>
    </>
  )}
</div>
```

**Replace with side-by-side layout:**
```tsx
<div style={{ display: 'flex', padding: '8px 0' }}>
  {/* Left: Presets */}
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    minWidth: 160,
    borderRight: mode === 'calendar' ? '1px solid #e1e3e5' : 'none',
  }}>
    {PRESETS.map(p => (
      <button
        key={p.days}
        onClick={() => handlePresetClick(p.days)}
        style={{
          background: matched === p.days ? '#F1F1F1' : 'transparent',
          border: 'none',
          padding: '8px 16px',
          fontSize: 13,
          textAlign: 'left',
          cursor: 'pointer',
          color: '#202223',
          fontWeight: matched === p.days ? 600 : 400,
        }}
        onMouseEnter={(e) => (e.target as HTMLElement).style.background = '#F6F6F7'}
        onMouseLeave={(e) => (e.target as HTMLElement).style.background = matched === p.days ? '#F1F1F1' : 'transparent'}
      >
        {p.label}
      </button>
    ))}
    <button
      onClick={() => setMode(mode === 'calendar' ? 'presets' : 'calendar')}
      style={{
        background: mode === 'calendar' ? '#F1F1F1' : 'transparent',
        border: 'none',
        padding: '8px 16px',
        fontSize: 13,
        textAlign: 'left',
        cursor: 'pointer',
        color: '#2C6ECB',
        fontWeight: mode === 'calendar' ? 600 : 400,
      }}
      onMouseEnter={(e) => (e.target as HTMLElement).style.background = '#F6F6F7'}
      onMouseLeave={(e) => (e.target as HTMLElement).style.background = mode === 'calendar' ? '#F1F1F1' : 'transparent'}
    >
      Custom range...
    </button>
  </div>

  {/* Right: Calendar (side-by-side with presets) */}
  {mode === 'calendar' && (
    <div style={{ padding: '4px 16px 8px' }}>
      <div style={{ fontSize: 12, color: '#6d7175', marginBottom: 8 }}>
        {selectingStart ? 'Select start date' : 'Select end date'}: {fmtShort(pending.start)} – {fmtShort(pending.end)}
      </div>
      <MiniCalendar
        month={viewMonth}
        year={viewYear}
        range={pending}
        selectingStart={selectingStart}
        onDayClick={handleDayClick}
        onPrevMonth={() => {
          if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
          else setViewMonth(viewMonth - 1);
        }}
        onNextMonth={() => {
          if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
          else setViewMonth(viewMonth + 1);
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button
          onClick={() => setMode('presets')}
          style={{ padding: '6px 12px', fontSize: 12, background: '#fff', border: '1px solid #c9cccf', borderRadius: 6, cursor: 'pointer' }}
        >
          Back
        </button>
        <button
          onClick={handleApply}
          style={{ padding: '6px 12px', fontSize: 12, background: '#2C6ECB', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
        >
          Apply
        </button>
      </div>
    </div>
  )}
</div>
```

Key change: the outer container is now `display: 'flex'` (row direction). Presets on the left, calendar on the right. No `borderTop` separator — uses `borderRight` on the presets column instead. Total width when calendar is open: ~160px presets + ~270px calendar = ~430px. Height stays compact because nothing stacks vertically.

Remove any `<div style={{ borderTop: ... }}>` separator that was between presets and calendar.

---

## Fix 2: Calendar selection color — blue (#2C6ECB) → black (#202223)

**File:** `components/couponmaxx/DateRangePicker.tsx`

Find the `MiniCalendar` component. In the day rendering logic, find where the selected start/end date background color is set:

```tsx
// FIND:
if (isStart || isEnd) { bg = '#2C6ECB'; color = '#fff'; fontWeight = 600; }
else if (isInRange) { bg = '#E4EFFE'; }

// REPLACE:
if (isStart || isEnd) { bg = '#202223'; color = '#fff'; fontWeight = 600; }
else if (isInRange) { bg = '#EDEEEF'; }
```

Also change the Apply button color to match:

```tsx
// FIND:
style={{ padding: '6px 12px', fontSize: 12, background: '#2C6ECB', color: '#fff', ...

// REPLACE:
style={{ padding: '6px 12px', fontSize: 12, background: '#202223', color: '#fff', ...
```

And the "Custom range..." text color:

```tsx
// FIND:
color: '#2C6ECB',

// REPLACE:
color: '#202223',
```

---

## Fix 3: KPI boxes — SAME height across all 4

**Problem:** "Reached Checkout" box has an extra line ("7 had a coupon · 18 did not") that makes it taller than the other 3 boxes.

**Solution:** Add a secondary line to ALL 4 boxes so they're all the same height. Each box gets a `sub2` line with relevant detail:

**File:** `app/(embedded)/couponmaxx/sessions/page.tsx`

Find where the 4 KpiBox components render. They currently look something like:

```tsx
<KpiBox
  label="Carts Opened"
  value={data?.boxes?.cartsOpened ?? '—'}
  sub1={`${data?.boxes?.withProducts ?? 0} with products · ${data?.boxes?.emptyCount ?? 0} empty`}
  active={boxFilter === ''}
  onClick={() => handleBoxClick('')}
/>
<KpiBox
  label="With Products"
  value={data?.boxes?.withProducts ?? '—'}
  sub1={`${data?.boxes?.withProductsPct ?? 0}% of carts opened`}
  active={boxFilter === 'products'}
  onClick={() => handleBoxClick('products')}
/>
<KpiBox
  label="Coupon Attempted"
  value={data?.boxes?.couponAttempted ?? '—'}
  sub1={`${data?.boxes?.couponAttemptedPct ?? 0}% of product carts`}
  active={boxFilter === 'coupon'}
  onClick={() => handleBoxClick('coupon')}
/>
<KpiBox
  label="Reached Checkout"
  value={data?.boxes?.reachedCheckout ?? '—'}
  sub1={`${data?.boxes?.reachedCheckoutPct ?? 0}% of product carts`}
  sub2={`${data?.boxes?.checkoutWithCoupon ?? 0} had a coupon · ${data?.boxes?.checkoutWithoutCoupon ?? 0} did not`}
  active={boxFilter === 'checkout'}
  onClick={() => handleBoxClick('checkout')}
/>
```

**Option A (recommended): Add sub2 to ALL boxes**

```tsx
<KpiBox
  label="Carts Opened"
  value={data?.boxes?.cartsOpened ?? '—'}
  sub1={`${data?.boxes?.withProducts ?? 0} with products · ${data?.boxes?.emptyCount ?? 0} empty`}
  sub2={`${data?.boxes?.couponAttempted ?? 0} tried a coupon`}
  active={boxFilter === ''}
  onClick={() => handleBoxClick('')}
/>
<KpiBox
  label="With Products"
  value={data?.boxes?.withProducts ?? '—'}
  sub1={`${data?.boxes?.withProductsPct ?? 0}% of carts opened`}
  sub2={`${data?.boxes?.couponAttempted ?? 0} attempted a coupon`}
  active={boxFilter === 'products'}
  onClick={() => handleBoxClick('products')}
/>
<KpiBox
  label="Coupon Attempted"
  value={data?.boxes?.couponAttempted ?? '—'}
  sub1={`${data?.boxes?.couponAttemptedPct ?? 0}% of product carts`}
  sub2={`${(data?.boxes?.couponAttempted ?? 0) - (data?.boxes?.reachedCheckout ?? 0)} abandoned after trying`}
  active={boxFilter === 'coupon'}
  onClick={() => handleBoxClick('coupon')}
/>
<KpiBox
  label="Reached Checkout"
  value={data?.boxes?.reachedCheckout ?? '—'}
  sub1={`${data?.boxes?.reachedCheckoutPct ?? 0}% of product carts`}
  sub2={`${data?.boxes?.checkoutWithCoupon ?? 0} had a coupon · ${data?.boxes?.checkoutWithoutCoupon ?? 0} did not`}
  active={boxFilter === 'checkout'}
  onClick={() => handleBoxClick('checkout')}
/>
```

Now every box has 3 lines (label, value+sub1, sub2). All same height.

**Also apply the same pattern on the Coupons page** — find where KpiBox is used on `app/(embedded)/couponmaxx/coupons/page.tsx` and ensure all boxes have the same number of text lines.

**Additionally, ensure the CSS grid is being used (not InlineGrid):**

```tsx
// The wrapper MUST be raw CSS grid, not Polaris InlineGrid:
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, alignItems: 'stretch' }}>
  <KpiBox ... />
  <KpiBox ... />
  <KpiBox ... />
  <KpiBox ... />
</div>
```

If Claude Code used `<InlineGrid columns={4}>` in a previous batch, replace it with this raw CSS grid. Polaris InlineGrid does NOT enforce equal row height. CSS grid with `alignItems: 'stretch'` does.

---

## Fix 4: "With Products" filter showing 83 instead of 63

**Problem:** The KPI box says "With Products: 63" but clicking it shows "Showing 83 sessions."

**Root cause:** The boxFilter logic in the sessions API uses a different definition of "with products" than the KPI RPC.

**File:** `app/api/couponmaxx/sessions/route.ts`

Find the boxFilter logic (around line 171):

```ts
if (boxFilter === 'products') sessions = sessions.filter((s) => (s.cartItemCount ?? 0) > 0 || s.products.length > 0 || (s.cartValueEnd ?? 0) > 0);
```

This filter has THREE conditions joined by OR:
1. `cartItemCount > 0` — had items in cart
2. `products.length > 0` — had identified product titles
3. `cartValueEnd > 0` — had a non-zero cart value

The KPI RPC (`couponmaxx_session_kpis`) probably only checks ONE of these conditions (likely `cartItemCount > 0` or just counts sessions with product titles). The JS filter is more lenient — it includes sessions that have a cart value but no identified products, or sessions with products array populated from line_items but cartItemCount of 0.

**Fix:** Make the JS filter match the KPI definition EXACTLY. The KPI says 63, so the filter should return 63.

First, check what the KPI RPC defines as "with_products":

```sql
-- Run in Supabase to see the RPC definition:
-- Go to Supabase dashboard → SQL Editor → search for couponmaxx_session_kpis
-- Look at how with_products is calculated
```

Then update the JS filter to match. Most likely the RPC uses:
```sql
COUNT(DISTINCT CASE WHEN cart_item_count > 0 THEN session_id END) as with_products
```

So the JS filter should ONLY check cartItemCount:
```ts
// FIND:
if (boxFilter === 'products') sessions = sessions.filter((s) => (s.cartItemCount ?? 0) > 0 || s.products.length > 0 || (s.cartValueEnd ?? 0) > 0);

// REPLACE:
if (boxFilter === 'products') sessions = sessions.filter((s) => (s.cartItemCount ?? 0) > 0);
```

This removes the extra OR conditions that were inflating the count from 63 to 83.

**IF after this change the count still doesn't match 63**, the issue might be that `cartItemCount` is populated differently in the session summaries vs the KPI RPC. In that case, also check if products.length > 0 gives 63:

```ts
// Try this instead:
if (boxFilter === 'products') sessions = sessions.filter((s) => s.products.length > 0);
```

Test both. The one that returns 63 sessions is the correct filter.

---

## VERIFY

```bash
npx next build 2>&1 | tail -5

# Date picker: side-by-side layout
grep "display: 'flex'" components/couponmaxx/DateRangePicker.tsx | head -3
# Should show flex on the outer container (row direction, not column)

# No vertical separator between presets and calendar:
grep "borderTop.*e1e3e5" components/couponmaxx/DateRangePicker.tsx
# Should NOT exist (removed)

# Black selection color:
grep "#202223" components/couponmaxx/DateRangePicker.tsx
# Should exist (for selected dates and Apply button)

# No blue selection color on dates:
grep "2C6ECB.*isStart\|isEnd.*2C6ECB" components/couponmaxx/DateRangePicker.tsx
# Should NOT exist

# All KPI boxes have sub2:
grep -c "sub2=" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Should be 4 (one per KpiBox)

# CSS grid not InlineGrid for KPI boxes:
grep "gridTemplateColumns.*repeat(4" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Should exist

# Products filter simplified:
grep "boxFilter === 'products'" app/api/couponmaxx/sessions/route.ts
# Should show only cartItemCount check, not the triple OR condition
```

## COMMIT

```bash
git add -A
git commit -m "fix: date picker side-by-side, black selection, KPI equal height with sub2, products filter match"
git push
```

Wait 2 min. Test on Dr.Water:
1. Date picker — click Custom range → calendar appears to the RIGHT of presets, not below
2. Date picker — selected dates are BLACK, not blue
3. KPI boxes — all 4 are exactly the same height
4. Click "With Products" box → "Showing 63 sessions" (not 83)
5. Click "Reached Checkout" box → "Showing 25 sessions"
