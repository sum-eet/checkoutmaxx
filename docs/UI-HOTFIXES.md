# UI Hotfixes — 4 Issues

## DO NOT redeploy couponmaxx. Push to main only. Test on Dr.Water.

---

## Fix 1: Loading bar — single progress bar, not zooming pieces

The current implementation uses a looping CSS animation with a 30%-width bar sliding across repeatedly. It looks like random blue pieces flying around.

**What it should be:** A thin bar at the top that fills from left to right once, then disappears when loading completes. Like YouTube's red bar or Alia's blue bar.

**File:** `components/couponmaxx/LoadingBar.tsx` (or wherever it was created)

**Replace the entire component with:**

```tsx
'use client';

export function LoadingBar({ loading }: { loading: boolean }) {
  if (!loading) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      zIndex: 200,
      background: 'var(--p-color-bg-surface-secondary)',
    }}>
      <div style={{
        height: '100%',
        background: 'var(--p-color-bg-fill-info)',
        animation: 'loadOnce 1.5s ease-out forwards',
      }} />
      <style>{`
        @keyframes loadOnce {
          0% { width: 0%; }
          20% { width: 30%; }
          50% { width: 60%; }
          80% { width: 85%; }
          100% { width: 95%; }
        }
      `}</style>
    </div>
  );
}
```

Key differences from the broken version:
- `animation: loadOnce 1.5s ease-out forwards` — runs ONCE (not `infinite`), stays at 95% until loading finishes
- `forwards` keeps it at 95% instead of resetting
- When `loading` becomes false, the component unmounts entirely (the bar disappears)
- No `translateX`, no `width: 30%` sliding. Just a single bar growing from 0% to 95%.

---

## Fix 2: KPI boxes — all same height

The boxes have different heights because the subtitle text wraps differently in each box. One box has 2 lines of subtitle, another has 1.

**File:** `app/(embedded)/couponmaxx/sessions/page.tsx` (and `analytics/page.tsx`, `coupons/page.tsx`)

Find where KpiBox components are rendered inside an `<InlineGrid>`. The InlineGrid needs equal-height columns.

**Option A — CSS fix on the InlineGrid wrapper:**

Find the `<InlineGrid>` that wraps the KPI boxes. It probably looks like:
```tsx
<InlineGrid columns={4} gap="400">
  <KpiBox ... />
  <KpiBox ... />
  <KpiBox ... />
  <KpiBox ... />
</InlineGrid>
```

Wrap it in a div with CSS grid that forces equal height:
```tsx
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
  <KpiBox ... />
  <KpiBox ... />
  <KpiBox ... />
  <KpiBox ... />
</div>
```

**Option B — fix KpiBox component itself:**

**File:** `components/couponmaxx/KpiBox.tsx`

Add a fixed minimum height so all boxes are the same regardless of content:

Find the outer `<div>` style and add `minHeight`:

```tsx
style={{
  cursor: onClick ? 'pointer' : undefined,
  borderRadius: 'var(--p-border-radius-300)',
  outline: active ? '2px solid var(--p-color-border-interactive)' : '2px solid transparent',
  background: active ? 'var(--p-color-bg-surface-selected)' : undefined,
  outlineOffset: -1,
  height: '100%',        // <-- this already exists, keeps it stretching to grid height
  minHeight: 110,        // <-- ADD THIS: ensures consistent box height
}}
```

The `height: '100%'` already exists. The issue is likely that the parent `<InlineGrid>` from Polaris doesn't force equal row heights. Using a raw CSS grid (`display: grid` with `gridTemplateColumns`) instead of Polaris `<InlineGrid>` will fix this because CSS grid rows are equal height by default.

**Do BOTH fixes:** Replace `<InlineGrid columns={4}>` with raw CSS grid AND add `minHeight: 110` to KpiBox. Apply to ALL pages that use KpiBox (sessions, analytics, coupons).

---

## Fix 3: Coupons page horizontal bar chart — limit to top 8 codes

The chart shows ALL codes including ones with 0 attempts. It becomes a massive scrolling list.

**File:** `app/(embedded)/couponmaxx/coupons/page.tsx`

Find where the success rate bar chart data is prepared. It will be something like mapping over all codes to create chart data. Add a filter + slice:

```tsx
// FIND something like:
const successRateChartData = codes.map(c => ({ ... }));

// REPLACE with:
const successRateChartData = codes
  .filter(c => c.attempts > 0)           // remove codes with 0 attempts
  .sort((a, b) => b.attempts - a.attempts) // sort by most attempts first
  .slice(0, 8)                            // only top 8
  .map(c => ({ ... }));
```

Also set a FIXED chart height instead of dynamic:
```tsx
<ResponsiveContainer width="100%" height={280}>
```

Not `height={Math.max(300, codes.length * 35)}` which grows infinitely. Fixed at 280px for top 8 codes.

---

## Fix 4: Date picker — make it compact

The dual-month calendar is too wide. The Polaris `<DatePicker>` with `multiMonth` renders two full calendars side by side which is huge inside a popover.

**File:** `components/couponmaxx/DateRangePicker.tsx`

**Change 1:** Remove `multiMonth` prop from DatePicker. Single month calendar is enough — the user can navigate months with arrows.

```tsx
// FIND:
<DatePicker
  month={month}
  year={year}
  ...
  multiMonth
/>

// REPLACE (remove multiMonth):
<DatePicker
  month={month}
  year={year}
  ...
/>
```

**Change 2:** Reduce the popover width:

```tsx
// FIND:
<div style={{ display: 'flex', minWidth: showCalendar ? 560 : 200 }}>

// REPLACE:
<div style={{ display: 'flex', minWidth: showCalendar ? 420 : 200 }}>
```

**Change 3:** Reduce calendar padding:

```tsx
// FIND:
<div style={{ padding: 16 }}>

// REPLACE:
<div style={{ padding: 12 }}>
```

This gives you: presets on the left (~160px) + single month calendar on the right (~260px) = ~420px total. Compact, clean, functional.

---

## VERIFY

After all 4 fixes:

```bash
npx next build 2>&1 | tail -5
# Must succeed

# Then check:
grep "loadOnce" components/couponmaxx/LoadingBar.tsx
# Should exist (single animation, not infinite)

grep "infinite" components/couponmaxx/LoadingBar.tsx
# Should NOT exist

grep "minHeight" components/couponmaxx/KpiBox.tsx
# Should exist

grep "slice(0, 8)" app/\(embedded\)/couponmaxx/coupons/page.tsx
# Should exist

grep "multiMonth" components/couponmaxx/DateRangePicker.tsx
# Should NOT exist
```

## COMMIT

```bash
git add -A
git commit -m "fix: loading bar single fill, equal KPI box height, chart top 8, compact date picker"
git push
```

Wait 2 min. Test on Dr.Water. All 4 issues should be resolved.
