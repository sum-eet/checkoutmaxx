# CouponMaxx — Polaris Migration (Atomic Tasks)

## WHY THIS FILE EXISTS
The Polaris migration has been requested twice and skipped both times. The pattern: Claude Code does the easy string replacements, claims done, leaves all the actual UI refactoring untouched.

## HOW TO USE THIS FILE
Do tasks IN ORDER. Do NOT skip ahead. After each task, run its VERIFY command. If it fails, fix it before moving to the next task. Paste each verification output into CHANGELOG.md.

## RULE: Do NOT do Task N+1 until Task N's verification passes.

---

# TASK 1: Delete Header.tsx and remove from layout

Delete `components/couponmaxx/Header.tsx`. Remove the import and `<Header />` from `app/(embedded)/couponmaxx/layout.tsx`.

VERIFY:
```bash
ls components/couponmaxx/Header.tsx 2>&1 | grep -c "No such file"
# Must output: 1

grep -c "Header" app/\(embedded\)/couponmaxx/layout.tsx
# Must output: 0
```

STOP. Run verify. Paste output. Then move to Task 2.

---

# TASK 2: Delete FilterPill.tsx

Delete `components/couponmaxx/FilterPill.tsx`. Confirm no file imports it.

VERIFY:
```bash
ls components/couponmaxx/FilterPill.tsx 2>&1 | grep -c "No such file"
# Must output: 1

grep -rn "FilterPill" app/ components/ | wc -l
# Must output: 0
```

STOP. Run verify. Paste output. Then move to Task 3.

---

# TASK 3: Fix lowData threshold

In `app/api/couponmaxx/coupons/route.ts`, find `lowData: s.attempts.size < 5` and change `5` to `15`.

VERIFY:
```bash
grep "lowData:" app/api/couponmaxx/coupons/route.ts
# Must contain: < 15
```

STOP. Run verify. Paste output. Then move to Task 4.

---

# TASK 4: Remove coupons page double padding

In `app/(embedded)/couponmaxx/coupons/page.tsx`, find the outermost wrapper div that sets `background: '#F1F1F1', minHeight: '100vh', padding: 24`. Remove those styles — the layout already provides them.

VERIFY:
```bash
grep -c "minHeight.*100vh" app/\(embedded\)/couponmaxx/coupons/page.tsx
# Must output: 0
```

STOP. Run verify. Paste output. Then move to Task 5.

---

# TASK 5: Replace MetricCard internals with Polaris Card + Text

File: `components/couponmaxx/MetricCard.tsx`

Replace the outer div that has `background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8` with Polaris `<Card>`.

Replace the title text with `<Text variant="bodyMd" fontWeight="semibold">`.
Replace the definition text with `<Text variant="bodySm" tone="subdued">`.  
Replace the big number with `<Text variant="heading2xl" as="p">`.
Replace the loading placeholder with `<SkeletonDisplayText size="large">`.

Remove the custom TitleDropdown component entirely — replace with Polaris `<Select labelInline>` or `<Popover>` + `<ActionList>`.

Remove the "···" button (it does nothing).

Add imports:
```tsx
import { Card, Text, SkeletonDisplayText, Select } from '@shopify/polaris';
```

VERIFY:
```bash
grep -c "import.*Card.*from.*@shopify/polaris" components/couponmaxx/MetricCard.tsx
# Must output: 1

grep -c "background.*#FFFFFF.*border.*#E3E3E3" components/couponmaxx/MetricCard.tsx
# Must output: 0

grep -c "position.*absolute" components/couponmaxx/MetricCard.tsx
# Must output: 0
```

STOP. Run verify. Paste output. Then move to Task 6.

---

# TASK 6: Replace KpiBox with Polaris Card + Text

File: `components/couponmaxx/KpiBox.tsx`

Replace the outer div with `<Card>`. Use `<Text variant="headingXl" as="p">` for the big number. Use `<Text variant="bodySm" tone="subdued">` for sub-lines.

