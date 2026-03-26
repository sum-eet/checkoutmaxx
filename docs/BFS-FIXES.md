# CouponMaxx — Built for Shopify Fixes

These fixes are required to pass Shopify's Built for Shopify review. Each one maps to a specific BFS rejection criterion. Do NOT skip any.

Reference: https://shopify.dev/docs/apps/launch/built-for-shopify/requirements

---

## BFS-1. Contextual Save Bar on Notification Settings

**BFS Requirement**: 4.1.5 — "Form inputs should generally be saved using the App Bridge Contextual Save Bar (CSB)."  
**Rejection reason**: "A form does not integrate with the CSB when it would be reasonable to do so."

**Current state**: `app/(embedded)/couponmaxx/notifications/page.tsx` SettingsTab has 3 separate save buttons: `saveTriggers`, `saveChannels`, `saveDigest`. Each is a custom styled `<button>`. No CSB.

**Fix**: Remove ALL 3 save buttons. Replace with a single Contextual Save Bar that appears when ANY setting changes.

**How App Bridge CSB works in App Bridge 4.x + React**:

The CSB is exposed via the `useAppBridge` hook or via the `<SaveBar>` web component. Since the app uses `@shopify/app-bridge-react` v4, use the `<SaveBar>` approach:

```tsx
// In the SettingsTab component:

import { useEffect, useRef } from 'react';

// Track whether settings have changed from the server state
const [isDirty, setIsDirty] = useState(false);
const serverSettings = useRef<Settings | null>(null);

// When API data loads, store the server state
useEffect(() => {
  if (data) {
    serverSettings.current = data.settings as Settings;
    setIsDirty(false);
  }
}, [data]);

// Whenever local settings change, compare to server state
useEffect(() => {
  if (!serverSettings.current) return;
  const changed = JSON.stringify(settings) !== JSON.stringify(serverSettings.current);
  setIsDirty(changed);
}, [settings]);

// Save handler — posts ALL settings in one call
const handleSave = async () => {
  try {
    const res = await fetch('/api/couponmaxx/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shop: shopDomain,
        settings,
        email: editingEmail ? emailDraft : email,
      }),
    });
    if (!res.ok) throw new Error('Failed');
    serverSettings.current = { ...settings };
    if (editingEmail) { setEmail(emailDraft); setEditingEmail(false); }
    setIsDirty(false);
    shopify.toast.show('Settings saved');
  } catch {
    shopify.toast.show('Failed to save settings', { isError: true });
  }
};

// Discard handler — resets to server state
const handleDiscard = () => {
  if (serverSettings.current) {
    setSettings(serverSettings.current);
  }
  setIsDirty(false);
};
```

Then in JSX, render the save bar using App Bridge's `<ui-save-bar>`:

```tsx
{isDirty && (
  <ui-save-bar id="settings-save-bar">
    <button variant="primary" onClick={handleSave}></button>
    <button onClick={handleDiscard}></button>
  </ui-save-bar>
)}
```

**Alternative** — if `<ui-save-bar>` is not available in the current App Bridge version, use the imperative API:

```tsx
useEffect(() => {
  if (isDirty) {
    shopify.saveBar.show('settings-save-bar', {
      onSave: handleSave,
      onDiscard: handleDiscard,
    });
  } else {
    shopify.saveBar.hide('settings-save-bar');
  }
}, [isDirty]);
```

Check the exact API for App Bridge 4.x at: https://shopify.dev/docs/api/app-bridge-library/apis/save-bar

**Delete**: Remove the `saveTriggers`, `saveChannels`, `saveDigest` functions and their 3 separate save buttons. Remove the `triggerSaved/triggerError`, `channelSaved/channelError`, `digestSaved/digestError` state pairs. One save, one discard — that's it.

---

## BFS-2. Onboarding Flow (In-UI, Dismissible Cards)

**BFS Requirement**: 4.2.2 — "Apps should have a concise onboarding experience that helps merchants establish the app's core functionality."  
**Rejection reasons**: "onboarding does not sufficiently guide merchants to completion", "After onboarding has been completed, there is no mechanism to remove UI related to onboarding."

**Current state**: No onboarding exists. The welcome page at `/welcome` is static and still says "CheckoutMaxx."

**Fix**: Build a dismissible onboarding banner/card group that appears on the analytics page (the app home) for new installs.

**Pattern**: Shopify's recommended pattern is dismissible setup cards on the homepage. Each card = one step. When all steps done, the whole section can be dismissed.

**Implementation**:

