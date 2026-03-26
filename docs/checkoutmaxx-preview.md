# CheckoutMaxx — Local Preview Build Prompt

> Paste this entire prompt into Claude Code from the repo root.
> Run after Vercel comes back. In the meantime, preview runs on localhost only.

---

## CURRENT STATE OF THE REPO (read this before touching anything)

The app is a Shopify embedded Next.js 14 App Router app. Here is what is already
built and working. DO NOT touch any of these:

```
app/api/pixel/ingest/          ← receives pixel events via sendBeacon
app/api/jobs/                  ← cron: evaluate-alerts, compute-baselines
app/api/webhooks/              ← GDPR + app-uninstalled webhooks, HMAC verified
app/(embedded)/dashboard/      ← main funnel dashboard, SWR polling
app/(embedded)/alerts/         ← active alerts + history, resolve button
app/(embedded)/settings/       ← email, Slack, threshold sliders
app/privacy/                   ← privacy policy page
lib/alert-engine.ts            ← CVR drop, payment drop-off, discount error spike
lib/metrics.ts                 ← funnel + KPI queries
lib/notifications/             ← Resend email + Slack webhook
pixel/checkout-monitor.js      ← Web Pixel (sendBeacon only, no fetch)
prisma/schema.prisma           ← Shop, CheckoutEvent, AlertLog, Baseline models
```

**The Vercel deployment is temporarily paused (hit 100/day deploy limit). The app
is live at checkoutmaxx-rt55.vercel.app but no new deploys until the limit resets.
Do NOT push or deploy anything as part of this task. Local only.**

---

## WHAT YOU ARE BUILDING

A self-contained preview at `app/preview/page.tsx` that:

1. Serves as a local demo you can view right now at `localhost:3000/preview`
   without needing auth, a Shopify store, or any env vars
2. Doubles as an in-app walkthrough for new merchants (future use — see Step 7)

It uses Shopify Polaris exactly like the rest of the app.
All data comes from a sample data file — no DB calls, no API calls, no imports
from `lib/`, `prisma/`, or any server-side module.

---

## STEP 0: GITIGNORE FIRST

Before creating any files, append this to `.gitignore`:

```
# Preview / walkthrough — commit manually when ready
app/preview/
```

Confirm with `git status` that `app/preview/` does not appear as a tracked path.

---

## STEP 1: CREATE THE SAMPLE DATA FILE

Create `app/preview/_data/sample.ts`.

This file's shape must exactly mirror what `lib/metrics.ts` returns — same field
names, same nesting, same units. When the real app wires this up, every component
just swaps `SAMPLE.x` for `useSWR('/api/metrics/x')`.