For the active/selected state (blue border), use a wrapper div with a conditional CSS class or inline `outline` style. Polaris `<Card>` doesn't have a "selected" prop, so a thin outline is acceptable.

```tsx
import { Card, Text, BlockStack } from '@shopify/polaris';
```

VERIFY:
```bash
grep -c "import.*Card.*from.*@shopify/polaris" components/couponmaxx/KpiBox.tsx
# Must output: 1

grep -c "background.*#FFFFFF\|border.*#E3E3E3" components/couponmaxx/KpiBox.tsx
# Must output: 0
```

STOP. Run verify. Paste output. Then move to Task 7.

---

# TASK 7: Wrap Analytics page in Polaris `<Page>` + replace cards

File: `app/(embedded)/couponmaxx/analytics/page.tsx`

1. Replace `<h1 style={{...}}>Analytics</h1>` with `<Page title="Analytics">` wrapping the entire page content.
2. Replace the funnel chart wrapper div (`background: '#FFFFFF'...`) with `<Card>`.
3. Add `<BlockStack gap="400">` for vertical spacing instead of `gap: 16`.

VERIFY:
```bash
grep -c "<Page " app/\(embedded\)/couponmaxx/analytics/page.tsx
# Must output: >= 1

grep -c "<h1" app/\(embedded\)/couponmaxx/analytics/page.tsx
# Must output: 0

grep -c "background.*#FFFFFF.*border.*#E3E3E3" app/\(embedded\)/couponmaxx/analytics/page.tsx
# Must output: 0
```

STOP. Run verify. Paste output. Then move to Task 8.

---

# TASK 8: Wrap Sessions page in `<Page>` + replace card divs

File: `app/(embedded)/couponmaxx/sessions/page.tsx`

1. Replace `<h1>Cart Sessions</h1>` with `<Page title="Cart Sessions">`.
2. Replace the filter bar card div (`background: '#FFFFFF'...padding: '12px 16px'`) with `<Card>`.
3. Replace the table wrapper card div with `<Card>`.

VERIFY:
```bash
grep -c "<Page " app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: >= 1

grep -c "<h1" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: 0

grep -c "background.*#FFFFFF.*border.*#E3E3E3" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: 0
```

STOP. Run verify. Paste output. Then move to Task 9.

---

# TASK 9: Replace Sessions table with Polaris `<IndexTable>`

This is the biggest single task. File: `app/(embedded)/couponmaxx/sessions/page.tsx`

Replace the raw `<table>` (around line 1003) with `<IndexTable>`.

Key mapping:
- `<thead>` headers → `<IndexTable headings={[...]}>`
- Each `<tr>` → `<IndexTable.Row>`
- Each `<td>` → `<IndexTable.Cell>`
- Remove all custom `thStyle`, `tdStyle`, `colgroup`
- Remove manual hover handlers (`onMouseEnter`/`onMouseLeave`)
- The "View →" button column becomes the row's onClick action

Replace the custom pagination buttons (← Prev / Next →) with Polaris `<Pagination>`:
```tsx
import { Pagination } from '@shopify/polaris';

<Pagination
  hasPrevious={page > 1}
  hasNext={page < totalPages}
  onPrevious={() => setPage(p => Math.max(1, p - 1))}
  onNext={() => setPage(p => Math.min(totalPages, p + 1))}
/>
```

Replace the custom SVG icons (DesktopIcon, MobileIcon, TabletIcon, RefreshIcon, CloseIcon) with imports from `@shopify/polaris-icons`:
```tsx
import { DesktopIcon, MobileIcon, TabletIcon, RefreshIcon, XSmallIcon } from '@shopify/polaris-icons';
import { Icon } from '@shopify/polaris';
// Usage: <Icon source={DesktopIcon} />
```