Create a new component `components/couponmaxx/OnboardingBanner.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Banner,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Icon,
  ProgressBar,
} from '@shopify/polaris';
import { CheckCircleIcon } from '@shopify/polaris-icons';

type OnboardingStep = {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  action?: { label: string; onAction: () => void };
};

type Props = {
  cartMonitorActive: boolean;
  checkoutPixelActive: boolean;
  hasReceivedData: boolean;
  onDismiss: () => void;
};

export function OnboardingBanner({
  cartMonitorActive,
  checkoutPixelActive,
  hasReceivedData,
  onDismiss,
}: Props) {
  const steps: OnboardingStep[] = [
    {
      id: 'cart-monitor',
      title: 'Cart monitor installed',
      description: cartMonitorActive
        ? 'Active on your storefront — tracking cart activity.'
        : 'Enable the cart monitor in your theme to start tracking.',
      completed: cartMonitorActive,
      action: !cartMonitorActive
        ? { label: 'Open theme editor', onAction: () => {
            // Deep link to theme editor
            // shopify.navigation.redirect('...')  or window.open
          }}
        : undefined,
    },
    {
      id: 'checkout-pixel',
      title: 'Checkout pixel active',
      description: checkoutPixelActive
        ? 'Monitoring checkout events.'
        : 'The checkout pixel should activate automatically after install.',
      completed: checkoutPixelActive,
    },
    {
      id: 'first-data',
      title: 'Receiving data',
      description: hasReceivedData
        ? 'Data is flowing in — your dashboard is populating.'
        : 'Waiting for your first customer session. This usually takes a few hours.',
      completed: hasReceivedData,
    },
  ];

  const completedCount = steps.filter(s => s.completed).length;
  const allDone = completedCount === steps.length;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h2">
              {allDone ? 'Setup complete' : 'Getting started'}
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              {completedCount} of {steps.length} steps completed
            </Text>
          </BlockStack>
          {allDone && (
            <Button variant="plain" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </InlineStack>

        <ProgressBar
          progress={(completedCount / steps.length) * 100}
          tone="primary"
          size="small"
        />

        {steps.map((step) => (
          <InlineStack key={step.id} gap="300" blockAlign="start">
            <div style={{ flexShrink: 0, marginTop: 2 }}>
              {step.completed ? (
                <Icon source={CheckCircleIcon} tone="success" />
              ) : (
                <div style={{
                  width: 20, height: 20, borderRadius: '50%',
                  border: '2px solid #8C9196',
                }} />
              )}
            </div>
            <BlockStack gap="100">
              <Text variant="bodyMd" fontWeight="semibold" as="span">
                {step.title}
              </Text>
              <Text variant="bodySm" tone="subdued" as="span">
                {step.description}
              </Text>
              {step.action && (
                <Button variant="plain" onClick={step.action.onAction}>
                  {step.action.label}
                </Button>
              )}
            </BlockStack>
          </InlineStack>
        ))}
      </BlockStack>
    </Card>
  );
}
```

**To check extension status**, use App Bridge's `app.extensions()` API. In the analytics page:

```tsx
// Check if theme extension is active
const [extensionStatus, setExtensionStatus] = useState({
  cartMonitor: false,
  checkoutPixel: false,
});

useEffect(() => {
  // App Bridge 4.x: check extension status
  async function checkExtensions() {
    try {
      // This API returns the status of all app extensions
      const extensions = await shopify.app.extensions();
      const cartExt = extensions.find(e => e.handle === 'cart-monitor');
      const pixelExt = extensions.find(e => e.handle === 'checkout-monitor');
      setExtensionStatus({
        cartMonitor: cartExt?.status === 'active',
        checkoutPixel: pixelExt?.status === 'active',
      });
    } catch {
      // Fallback: assume active if API not available
      setExtensionStatus({ cartMonitor: true, checkoutPixel: true });
    }
  }
  checkExtensions();
}, []);
```

**Dismissal persistence**: Store a `onboardingDismissed` flag. Options:
- `localStorage` (simplest, already used for `cm_shop`)
- Or a column on the Shop table in the DB (persists across devices)

LocalStorage is fine for BFS:

```tsx
const [showOnboarding, setShowOnboarding] = useState(() => {
  return localStorage.getItem('cm_onboarding_dismissed') !== 'true';
});

function handleDismissOnboarding() {
  localStorage.setItem('cm_onboarding_dismissed', 'true');
  setShowOnboarding(false);
}
```

Render at the top of the analytics page, before the metric cards:

```tsx
{showOnboarding && (
  <OnboardingBanner
    cartMonitorActive={extensionStatus.cartMonitor}
    checkoutPixelActive={extensionStatus.checkoutPixel}
    hasReceivedData={!!(data && (data.funnel.cartViews > 0))}
    onDismiss={handleDismissOnboarding}
  />
)}
```

---