```typescript
// app/preview/_data/sample.ts
// Realistic numbers for a store doing ~$150k/month GMV, ~1,800 checkouts/month

export const SAMPLE = {

  // ── Converted Carts ──────────────────────────────────────────────────
  converted: {
    checkoutsStarted: 1847,
    checkoutsStartedDelta: +12.4,    // % vs previous equivalent period
    completedOrders: 934,
    completedOrdersDelta: +8.1,
    cvr: 50.6,                       // % checkout completion rate
    cvrDelta: +2.1,                  // in percentage points vs baseline
    aov: 67.40,                      // avg order value USD
    aovDelta: +5.2,
    avgTimeMinutes: 4.2,
    avgTimeDelta: -0.3,              // negative = faster = good
  },

  // 7 daily data points, most recent last
  sparklines: {
    checkoutsStarted: [158, 171, 163, 180, 175, 192, 208],
    completedOrders:  [78, 84, 81, 89, 88, 97, 106],
    cvr:              [49.4, 49.1, 49.7, 49.4, 50.3, 50.5, 50.6],
    aov:              [63.2, 64.1, 65.8, 66.2, 67.1, 67.0, 67.4],
    avgTime:          [4.8, 4.6, 4.5, 4.3, 4.4, 4.2, 4.2],
    abandoned:        [95, 87, 82, 91, 88, 80, 82],
    abandonRate:      [51.2, 50.4, 50.1, 50.6, 50.0, 49.6, 49.4],
  },

  // alert: true = day an abandonment alert fired (shown as red dot on chart)
  cvrOverTime: [
    { date: "Feb 26", cvr: 51.2, baseline: 49.8 },
    { date: "Feb 27", cvr: 52.1, baseline: 49.8 },
    { date: "Feb 28", cvr: 48.3, baseline: 49.8, alert: true },
    { date: "Mar 1",  cvr: 47.1, baseline: 49.8, alert: true },
    { date: "Mar 2",  cvr: 50.4, baseline: 49.8 },
    { date: "Mar 3",  cvr: 53.0, baseline: 49.8 },
    { date: "Mar 4",  cvr: 51.8, baseline: 49.8 },
    { date: "Mar 5",  cvr: 49.2, baseline: 49.8 },
    { date: "Mar 6",  cvr: 50.7, baseline: 49.8 },
    { date: "Mar 7",  cvr: 51.3, baseline: 49.8 },
    { date: "Mar 8",  cvr: 52.6, baseline: 49.8 },
    { date: "Mar 9",  cvr: 50.1, baseline: 49.8 },
    { date: "Mar 10", cvr: 51.9, baseline: 49.8 },
    { date: "Mar 11", cvr: 50.6, baseline: 49.8 },
  ],

  topProducts: [
    { product: "Mosquito Lamp Pro",           orders: 187, revenue: 14028 },
    { product: "Hoodie — Black / M",          orders: 142, revenue: 8520 },
    { product: "Running Shoes — Size 10",     orders: 98,  revenue: 8820 },
    { product: "Yoga Mat (6mm)",              orders: 86,  revenue: 4300 },
    { product: "Resistance Band Set",         orders: 71,  revenue: 2130 },
  ],

  deviceConversions: [
    { device: "Desktop", orders: 512, cvr: 63.2 },
    { device: "Mobile",  orders: 381, cvr: 41.8 },
    { device: "Tablet",  orders: 41,  cvr: 47.1 },
  ],

  countryConversions: [
    { country: "United States",  completed: 512, cvr: 54.2, aov: 64.20 },
    { country: "United Kingdom", completed: 187, cvr: 49.1, aov: 82.40 },
    { country: "Canada",         completed: 124, cvr: 43.8, aov: 71.10 },
    { country: "Australia",      completed: 89,  cvr: 38.2, aov: 91.30 },
    { country: "Germany",        completed: 22,  cvr: 36.4, aov: 78.60 },
  ],

  // ── Abandoned Carts ──────────────────────────────────────────────────
  abandoned: {
    abandonedSessions: 913,
    abandonedDelta: -3.2,
    abandonRate: 49.4,
    abandonRateDelta: -1.1,
    avgAbandonedCartValue: 58.20,
    avgAbandonedCartDelta: +2.4,
    totalAbandonedValue: 53136,
    totalAbandonedDelta: -3.2,
  },

  // highDrop: true = drop% is >20% above 7-day baseline for that step
  funnel: [
    { step: "Checkout Started",  sessions: 1847, dropPct: 0,    lostRevenue: 0 },
    { step: "Contact Info",      sessions: 1621, dropPct: 12.2, lostRevenue: 13169 },
    { step: "Shipping Address",  sessions: 1480, dropPct: 8.7,  lostRevenue: 8214 },
    { step: "Shipping Method",   sessions: 1312, dropPct: 11.4, lostRevenue: 9782 },
    { step: "Payment",           sessions: 1089, dropPct: 17.0, lostRevenue: 12994, highDrop: true },
    { step: "Order Completed",   sessions: 934,  dropPct: 14.2, lostRevenue: 8283 },
  ],

  abandonByStep: [
    { date: "Mar 5",  contact: 10.1, shipping: 13.2, payment: 17.8 },
    { date: "Mar 6",  contact: 11.2, shipping: 12.8, payment: 16.4 },
    { date: "Mar 7",  contact: 10.8, shipping: 11.9, payment: 18.2 },
    { date: "Mar 8",  contact: 12.4, shipping: 14.1, payment: 22.1 },
    { date: "Mar 9",  contact: 11.0, shipping: 12.4, payment: 17.9 },
    { date: "Mar 10", contact: 10.4, shipping: 11.8, payment: 16.8 },
    { date: "Mar 11", contact: 11.2, shipping: 12.2, payment: 17.0 },
  ],

  abandonedProducts: [
    { product: "Mosquito Lamp Pro",           carts: 78, lostRevenue: 5850 },
    { product: "Hoodie — Black / M",          carts: 61, lostRevenue: 3660 },
    { product: "Running Shoes — Size 10",     carts: 54, lostRevenue: 4860 },
    { product: "Yoga Mat (6mm)",              carts: 41, lostRevenue: 2050 },
    { product: "Resistance Band Set",         carts: 38, lostRevenue: 1140 },
  ],

  deviceAbandonment: [
    { device: "Mobile",  abandoned: 389, rate: 58.1, worstStep: "Payment" },
    { device: "Desktop", abandoned: 298, rate: 36.8, worstStep: "Shipping Method" },
    { device: "Tablet",  abandoned: 48,  rate: 52.9, worstStep: "Contact Info" },
  ],

  // status: "healthy" | "warning" | "critical"
  // failPct thresholds: <10 healthy, 10–40 warning, >40 critical
  promotions: [
    {
      code: "WELCOME10", attempts: 241, converted: 148, failed: 93,
      failPct: 38.6, estLost: 5394, status: "warning",
      failReason: "Discount code is not applicable to selected items",
      avgCartFailed: 58.0, avgCartConverted: 68.4, abandonStep: "Payment",
      shopifyEditUrl: "/admin/discounts/WELCOME10",
    },
    {
      code: "SUMMER20", attempts: 87, converted: 24, failed: 63,
      failPct: 72.4, estLost: 3654, status: "critical",
      failReason: "Minimum order amount not met",
      avgCartFailed: 48.2, avgCartConverted: 112.4, abandonStep: "Payment",
      shopifyEditUrl: "/admin/discounts/SUMMER20",
    },
    {
      code: "FREESHIP", attempts: 312, converted: 301, failed: 11,
      failPct: 3.5, estLost: 638, status: "healthy",
      failReason: "Not applicable to this shipping zone",
      avgCartFailed: 58.0, avgCartConverted: 62.1, abandonStep: "Shipping Method",
      shopifyEditUrl: "/admin/discounts/FREESHIP",
    },
    {
      code: "VIP15", attempts: 44, converted: 41, failed: 3,
      failPct: 6.8, estLost: 174, status: "healthy",
      failReason: "Code has expired",
      avgCartFailed: 58.0, avgCartConverted: 74.2, abandonStep: "Payment",
      shopifyEditUrl: "/admin/discounts/VIP15",
    },
  ],

  shippingMethods: [
    { method: "Standard (3–5 days)",     selected: 812, abandoned: 96,  rate: 11.8 },
    { method: "Free Shipping",           selected: 624, abandoned: 7,   rate: 1.1 },
    { method: "Express (1–2 days)",      selected: 287, abandoned: 67,  rate: 23.3 },
    { method: "International Priority",  selected: 74,  abandoned: 32,  rate: 43.2 },
  ],
  avgTimeOnShippingStepSeconds: 68,
  shippingStepAbandonRate: 12.8,
  addressesNoRates: [
    { date: "Mar 10", city: "Honolulu",  country: "US" },
    { date: "Mar 9",  city: "Hamilton",  country: "Bermuda" },
    { date: "Mar 8",  city: "San Juan",  country: "Puerto Rico" },
  ],

  countryAbandonment: [
    { country: "Germany",        abandoned: 38,  rate: 63.3 },
    { country: "Australia",      abandoned: 142, rate: 61.5 },
    { country: "Canada",         abandoned: 159, rate: 56.2 },
    { country: "United Kingdom", abandoned: 181, rate: 49.2 },
    { country: "United States",  abandoned: 444, rate: 46.4 },
  ],
  stateAbandonment: [
    { state: "Hawaii",     abandoned: 18,  rate: 72.0 },
    { state: "Alaska",     abandoned: 12,  rate: 66.7 },
    { state: "Florida",    abandoned: 84,  rate: 52.5 },
    { state: "New York",   abandoned: 71,  rate: 44.1 },
    { state: "California", abandoned: 148, rate: 40.2 },
  ],

  // ── Notifications ────────────────────────────────────────────────────
  notifications: {
    totalSent: 47,
    resolved: 41,
    avgResolutionMinutes: 23,
    estRevenueProtected: 12840,
  },

  // channels: ("email" | "slack" | "whatsapp")[]
  // status: "resolved" | "unresolved"
  alerts: [
    {
      id: 1,
      when: "Mar 11, 2:14pm",
      type: "Discount failing",
      detail: "SUMMER20 · 63 failures · 72% fail rate",
      channels: ["email", "slack"],
      status: "unresolved",
      roi: null,
      resolvedAt: null,
      message: "Your discount code SUMMER20 is failing for 72% of customers who attempt it. Most common reason: minimum order amount not met ($75 required, avg failing cart is $48). Customers are abandoning at the payment step after seeing the error.",
      deepLink: "/admin/discounts/SUMMER20",
    },
    {
      id: 2,
      when: "Mar 8, 7:02pm",
      type: "Abandonment spike",
      detail: "CVR dropped from 51% → 31% · 2hr window",
      channels: ["email", "slack"],
      status: "resolved",
      roi: 2840,
      resolvedAt: "Mar 8, 7:28pm",
      message: "Your checkout conversion rate dropped to 31% (normally 51%). Drop concentrated at: Payment step. Most affected: Mobile users (76% of failures). Estimated revenue at risk: ~$2,840 this hour. Probable cause: Payment gateway issue or broken checkout extension on mobile.",
      deepLink: "/admin/settings/payments",
    },
    {
      id: 3,
      when: "Mar 5, 9:11am",
      type: "Extension error",
      detail: "Bold Upsell · 8 sessions affected",
      channels: ["email"],
      status: "resolved",
      roi: 480,
      resolvedAt: "Mar 5, 9:44am",
      message: "A Shopify app extension is throwing errors during checkout. App: Bold Upsell. Error: 'Cannot read property of undefined'. 8 customers affected in the last hour.",
      deepLink: "/admin/apps",
    },
    {
      id: 4,
      when: "Feb 28, 3:44pm",
      type: "Payment failure spike",
      detail: "22% payment failure rate · Stripe",
      channels: ["email", "slack"],
      status: "resolved",
      roi: 4120,
      resolvedAt: "Feb 28, 4:01pm",
      message: "Payment failures spiked to 22% in the last 30 minutes (baseline: 3%). Gateway: Stripe. 11 of 50 attempts failed. Probable cause: Stripe gateway issue or card validation problem.",
      deepLink: "/admin/settings/payments",
    },
    {
      id: 5,
      when: "Feb 25, 11:20am",
      type: "Discount failing",
      detail: "WELCOME10 · 31 failures · 41% fail rate",
      channels: ["email"],
      status: "resolved",
      roi: 5400,
      resolvedAt: "Feb 25, 12:04pm",
      message: "Your discount code WELCOME10 is failing for 41% of customers who attempt it. Most common reason: code not applicable to selected items. 31 customers affected in the last hour.",
      deepLink: "/admin/discounts/WELCOME10",
    },
  ],

  // ── Settings / Impact ─────────────────────────────────────────────────
  impact: {
    daysProtecting: 47,
    checkoutsMonitored: 14203,
    issuesCaught: 47,
    revenueProtected: 12840,
    roiMultiplier: 5.6,
  },
} as const;
```

