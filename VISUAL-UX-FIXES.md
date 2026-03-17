# CouponMaxx — Visual & UX Fixes

Issues visible in screenshots + data presentation problems. Each fix has code.

---

## FIX 1: DateRangePicker — Replace two-control mess with single Shopify-style button

**Problem**: There are TWO controls — a `<Select>` labeled "Date range Presets" AND a calendar button showing "Feb 15 – Mar 17". This is confusing. When you pick a preset from the Select, the calendar button stays. When you pick "Custom", you get a popover. The Select dropdown overlaps the KPI boxes below it (visible in screenshot 2). There's also no Apply button visible when using presets.

**Fix**: Replace with a SINGLE button that opens a Popover with presets on the left and calendar on the right — the Shopify admin pattern. But since we need mobile-friendly, do it as: single `<Button>` activator → `<Popover>` with a `<ChoiceList>` for presets. Only show calendar for "Custom". One control, one click.

**Replace entire `components/couponmaxx/DateRangePicker.tsx`:**

```tsx
'use client';

import { useState, useCallback } from 'react';
import { Popover, Button, OptionList, DatePicker, BlockStack, InlineStack } from '@shopify/polaris';
import { CalendarIcon } from '@shopify/polaris-icons';

export type DateRange = { start: Date; end: Date };

type Props = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  defaultDays?: number;
};

function fmtShort(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function subDays(d: Date, n: number) {
  return new Date(d.getTime() - n * 86400000);
}

function startOfDay(d: Date): Date {
  return new Date(d.toISOString().slice(0, 10) + 'T00:00:00.000Z');
}

function endOfDay(d: Date): Date {
  return new Date(d.toISOString().slice(0, 10) + 'T23:59:59.999Z');
}

const PRESETS: { label: string; value: string; days: number }[] = [
  { label: 'Today', value: '0', days: 0 },
  { label: 'Yesterday', value: '1', days: 1 },
  { label: 'Last 7 days', value: '7', days: 7 },
  { label: 'Last 14 days', value: '14', days: 14 },
  { label: 'Last 30 days', value: '30', days: 30 },
  { label: 'Last 90 days', value: '90', days: 90 },
];

function getPresetRange(days: number): DateRange {
  const now = new Date();
  if (days === 0) return { start: startOfDay(now), end: endOfDay(now) };
  if (days === 1) {
    const y = subDays(now, 1);
    return { start: startOfDay(y), end: endOfDay(y) };
  }
  return { start: startOfDay(subDays(now, days)), end: endOfDay(now) };
}

function matchPreset(range: DateRange): string | null {
  for (const p of PRESETS) {
    const r = getPresetRange(p.days);
    if (Math.abs(r.start.getTime() - range.start.getTime()) < 60000 &&
        Math.abs(r.end.getTime() - range.end.getTime()) < 60000) {
      return p.value;
    }
  }
  return null;
}

export function DateRangePicker({ value, onChange }: Props) {
  const [active, setActive] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [pending, setPending] = useState<DateRange>(value);
  const [{ month, year }, setDate] = useState({
    month: value.start.getMonth(),
    year: value.start.getFullYear(),
  });

  const matched = matchPreset(value);
  const presetLabel = PRESETS.find(p => p.value === matched)?.label;
  const buttonLabel = presetLabel
    ? `${presetLabel} (${fmtShort(value.start)} – ${fmtShort(value.end)})`
    : `${fmtShort(value.start)} – ${fmtShort(value.end)}`;

  const handleOpen = useCallback(() => {
    setShowCalendar(false);
    setPending(value);
    setDate({ month: value.start.getMonth(), year: value.start.getFullYear() });
    setActive(true);
  }, [value]);

  const handlePresetSelect = useCallback((selected: string[]) => {
    const val = selected[0];
    if (val === 'custom') {
      setShowCalendar(true);
      return;
    }
    onChange(getPresetRange(Number(val)));
    setActive(false);
  }, [onChange]);

  const handleApply = useCallback(() => {
    onChange(pending);
    setActive(false);
  }, [onChange, pending]);

  const activator = (
    <Button icon={CalendarIcon} onClick={handleOpen} disclosure>
      {buttonLabel}
    </Button>
  );

  return (
    <Popover
      active={active}
      activator={activator}
      onClose={() => setActive(false)}
      preferredAlignment="left"
      fluidContent
    >
      {!showCalendar ? (
        <OptionList
          onChange={handlePresetSelect}
          options={[
            ...PRESETS.map(p => ({ label: p.label, value: p.value })),
            { label: 'Custom range...', value: 'custom' },
          ]}
          selected={matched ? [matched] : []}
        />
      ) : (
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
            />
            <InlineStack gap="200" align="end">
              <Button onClick={() => setShowCalendar(false)}>Back</Button>
              <Button variant="primary" onClick={handleApply}>Apply</Button>
            </InlineStack>
          </BlockStack>
        </div>
      )}
    </Popover>
  );
}
```