Note: If `DesktopIcon` / `MobileIcon` / `TabletIcon` don't exist in polaris-icons, use `Icon source` with a generic device icon, or keep small custom SVGs but remove the function declarations and inline them.

VERIFY:
```bash
grep -c "<table" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: 0

grep -c "IndexTable" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: >= 3 (import + component + Row/Cell usage)

grep -c "Pagination" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: >= 2

grep -c "function DesktopIcon\|function MobileIcon\|function TabletIcon\|function RefreshIcon\|function CloseIcon" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must output: 0
```

STOP. Run verify. Paste output. Then move to Task 10.

---

# TASK 10: Wrap Coupons page in `<Page>` + replace card divs

File: `app/(embedded)/couponmaxx/coupons/page.tsx`

1. Replace `<h1>Coupons</h1>` with `<Page title="Coupons">`.
2. Replace all card-style wrapper divs with `<Card>` (the velocity chart card, success rate chart card, code table card, zombie codes section).

VERIFY:
```bash
grep -c "<Page " app/\(embedded\)/couponmaxx/coupons/page.tsx
# Must output: >= 1

grep -c "<h1" app/\(embedded\)/couponmaxx/coupons/page.tsx
# Must output: 0
```

STOP. Run verify. Paste output. Then move to Task 11.

---

# TASK 11: Replace Coupons main code table with `<IndexTable>`

File: `app/(embedded)/couponmaxx/coupons/page.tsx`

The main code table (around line 834) that shows Code / Attempts / Success Rate / etc. Replace with `<IndexTable>`. Make rows clickable (they already open the detail panel on click).

The 3 smaller tables INSIDE the Modal (product breakdown, recent sessions, zombie codes) can stay as raw `<table>` — they're inside a modal and too small to warrant IndexTable. BUT wrap them in `<Card>` for consistent styling.

Replace the custom sort buttons (Attempts / Success rate / Avg cart / Last seen) with `<IndexTable>` sortable column headers if possible, or keep as `<ButtonGroup segmented>`:
```tsx
import { ButtonGroup, Button } from '@shopify/polaris';

<ButtonGroup segmented>
  <Button pressed={sortBy === 'attempts'} onClick={() => setSortBy('attempts')}>Attempts</Button>
  <Button pressed={sortBy === 'successRate'} onClick={() => setSortBy('successRate')}>Success rate</Button>
  ...
</ButtonGroup>
```

Replace status filter pills with `<Tabs>`:
```tsx
import { Tabs } from '@shopify/polaris';

const statusTabs = [
  { id: 'all', content: 'All' },
  { id: 'healthy', content: 'Healthy' },
  { id: 'degraded', content: 'Degraded' },
  { id: 'broken', content: 'Broken' },
  { id: 'low_data', content: 'Low data' },
];
```

VERIFY:
```bash
# Main table should be IndexTable
grep -c "IndexTable" app/\(embedded\)/couponmaxx/coupons/page.tsx
# Must output: >= 3

# The small modal tables are acceptable — count total raw tables
grep -c "<table" app/\(embedded\)/couponmaxx/coupons/page.tsx
# Must output: <= 3 (product breakdown, recent sessions, zombie — all inside Modal)
```

STOP. Run verify. Paste output. Then move to Task 12.

---

# TASK 12: Wrap Notifications page in `<Page>` + replace card divs

File: `app/(embedded)/couponmaxx/notifications/page.tsx`

1. Replace `<h1>` with `<Page title="Notifications">`.
2. Replace the 5 custom card divs (alert list container, settings sections) with `<Card>`.
3. The alert rows use custom inline styles — keep them for now but ensure they're inside a `<Card>`.

VERIFY:
```bash
grep -c "<Page " app/\(embedded\)/couponmaxx/notifications/page.tsx
# Must output: >= 1

grep -c "<h1" app/\(embedded\)/couponmaxx/notifications/page.tsx
# Must output: 0

grep -c "background.*#FFFFFF.*border.*#E3E3E3" app/\(embedded\)/couponmaxx/notifications/page.tsx
# Must output: 0
```