## BFS-3. App Status Indicator (Replace Static "Live" Pill)

**BFS Requirement**: 4.2.3 — "Your homepage should clearly indicate if the app is set up and working."  
**Rejection reason**: "An app has an app block and/or app embed to be activated in a theme but fails to communicate the corresponding status(es) on the app's homepage using app.extensions()."

**Current state**: The `Header.tsx` component has a static green "Live" pill that always shows "Live" regardless of whether anything is actually working. This WILL get rejected — it's cosmetic, not functional. (The Header itself should already be removed per the Polaris migration, but the status check is still needed.)

**Fix**: Replace the static pill with a real status check. Put it on the analytics page (the homepage), not in a custom header.

If the onboarding banner from BFS-2 is visible, that already communicates status. For AFTER onboarding is dismissed, add a minimal status line:

```tsx
// At the top of the analytics page, after onboarding is dismissed:
{!showOnboarding && (
  <Banner
    tone={extensionStatus.cartMonitor && extensionStatus.checkoutPixel ? 'success' : 'warning'}
  >
    {extensionStatus.cartMonitor && extensionStatus.checkoutPixel
      ? 'CouponMaxx is active and monitoring your store.'
      : 'Some extensions are not active. Check your theme settings to enable cart monitoring.'
    }
  </Banner>
)}
```

This is a Polaris `<Banner>` with real status — not a decorative pill.

---

## BFS-4. Mobile-Friendly Tables and DateRangePicker

**BFS Requirement**: 4.1.2 — "Design your app to be responsive and adapt to different screen sizes and devices."  
**Rejection reason**: "On a mobile device, an entire page requires horizontal scrolling."

**Tables**: If the Polaris migration from PRIORITIZED-FIXES.md already replaced raw `<table>` elements with `<IndexTable>`, this is handled — `<IndexTable>` is responsive by default and truncates columns on mobile.

If tables are NOT yet migrated, this is a hard blocker. `<IndexTable>` is mandatory.

**DateRangePicker**: The 680×460px hardcoded popover is the other mobile failure point.

**Simplest mobile-safe approach**: Replace the custom popover with a Polaris `<Select>` for preset ranges + a Polaris `<Popover>` with `<DatePicker>` only for "Custom":

```tsx
'use client';

import { useState, useCallback } from 'react';
import { Select, Popover, DatePicker, Button, InlineStack, BlockStack } from '@shopify/polaris';

export type DateRange = { start: Date; end: Date };

const PRESETS = [
  { label: 'Today', value: '0' },
  { label: 'Yesterday', value: '1' },
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 14 days', value: '14' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'Custom range', value: 'custom' },
];

function startOfDay(d: Date) { return new Date(d.toISOString().slice(0, 10) + 'T00:00:00.000Z'); }
function endOfDay(d: Date) { return new Date(d.toISOString().slice(0, 10) + 'T23:59:59.999Z'); }
function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }

function getPresetRange(days: number): DateRange {
  const now = new Date();
  if (days === 0) return { start: startOfDay(now), end: endOfDay(now) };
  if (days === 1) { const y = subDays(now, 1); return { start: startOfDay(y), end: endOfDay(y) }; }
  return { start: startOfDay(subDays(now, days)), end: endOfDay(now) };
}

type Props = {
  value: DateRange;
  onChange: (range: DateRange) => void;
};

export function DateRangePicker({ value, onChange }: Props) {
  const [selected, setSelected] = useState('7');
  const [popoverActive, setPopoverActive] = useState(false);
  const [{ month, year }, setDate] = useState({
    month: value.start.getMonth(),
    year: value.start.getFullYear(),
  });
  const [pendingRange, setPendingRange] = useState<DateRange>(value);

  const handlePresetChange = useCallback((val: string) => {
    setSelected(val);
    if (val === 'custom') {
      setPopoverActive(true);
      return;
    }
    onChange(getPresetRange(Number(val)));
  }, [onChange]);

  const handleDatePickerChange = useCallback(({ start, end }: { start: Date; end: Date }) => {
    setPendingRange({ start: startOfDay(start), end: endOfDay(end) });
  }, []);

  const handleApply = useCallback(() => {
    onChange(pendingRange);
    setPopoverActive(false);
  }, [onChange, pendingRange]);

  return (
    <InlineStack gap="200" blockAlign="center">
      <Select
        label="Date range"
        labelInline
        options={PRESETS}
        value={selected}
        onChange={handlePresetChange}
      />
      <Popover
        active={popoverActive}
        onClose={() => setPopoverActive(false)}
        activator={
          <div style={{ display: popoverActive ? 'block' : 'none' }} />
        }
        preferredAlignment="right"
      >
        <Popover.Section>
          <BlockStack gap="300">
            <DatePicker
              month={month}
              year={year}
              onChange={handleDatePickerChange}
              onMonthChange={(m, y) => setDate({ month: m, year: y })}
              selected={{ start: pendingRange.start, end: pendingRange.end }}
              allowRange
            />
            <InlineStack gap="200" align="end">
              <Button onClick={() => setPopoverActive(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleApply}>Apply</Button>
            </InlineStack>
          </BlockStack>
        </Popover.Section>
      </Popover>
    </InlineStack>
  );
}
```