---

## STEP 2: FILE STRUCTURE

Create these files. Nothing else.

```
app/preview/
  page.tsx                        ← "use client" shell + nav, renders active page
  _data/
    sample.ts                     ← sample data (Step 1 above)
  _components/
    PreviewShell.tsx              ← sidebar nav + layout wrapper
    DateRangeSelector.tsx         ← preset buttons: 1h | 24h | 7d | 30d
    LivePill.tsx                  ← pulsing green dot + "Updated Xs ago"
    pages/
      ConvertedCartsPage.tsx
      AbandonedCartsPage.tsx
      NotificationsPage.tsx
      SettingsPage.tsx
```

No other files. No CSS modules. No separate style files.

---

## STEP 3: POLARIS RULES

**Every single UI element must be a Polaris component.**

```
import {
  Page, Layout, Card, BlockStack, InlineStack, Text, Badge,
  DataTable, IndexTable, Button, ButtonGroup, Banner, Divider,
  Box, InlineGrid, ProgressBar, Collapsible, Icon, Tooltip,
  TextField, RangeSlider, Tabs, EmptyState, Spinner,
  SkeletonBodyText, SkeletonDisplayText
} from '@shopify/polaris';
```

Do NOT use:
- Tailwind classes (`className="flex gap-4"`) — none
- Custom CSS frameworks — none
- shadcn — none
- Inline style overrides beyond what Polaris cannot express — keep minimal
- Any component library other than Polaris