STOP. Run verify. Paste output. Then move to Task 13.

---

# TASK 13: Replace OnboardingBanner custom styles with Polaris

File: `components/couponmaxx/OnboardingBanner.tsx`

Currently uses fully custom inline styles. Replace with Polaris:
- Outer container → `<Card>` with `<Banner tone="info">` or just `<Card>`
- Step cards → `<Card>` inside `<InlineGrid columns={3}>`
- Text → `<Text>` variants
- Dismiss → `<Button variant="plain" onClick={onDismiss}>Dismiss</Button>` in the card header
- Number badges → `<Badge>` or keep inline

VERIFY:
```bash
grep -c "import.*Card.*from.*@shopify/polaris" components/couponmaxx/OnboardingBanner.tsx
# Must output: 1
```

STOP. Run verify. Paste output. Then move to Task 14.

---

# TASK 14: Replace Toggle.tsx with Polaris Checkbox

File: `components/couponmaxx/Toggle.tsx`

Replace the custom toggle (button with sliding circle) with Polaris `<Checkbox>`:

```tsx
import { Checkbox } from '@shopify/polaris';

export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <Checkbox
      label={label ?? ''}
      labelHidden={!label}
      checked={checked}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
```

Update the notifications page where Toggle is used — each toggle row needs a `label` prop passed through.

VERIFY:
```bash
grep -c "Checkbox" components/couponmaxx/Toggle.tsx
# Must output: >= 1

grep -c "keyframes\|animation\|border-radius.*50%" components/couponmaxx/Toggle.tsx
# Must output: 0 (no custom animation)
```

STOP. Run verify. Paste output. Then move to Task 15.

---

# TASK 15: Final verification + build

Run the complete suite:

```bash
echo "=== FINAL VERIFICATION ==="

echo "1. Custom card divs:" && grep -rn "background.*#FFFFFF.*border.*#E3E3E3" app/\(embedded\)/couponmaxx/ components/couponmaxx/ 2>/dev/null | wc -l && echo "(Expected: 0)"

echo "2. Raw tables in sessions:" && grep -c "<table" app/\(embedded\)/couponmaxx/sessions/page.tsx && echo "(Expected: 0)"

echo "3. Raw tables in coupons:" && grep -c "<table" app/\(embedded\)/couponmaxx/coupons/page.tsx && echo "(Expected: <= 3, only inside Modal)"

echo "4. Custom h1:" && grep -rn "<h1" app/\(embedded\)/couponmaxx/ 2>/dev/null | wc -l && echo "(Expected: 0)"

echo "5. Header.tsx:" && ls components/couponmaxx/Header.tsx 2>&1 && echo "(Expected: No such file)"

echo "6. FilterPill.tsx:" && ls components/couponmaxx/FilterPill.tsx 2>&1 && echo "(Expected: No such file)"

echo "7. IndexTable:" && grep -rl "IndexTable" app/\(embedded\)/couponmaxx/ 2>/dev/null && echo "(Expected: sessions + coupons)"

echo "8. Modal:" && grep -rl "Modal" app/\(embedded\)/couponmaxx/ 2>/dev/null && echo "(Expected: sessions + coupons)"

echo "9. Page component:" && grep -rl "<Page " app/\(embedded\)/couponmaxx/ 2>/dev/null && echo "(Expected: all 4 pages)"

echo "10. lowData:" && grep "lowData:" app/api/couponmaxx/coupons/route.ts && echo "(Expected: < 15)"

echo "11. Build:" && npx next build 2>&1 | tail -5

echo "=== END ==="
```

**If ANY check fails, go back and fix it. Do NOT commit with failures.**

Paste the ENTIRE output into CHANGELOG.md under:
```
## [DATE]: Polaris Migration — Final Verification
```