**Why this is better**: Single button. Click → see presets as a list. Pick one → done, popover closes. Pick "Custom range..." → calendar appears with Apply/Back. No two-control confusion. `<OptionList>` handles sizing natively. No overlap with content below.

VERIFY:
```bash
grep -c "OptionList" components/couponmaxx/DateRangePicker.tsx
# Must output: >= 1

grep -c '<Select' components/couponmaxx/DateRangePicker.tsx
# Must output: 0 (no more Select)
```

---

## FIX 2: KPI boxes equal height + proper grid

**Problem**: KPI boxes in the coupons page have different heights — "Codes Tracked" has 2 sub-lines, "Coupon Success Rate" has 1 sub-line + a delta arrow, "Checkout AOV" has the longest text, "Abandoned After Coupon Failure" has 2 long sub-lines. With `flex: 1`, they stretch horizontally but NOT vertically — so each box is only as tall as its content.

**Fix**: Use CSS Grid with `align-items: stretch` so all boxes in the same row are the same height. Also add a fixed `minHeight` inside the Card so they look substantial even with minimal content.

**Replace `components/couponmaxx/KpiBox.tsx`:**

```tsx
'use client';

import { Card, Text, BlockStack } from '@shopify/polaris';

type KpiBoxProps = {
  label: string;
  value: string | number;
  sub1?: string;
  sub2?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
};

export function KpiBox({ label, value, sub1, sub2, active, onClick }: KpiBoxProps) {
  return (
    <div
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : undefined,
        borderRadius: 'var(--p-border-radius-300)',
        outline: active ? '2px solid var(--p-color-border-interactive)' : undefined,
        outlineOffset: -1,
        height: '100%',  // stretch to grid row height
      }}
    >
      <Card>
        <BlockStack gap="200">
          <Text variant="bodySm" tone="subdued" as="p">{label}</Text>
          <Text variant="headingXl" as="p">{String(value)}</Text>
          {sub1 && <Text variant="bodySm" tone="subdued" as="p">{sub1}</Text>}
          {sub2 != null && (
            <Text variant="bodySm" tone="subdued" as="span">{sub2}</Text>
          )}
        </BlockStack>
      </Card>
    </div>
  );
}
```

**Then in EVERY page that uses KpiBox**, replace the flex container with a CSS grid:

In `sessions/page.tsx` and `coupons/page.tsx`, replace:
```tsx
<div style={{ display: 'flex', gap: 12 }}>
```

With:
```tsx
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'stretch' }}>
```

The `alignItems: 'stretch'` + `height: '100%'` on KpiBox makes all boxes the same height.

VERIFY:
```bash
grep -c "gridTemplateColumns.*repeat.*4" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: >= 1

grep -c "gridTemplateColumns.*repeat.*4" app/\(embedded\)/couponmaxx/coupons/page.tsx
# Must output: >= 1

grep -c "height.*100%" components/couponmaxx/KpiBox.tsx
# Must output: 1
```

---

## FIX 3: Sessions page — default to "With Products" filter, not all carts

**Problem**: 1000 sessions shown, vast majority are "Empty cart / — / — / Abandoned". These are cart drawer opens with no products. Useless noise. The merchant sees 1000 sessions and thinks "wow lots of data" but 0.1% completed an order and most have nothing in them.

**Fix**: Default `boxFilter` to `'products'` instead of empty string. This shows the "With Products" box as active by default and filters the table to only sessions that had items in the cart.

In `sessions/page.tsx`, change:
```tsx
// BEFORE:
const [boxFilter, setBoxFilter] = useState('');

// AFTER:
const [boxFilter, setBoxFilter] = useState('products');
```

Also change the "Carts Opened" box click to set `''` (show all) — it already does this. Just make sure the active highlight matches:

The `active={boxFilter === ''}` on "Carts Opened" is correct — clicking it shows all. But now default is 'products', so "With Products" will be active on load.

VERIFY:
```bash
grep "useState.*boxFilter" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must contain: useState('products')
```

---

## FIX 4: "$0 with coupon" AOV — fix the KPI display