**Charts: Recharts only** (already in package.json).
Use for: sparklines (AreaChart), CVR over time (LineChart), abandonment trend (LineChart).
Do not use Recharts for anything expressible as a Polaris ProgressBar or DataTable.

**The one Polaris gap: sparklines.**
Polaris has no sparkline component. Build these as a tiny Recharts AreaChart:
- height: 40px
- no axes, no grid, no tooltip
- gradient fill from stroke color to transparent
- strokeWidth: 1.5

---

## STEP 4: APP SHELL (app/preview/page.tsx)

```typescript
"use client";
import { useState, useEffect } from "react";
import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";
// ... import page components
```

**Important:** The preview runs outside Shopify App Bridge. Wrap everything in
`<AppProvider i18n={en}>` — this is the standalone Polaris provider for non-embedded
contexts. Do NOT use `@shopify/app-bridge-react` here.

**Walkthrough mode:**
Read `new URLSearchParams(window.location.search).get('walkthrough') === '1'`
in a useEffect. If true, show a full-width Banner at the very top (above everything):

```
<Banner tone="info">
  You're viewing a demo with sample data. This is what your dashboard looks like
  once your first checkouts come in.
</Banner>
```

This banner has no close button in walkthrough mode (it's always shown).
Normal preview (no `?walkthrough=1`) → no banner.

**Sidebar nav:**
Use Polaris `Navigation` component with `Navigation.Section`.
Four items: Converted Carts | Abandoned Carts | Notifications | Settings.
Show a Polaris `Badge tone="critical"` with count "1" on Notifications
(represents the 1 unresolved alert in sample data).

Active state: use Polaris Navigation's built-in `selected` prop.

Bottom of nav (below Navigation component):
```
<Box padding="400" borderBlockStartWidth="025" borderColor="border">
  <InlineStack gap="200" align="start">
    <span className="pulse-dot" />
    <Text as="span" tone="subdued" variant="bodySm">Pixel active</Text>
  </InlineStack>
  <Text as="p" tone="subdued" variant="bodySm">store.myshopify.com</Text>
</Box>
```

With this CSS (in a `<style>` tag in the page component):
```css
.pulse-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #007f5f; display: inline-block;
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 rgba(0,127,95,.5); }
  70%  { box-shadow: 0 0 0 8px rgba(0,127,95,0); }
  100% { box-shadow: 0 0 0 0 rgba(0,127,95,0); }
}
```

---

## STEP 5: SHARED COMPONENTS

**DateRangeSelector** — Polaris `ButtonGroup`:
```
1h  |  24h  |  7d  |  30d
```
Active button: `variant="primary"`. Inactive: `variant="secondary"`.
In preview, switching range does not change data (expected) — it's visual only.

**LivePill** — implement exactly as in the existing dashboard:
```typescript
// mirrors the live indicator already in app/(embedded)/dashboard/
// pulsing green dot + "Live · Updated just now" text
// increments every 15s via setInterval
// when alert is active: dot turns red (#d72c0d), matching existing dashboard behavior
```

---

## STEP 6: FOUR PAGES

### PAGE 1 — CONVERTED CARTS

Polaris `Page` with title "Converted Carts" and subtitle
"Orders that made it all the way through".

Top-right of Page title area: `<LivePill />`

**Date range selector:** `<DateRangeSelector />` below the page title.

**KPI row — Polaris `InlineGrid columns={3} gap="400"`:**
Each KPI: a Polaris `Card` containing:
- `Text variant="headingMd"` for label
- `Text variant="heading2xl"` for big number
- Polaris `Badge` for delta (tone="success" if positive, tone="critical" if negative)
- Sparkline (40px Recharts AreaChart, no axes)

Cards: Checkouts Started | Completed Orders | Checkout CVR

**Second KPI row — `InlineGrid columns={2}`:**
Avg Order Value | Avg Time to Complete

**CVR Over Time — Polaris `Card` with title:**
Recharts `LineChart`, height 200px:
- Line 1: `cvr` — solid #4F7FFF, strokeWidth 2
- Line 2: `baseline` — dashed #8c9196, strokeWidth 1, no dots
- Custom dot: when `payload.alert === true`, render red circle (fill #d72c0d, r=4)
  otherwise render nothing
- `ReferenceLine` at y=49.8 with label "Baseline 49.8%"
- Axes: small subdued tick labels, no axis lines (axisLine={false})
- Tooltip: show date + CVR% + baseline%
- Below chart: `<Text tone="subdued" variant="bodySm">● Red dots = days when an abandonment alert fired</Text>`

**Two-column row — Polaris `InlineGrid columns={2} gap="400"`:**

Left `Card` "Top Converting Products":
Polaris `DataTable`
columnContentTypes: ["text", "numeric", "numeric"]
headings: ["Product", "Orders", "Revenue"]
rows: from SAMPLE.topProducts, revenue as "$X,XXX"

Right `Card` "Completions by Device":
Polaris `DataTable`
headings: ["Device", "Orders", "CVR"]
Note below table in subdued text: "CVR = completed ÷ started on that device"

**Full-width `Card` "Completions by Country":**
Polaris `DataTable`
headings: ["Country", "Completed", "CVR", "Avg Order Value"]

---

### PAGE 2 — ABANDONED CARTS

Polaris `Page` title "Abandoned Carts", subtitle "Where customers drop off and why".
Top-right: `<LivePill />`. Below title: `<DateRangeSelector />`.

**KPI row — `InlineGrid columns={4}`:**
Abandoned Sessions | Abandonment Rate | Avg Abandoned Cart Value | Total Abandoned Value

**Funnel — Polaris `Card` title "Checkout Funnel"
subtitle "Sessions narrowing at each step":**

For each step in SAMPLE.funnel, render:
```
[Step bar — Polaris Box with background color]
[Drop gap — if not last step]
```

**Step bar:** Use `Box padding="300"` with background:
- Normal steps: `background="bg-surface-brand-selected"` (Polaris blue tint)
- `highDrop: true`: `background="bg-surface-critical-selected"` (Polaris red tint)
- Last step (completed): `background="bg-surface-success-selected"` (Polaris green tint)

Width as % of container using `style={{ width: \`\${(sessions/1847)*100}%\` }}`.

Inside each bar: `InlineStack align="space-between"`:
- Left: step name + optional `<Badge tone="critical">High drop-off</Badge>`
- Right: session count in bold

**Drop gap between steps:** `Box padding="200"`:
`InlineStack align="center"`:
`<Badge tone={highDrop ? "critical" : "attention"}>
  −{dropped} dropped · {dropPct}% · ~${lostRevenue} lost
</Badge>`

**Summary row** below all steps (Polaris `Divider` then `InlineStack align="space-between"`):
- "913 sessions never completed checkout"
- "Total est. lost: ~$52,442" (sum all lostRevenue values)

**Abandonment by Step Over Time — Polaris `Card`:**
Recharts LineChart, height 180px.
Three lines: contact (blue), shipping (yellow #f59e0b), payment (red #d72c0d).
Legend. Y axis as %. Same axis style as CVR chart.

**Two-column row:**
Left: "Products in Abandoned Carts" DataTable — Product | Carts | Est. Lost Revenue
Right: "Abandonment by Device" DataTable — Device | Abandoned | Rate | Worst Step

**Promotion Health — Polaris `Card`:**
subtitle: "Discount codes attempted during checkout in this period"

Use Polaris `IndexTable` with `condensed`. Columns:
Code | Attempts | Converted | Failed | Fail% | Est. Lost | Status

Status column: `<Badge tone="success">Healthy</Badge>` /
`<Badge tone="warning">High failure</Badge>` /
`<Badge tone="critical">Critical</Badge>`
based on failPct thresholds (<10 / 10–40 / >40).

Fail% cell: color-coded Text — `tone="critical"` if >40%, `tone="caution"` if >10%.

Row expansion using Polaris `Collapsible`:
Each row has a chevron button. Clicking it expands an inline detail row showing:
- "Common failure reason" + reason text
- "Avg cart value — Failed: $X · Converted: $X"
- "Customers abandon at: [step]"
- Polaris `Button variant="plain"` "[Edit in Shopify →]" (href="#" in preview)

Track expanded row ID in useState.

**Shipping Intelligence — Polaris `Card`:**
Two-column layout using `InlineGrid columns="2fr 1fr" gap="600"`:

Left: "Abandonment Rate by Shipping Method"
Polaris `DataTable` — Method | Selected | Abandoned | Rate
Rate column: Badge tone based on rate (>30 critical, >15 warning, else success).

Right: Three Polaris `Card` (or Box with border) stacked:
- "Avg Time on Shipping Step" → "68s"
- "Shipping Step Abandon Rate" → "12.8%"
- "Addresses with No Shipping Rates" → "3" — Box with `borderColor="border-caution"`

If addressesNoRates.length > 0, show a Polaris `Banner tone="warning"`:
"Recent addresses with no shipping rates" + list of date/city/country.

**Geography — `InlineGrid columns={2}`:**
Left `Card`: "Abandonment by Country" DataTable
Right `Card`: "Abandonment by State (US)" DataTable
Note below: subdued text "US traffic only (>30% of store sessions)"

---

### PAGE 3 — NOTIFICATIONS

Polaris `Page` title "Notifications", subtitle "Every alert sent, in one place".
Top-right: `<LivePill />`. Below title: `<DateRangeSelector />`.

**KPI row — `InlineGrid columns={4}` (no sparklines — lifetime numbers):**
Total Alerts Sent | Alerts Resolved | Avg Resolution Time | Est. Revenue Protected
Est. Revenue Protected: wrap value in `<Text tone="success">`.

**Filter pills — Polaris `ButtonGroup`:**
All | Discount | Abandonment | Extension | Payment
Store active filter in useState. Filter the alerts table below.

**Alert History — Polaris `Card`:**
Polaris `IndexTable`. Columns: When | Type | Detail | Sent Via | Status | Est. ROI

"Sent Via" column: `InlineStack gap="100"` of `<Badge>` per channel:
- Email → `<Badge tone="info">Email</Badge>`
- Slack → `<Badge tone="attention">Slack</Badge>`
- WhatsApp → `<Badge tone="success">WhatsApp</Badge>`

"Status" column:
- resolved → `<Badge tone="success">✓ Resolved</Badge>`
- unresolved → `<InlineStack gap="200"><Badge tone="warning">Unresolved</Badge>
  <Button variant="plain" size="slim" onClick={() => markResolved(id)}>Resolve</Button></InlineStack>`

"Est. ROI" column: `<Text tone="success">~$X,XXX</Text>` if set, "—" if null.

Row expansion using Polaris `Collapsible`:
Clicking a row expands inline to show:
- "Alert message sent" label in `<Text variant="headingSm">`
- Full message text
- Polaris `Button variant="plain"` "[View in Shopify admin →]" (href="#")
- If resolved: "Resolved: [resolvedAt]" in subdued text

Track expanded rows in useState. Track resolved rows in useState (starts with alerts where status === "resolved").

---

### PAGE 4 — SETTINGS

Polaris `Page` title "Settings". No date picker or LivePill.

**Section 1 — Alert Channels:**
Polaris `Layout` with `Layout.Section`.

```
Card title "Alert Channels":
  TextField label="Email" value={email} onChange={setEmail} connectedRight={<Button>Save</Button>}
  TextField label="Slack Webhook URL" value={slack} onChange={setSlack}
    connectedRight={<InlineStack><Button>Test</Button><Button>Save</Button></InlineStack>}
  Box with subdued background:
    InlineStack align="space-between":
      BlockStack: Text "WhatsApp" + Text tone="subdued" "Instant alerts on your phone"
      Badge tone="info">Coming soon</Badge>
```

**Section 2 — Alert Sensitivity:**
```
Card title "Alert Sensitivity":
  RangeSlider label="Abandonment threshold" min={5} max={50} value={abandonment}
    helpText="Alert when CVR drops this much below baseline"
    suffix={<Text>{abandonment}%</Text>}
  RangeSlider label="Discount failures before alert" min={1} max={20}
    helpText="How many failures in 1 hour before alerting"
  RangeSlider label="Payment failure rate" min={5} max={40}
    helpText="Alert when payment failures exceed this rate"
```

Initialize slider values from SAMPLE settings. Store in useState.

**Section 3 — Monitoring Status:**
```
Card title "Monitoring Status":
  Banner tone="success" icon={CircleTickMajor}:
    "Pixel connected · Last event: 4 min ago · 847 events today"
  Box paddingBlockStart="400":
    InlineStack align="space-between":
      Text "Pro Plan · $49/month"
      Button variant="plain">Manage billing →</Button>
```

**Section 4 — Impact (anti-churn card):**
Polaris `Box` with `background="bg-surface-brand"` and `padding="600"` and
`borderRadius="300"`:

```
Text variant="headingLg": "CheckoutMaxx has been protecting your store for 47 days"
InlineGrid columns={2} gap="600" paddingBlockStart="400":
  Each metric:
    Text variant="bodySm" tone="subdued": label (uppercase)
    Text variant="heading2xl": value
Divider paddingBlockStart="400"
Text tone="subdued" variant="bodySm":
  "These numbers represent the value of CheckoutMaxx running silently in the background."
```

---

## STEP 7: WALKTHROUGH MODE (wire up now, use later)

Already described in Step 4 (the `?walkthrough=1` Banner).

Additionally, add `data-walkthrough="[section-name]"` attributes to every major
Polaris `Card` or `Page` section so a future tooltip library can target them
without refactoring:

```
data-walkthrough="kpi-cards"
data-walkthrough="checkout-funnel"
data-walkthrough="promotion-health"
data-walkthrough="alert-history"
data-walkthrough="impact-card"
```

These are invisible in normal use. No behavior change.

---

## STEP 8: VERIFY

```bash
npm run dev
```

Check:
1. `localhost:3000/preview` loads without errors or white screen
2. All 4 nav items navigate correctly
3. `localhost:3000/preview?walkthrough=1` shows the blue info Banner at top
4. Promotion rows expand/collapse in Abandoned Carts
5. Alert rows expand/collapse in Notifications
6. Resolve button on unresolved alert updates the badge count in sidebar nav
7. Settings sliders are interactive
8. `git status` — confirm `app/preview/` does NOT appear (gitignored)
9. `npm run build` — no TypeScript errors introduced by the preview

---

## HARD RULES — NEVER VIOLATE

1. **`app/preview/` must be in `.gitignore` before any file is created.**
2. **No imports from `lib/`, `prisma/`, `app/api/`, or any server-side module.**
   The preview is client-only. Mark `page.tsx` as `"use client"`.
3. **All data from `SAMPLE` in `_data/sample.ts`. No values hardcoded in components.**
4. **Polaris for all UI. No Tailwind. No shadcn. No custom CSS frameworks.**
   The only exception: the `.pulse-dot` keyframe animation (no Polaris equivalent).
5. **Use `<AppProvider i18n={en}>` from `@shopify/polaris` — NOT App Bridge.**
   The preview runs outside the Shopify iframe.
6. **Recharts for sparklines and line charts only.** Nothing else needs a chart lib.
7. **`data-walkthrough` attributes on every major section card.**
8. **`?walkthrough=1` param wires up the demo Banner.** Do not skip this.
9. **No Vercel deployment. No git push. Local only until instructed.**
10. **`npm run build` must pass with zero new TypeScript errors after this task.**