This is fully responsive — `<Select>` works on any screen size, and the `<DatePicker>` popover uses Polaris sizing (no hardcoded dimensions).

---

## BFS-5. Replace Slide-Over Panels with Polaris `<Modal>`

**BFS Requirement**: 4.1.6 — Modals must use App Bridge modal components.  
**Rejection reason**: Overlays that look like modals but don't use App Bridge components.

**Current state**: `CodeDetailPanel` in coupons/page.tsx and `TimelinePanel` in sessions/page.tsx are custom `position: fixed` drawers with custom overlays.

**Fix**: Replace both with Polaris `<Modal>`. The content structure stays the same — just wrap in Modal.

```tsx
import { Modal } from '@shopify/polaris';

// Instead of the custom panel:
<Modal
  open={!!selectedCode}
  onClose={() => setSelectedCode(null)}
  title={selectedCode ?? ''}
  large
>
  <Modal.Section>
    {/* Existing panel content goes here */}
    {/* Velocity trend chart, stats grid, product breakdown, etc. */}
  </Modal.Section>
</Modal>
```

Same pattern for TimelinePanel:

```tsx
<Modal
  open={!!panelSession}
  onClose={() => setPanelSession(null)}
  title={`Session ${panelSession?.sessionId?.slice(0, 8) ?? ''}`}
  large
>
  <Modal.Section>
    {/* Session summary, products, timeline */}
  </Modal.Section>
</Modal>
```

Delete the custom overlay divs (`position: fixed, inset: 0, background: rgba(0,0,0,0.35)`) and the custom panel containers from both files.

---

## BFS-6. Design Audit Checklist

**BFS Requirement**: 4.1.1 — UI must mimic Shopify admin look and feel.

If the Polaris migration from PRIORITIZED-FIXES.md was executed, most of this should pass. But BFS reviewers check specific things. Verify each:

- [ ] **Primary buttons are Polaris blue** (not #0EA5E9 cyan, not green, not purple). Polaris primary button color comes from the component — don't override it.
- [ ] **All content sits inside `<Card>` components** — no floating divs with custom borders.
- [ ] **Text uses `<Text>` component** — no raw `<h1 style={{...}}>` or `<p style={{...}}>`.
- [ ] **Background color matches Shopify admin** — the layout already sets `#F1F1F1` which is close. After migrating to `<Page>`, Polaris handles the background automatically.
- [ ] **Spacing matches admin** — use `<BlockStack gap="400">` not `gap: 16px`. Use `<InlineGrid>` not `display: grid`.
- [ ] **No custom scrollbar styles, no custom selection colors, no exotic fonts.**
- [ ] **All icons from `@shopify/polaris-icons`** — no inline SVG icon components.
- [ ] **Loading states use `<SkeletonBodyText>` / `<SkeletonDisplayText>`** — not a centered `<Spinner>` with no layout structure.
- [ ] **Error messages are red** (they already are via `<Banner tone="critical">` ✅).
- [ ] **The app name in `shopify.app.toml` is `couponmaxx`** (currently says `checkoutmaxx`).

---

## BFS-7. Update App Identity

**File**: `shopify.app.toml`

```diff
- name = "checkoutmaxx"
+ name = "couponmaxx"
```

Also update:
- `app/(embedded)/welcome/page.tsx` — change "Welcome to CheckoutMaxx" → "Welcome to CouponMaxx" and update feature cards + button links
- Delete or redirect old routes (`/dashboard/*`, `/alerts`, `/settings`) if they're still accessible
- The cart-monitor liquid block comment says "CheckoutMaxx Cart Monitor" — update to "CouponMaxx"

---

## EXECUTION ORDER

1. **BFS-1** (Contextual Save Bar) — isolated change, quick win
2. **BFS-5** (Modals replace panels) — isolated change
3. **BFS-4** (DateRangePicker mobile fix) — isolated component swap
4. **BFS-2** (Onboarding) — new component, wire into analytics page
5. **BFS-3** (App status) — depends on BFS-2 extension status check
6. **BFS-6** (Design audit) — verification pass after Polaris migration
7. **BFS-7** (App identity) — string replacements