**Problem**: "Checkout AOV: $0 with coupon" is shown when `aovWithCoupon` is 0. This happens when no coupon orders completed checkout in the period. Showing "$0" is misleading — it implies coupons make orders worth nothing. Should show "No data" or "—" when there are no coupon orders.

In `coupons/page.tsx`, change the AOV KpiBox:

```tsx
{/* Box 3 — Checkout AOV */}
<KpiBox
  label="Checkout AOV"
  value={
    data.boxes.aovWithCoupon > 0
      ? `$${Math.round(data.boxes.aovWithCoupon)}`
      : '—'
  }
  sub1={
    data.boxes.aovWithCoupon > 0
      ? `with coupon applied`
      : 'No coupon orders in this period'
  }
  sub2={
    data.boxes.aovWithCoupon > 0 && data.boxes.aovWithoutCoupon > 0
      ? (() => {
          const diff = data.boxes.aovWithCoupon - data.boxes.aovWithoutCoupon;
          const sign = diff >= 0 ? '+' : '-';
          const color = diff >= 0 ? '#15803D' : '#B91C1C';
          return (
            <span>
              ${Math.round(data.boxes.aovWithoutCoupon)} without
              {' · '}
              <span style={{ color }}>{sign}${Math.round(Math.abs(diff))}</span>
            </span>
          );
        })()
      : undefined
  }
/>
```

VERIFY:
```bash
grep -A2 "Checkout AOV" app/\(embedded\)/couponmaxx/coupons/page.tsx | head -5
# Should show conditional logic, not raw $0
```

---

## FIX 5: Replace inline flex layouts with Polaris `<InlineGrid>` and `<BlockStack>`

**Problem**: Pages still use `display: flex, gap: 12` and `display: grid, gridTemplateColumns` with raw inline styles. This should be Polaris layout components.

**Metric card grid** (analytics page) — replace:
```tsx
// BEFORE:
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

// AFTER:
<InlineGrid columns={2} gap="400">
```

Add `InlineGrid` to the Polaris import on analytics/page.tsx.

**KPI box grid** — the 4-column grid from Fix 2 should also be `<InlineGrid>`:
```tsx
<InlineGrid columns={4} gap="300">
  <KpiBox ... />
  <KpiBox ... />
  <KpiBox ... />
  <KpiBox ... />
</InlineGrid>
```

Note: `<InlineGrid>` doesn't have `alignItems: stretch` by default. If cards still end up different heights, add a wrapping div:
```tsx
<div style={{ display: 'contents' }}>
  <InlineGrid columns={4} gap="300">
    ...
  </InlineGrid>
</div>
```
Or keep the CSS grid for KPI boxes if InlineGrid doesn't support equal heights. The important thing is metric card grids use `<InlineGrid columns={2}>`.

**Vertical stacking** — replace `display: flex, flexDirection: column, gap: 16` with:
```tsx
<BlockStack gap="400">
```

This applies to the outer wrapper in sessions/page.tsx and coupons/page.tsx.

VERIFY:
```bash
grep -c "InlineGrid" app/\(embedded\)/couponmaxx/analytics/page.tsx
# Must output: >= 2 (one per metric card row)

grep -c "gridTemplateColumns.*1fr 1fr" app/\(embedded\)/couponmaxx/analytics/page.tsx
# Must output: 0
```

---

## FIX 6: Charts — right chart types for the data

**Problem**: The coupons page "Code velocity" line chart is hard to read with 5+ overlapping lines. The "Success rate by code" horizontal bar chart works but the labels are truncated.

**Code velocity**: Switch from `<LineChart>` to stacked `<BarChart>` when there are more than 3 codes. Stacked bars show volume per code per day more clearly than overlapping lines.

In `coupons/page.tsx`, where the velocity chart is rendered, add a condition:

```tsx
const useStackedBar = data.velocityChart.codes.length > 3;
```

Then render either a stacked BarChart or the existing LineChart based on this flag. For the stacked bar:

```tsx
{useStackedBar ? (
  <BarChart data={data.velocityChart.daily} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={fmtDate} />
    <YAxis tick={{ fontSize: 10 }} />
    <Tooltip />
    <Legend />
    {data.velocityChart.codes.map((code, i) => (
      <Bar key={code} dataKey={code} stackId="a"
        fill={LINE_COLORS[i % LINE_COLORS.length]}
        hide={hiddenLines.has(code)}
      />
    ))}
  </BarChart>
) : (
  // existing LineChart
)}
```

**Success rate bar chart** — increase the Y axis width so code names don't truncate:
```tsx
<YAxis type="category" dataKey="code" tick={{ fontSize: 10, fontFamily: 'monospace' }} width={120} />
```
Change from `width={80}` to `width={120}`.

VERIFY:
```bash
grep -c "stackId" app/\(embedded\)/couponmaxx/coupons/page.tsx
# Must output: >= 1

grep "width={120}" app/\(embedded\)/couponmaxx/coupons/page.tsx | head -1
# Should show the YAxis width
```

---

## FIX 7: Replace custom refresh button with Polaris `<Button>`

**Problem**: Sessions page has a custom `<button>` with inline styles for the refresh action — round, white, custom border. Not Polaris.

In `sessions/page.tsx`, replace:
```tsx
// BEFORE: ~15 lines of custom button
<button onClick={handleRefresh} disabled={refreshing} title="Refresh" style={{ width: 32, height: 32, ... }}>
  <div style={{ animation: refreshing ? ... }}>
    <Icon source={RefreshIcon} tone="subdued" />
  </div>
</button>

// AFTER:
<Button icon={RefreshIcon} onClick={handleRefresh} loading={refreshing} accessibilityLabel="Refresh" variant="tertiary" />
```

The `loading` prop on Polaris `<Button>` shows a spinner automatically. No custom animation needed.

VERIFY:
```bash
grep -c 'width.*32.*height.*32' app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: 0

grep -c "loading={refreshing}" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: 1
```

---

## FIX 8: "Carts Opened" KPI box — remove it from Sessions page

**Problem**: In screenshot 2, you can see 4 KPI boxes but the first one ("Carts Opened") is partially hidden behind the date picker dropdown. More importantly, "Carts Opened" includes empty carts which aren't useful. With Fix 3 defaulting to "With Products" filter, showing "Carts Opened" as a KPI box that unfilters to noise is counterproductive.

**Fix**: Remove the "Carts Opened" box. Keep 3 boxes: "With Products", "Coupon Attempted", "Reached Checkout". Change the grid to 3 columns.

In `sessions/page.tsx`:
1. Delete the "Carts Opened" KpiBox
2. Change `handleBoxClick('')` logic — the "show all" option can be triggered by clicking the active box again (already works via the toggle: `setBoxFilter(prev => prev === filter ? '' : filter)`)
3. Change grid to `repeat(3, 1fr)`

Or if you want to keep "Carts Opened", change its filter to `'all_with_content'` and have the API exclude empty carts for that filter too.

VERIFY:
```bash
grep -c "Carts Opened" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: 0 (removed) or still present but not default
```

---

## FIX 9: Coupons page — "Abandoned After Coupon Failure" KPI wording

**Problem**: The sub-text says "100% of failed coupon sessions abandoned immediately" and "$110 in cart value left behind." This is good data but the KPI label "Abandoned After Coupon Failure" is too long — it wraps and makes the box taller than others.

**Fix**: Shorten label to "Abandoned After Failure". The context (coupons page) makes it obvious this is about coupon failures.

In `coupons/page.tsx`:
```tsx
label="Abandoned After Failure"
```

VERIFY:
```bash
grep "Abandoned After" app/\(embedded\)/couponmaxx/coupons/page.tsx
# Should show "Abandoned After Failure" not "Abandoned After Coupon Failure"
```

---

## FIX 10: App name in Shopify nav — update Partner Dashboard

**Problem**: Nav bar shows "checkoutmaxx" (screenshot). The toml was updated to `name = "couponmaxx"` but the Shopify admin displays the app name from the Partner Dashboard, not from the toml. The toml `name` is the internal config identifier.

**Fix**: This is NOT a code fix. Go to:
1. Partner Dashboard → Apps → select your app
2. App setup → App name
3. Change to "CouponMaxx"
4. Save

The Shopify admin nav will update on next page load.

---

## EXECUTION ORDER

1. **Fix 1** (DateRangePicker) — most visible UX issue
2. **Fix 2** (KpiBox equal height) — second most visible
3. **Fix 3** (Default to products filter) — data quality
4. **Fix 4** ($0 AOV display) — data quality
5. **Fix 5** (InlineGrid layouts) — Polaris compliance
6. **Fix 7** (Refresh button) — quick Polaris fix
7. **Fix 9** (Label shortening) — quick fix
8. **Fix 6** (Chart improvements) — visual polish
9. **Fix 8** (Remove Carts Opened) — optional, discuss
10. **Fix 10** (Partner Dashboard name) — manual, do yourself
