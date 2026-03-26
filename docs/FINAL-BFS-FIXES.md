# CouponMaxx — FINAL Pending Fixes for BFS Badge

Everything remaining. After this file, the app should be BFS-submission ready.

Do tasks in order. Run VERIFY after each. Paste output into CHANGELOG.md.

---

# PART A — DATA FIXES (5 items)

---

## D-1. UTM source: add tiktok_ads to SQL, remove invalid frontend options

**SQL file** `supabase/analytics-functions.sql` — in `couponmaxx_utm_sessions` function, find the Social WHEN clause:

```sql
-- FIND:
WHEN 'Social' THEN "utmSource" IN ('instagram','facebook','fb','tiktok')

-- REPLACE WITH:
WHEN 'Social' THEN "utmSource" IN ('instagram','facebook','fb','tiktok','tiktok_ads')
```

**Frontend** `app/(embedded)/couponmaxx/sessions/page.tsx` — find `sourceOptions` and replace with:

```tsx
const sourceOptions = [
  { label: 'All sources', value: '' },
  { label: 'Direct', value: 'Direct' },
  { label: 'Paid Search', value: 'Paid search' },
  { label: 'Social', value: 'Social' },
  { label: 'Email', value: 'Email' },
];
```

Remove Organic, Paid Social, Affiliate, Referral — they have no backend mapping.

VERIFY:
```bash
grep -c "tiktok_ads" supabase/analytics-functions.sql
# Must: >= 1
grep -c "Organic\|Affiliate\|Referral" app/\(embedded\)/couponmaxx/sessions/page.tsx
# Must: 0
```

---

## D-2. Prisma schema — add notification columns

**File**: `prisma/schema.prisma` — add to the Shop model (after the existing `alertPaymentEnabled` line or similar):

```prisma
  // CouponMaxx notification settings (added via supabase/shop-slack.sql)
  notificationSettings Json?
  notificationEmail    String?
  slackChannelName     String?
```

Then regenerate:
```bash
npx prisma generate
```

Do NOT run `prisma db push` — these columns already exist in the DB (added via SQL). This just syncs the Prisma client types.

VERIFY:
```bash
grep -c "notificationSettings\|notificationEmail\|slackChannelName" prisma/schema.prisma
# Must: 3
```

---

## D-3. Coupons API — add truncation warning

**File**: `app/api/couponmaxx/coupons/route.ts`

After the two parallel fetches (around line 32), add:
```ts
const truncated = (couponEvs?.length === 20000) || (allCartEvs?.length === 20000);
```

Then in the final `return NextResponse.json({` block, add `truncated` as a top-level field:
```ts
return NextResponse.json({
  truncated,
  boxes: { ... },
  ...
});
```

VERIFY:
```bash
grep -c "truncated" app/api/couponmaxx/coupons/route.ts
# Must: >= 2
```

---

## D-4. Compare mode — return ALL 4 metric comparisons + handle previous_year

**File**: `app/api/couponmaxx/analytics/route.ts`

This is the biggest change. Currently the compare block only computes `successRateComparison`. It needs to also compute `cartsWithCouponComparison`, `attributedSalesComparison`, and `cartViewsComparison`.

**Replace the entire compare block** (from `// Previous period for compare-to` through to the end of the `if (p.get('compareTo'))` block) with:

```ts
  // ---- Compare-to period ----
  const compareMode = p.get('compareTo') ?? '';
  let successRateComparison: { date: string; value: number }[] | undefined;
  let cartsWithCouponComparison: { date: string; value: number }[] | undefined;
  let attrSalesComparison: { date: string; value: number }[] | undefined;
  let cartViewsTotalComparison: { date: string; value: number }[] | undefined;
  let cartViewsWithProductsComparison: { date: string; value: number }[] | undefined;
  let cartViewsCheckoutsComparison: { date: string; value: number }[] | undefined;

  if (compareMode) {
    // Compute comparison period
    let cmpStart: Date;
    let cmpEnd: Date;
    if (compareMode === 'previous_year') {
      cmpStart = new Date(start);
      cmpStart.setFullYear(cmpStart.getFullYear() - 1);
      cmpEnd = new Date(end);
      cmpEnd.setFullYear(cmpEnd.getFullYear() - 1);
    } else {
      // previous_period (default)
      cmpEnd = new Date(start.getTime() - 1);
      cmpStart = new Date(cmpEnd.getTime() - rangeMs);
    }

    // Fetch all comparison data in parallel
    const [prevCartRes, prevCheckoutRes, prevAttrRes] = await Promise.all([
      supabase.rpc('couponmaxx_daily_cart_metrics', {
        p_shop_id: shopId,
        p_start: cmpStart.toISOString(),
        p_end: cmpEnd.toISOString(),
        p_device: device || null,
        p_session_ids: null,
      }),
      supabase.rpc('couponmaxx_daily_checkout_sessions', {
        p_shop_id: shopId,
        p_start: cmpStart.toISOString(),
        p_end: cmpEnd.toISOString(),
      }),
      supabase.rpc('couponmaxx_attributed_sales_daily', {
        p_shop_id: shopId,
        p_start: cmpStart.toISOString(),
        p_end: cmpEnd.toISOString(),
        p_attr_window_days: attrWindow,
        p_price_type: priceType,
        p_session_ids: null,
      }),
    ]);

    const prevCartRows = (prevCartRes.data ?? []) as DailyCartRow[];
    const prevCkRows = (prevCheckoutRes.data ?? []) as CheckoutRow[];
    const prevAttrRows = (prevAttrRes.data ?? []) as AttrRow[];

    // Index by offset (day 0 of comparison = day 0 of current)
    const prevCartByOffset = new Map<number, DailyCartRow>();
    for (const r of prevCartRows) {
      const offset = Math.round((new Date(r.day).getTime() - cmpStart.getTime()) / 86400000);
      prevCartByOffset.set(offset, r);
    }
    const prevCkByOffset = new Map<number, number>();
    for (const r of prevCkRows) {
      const offset = Math.round((new Date(r.day).getTime() - cmpStart.getTime()) / 86400000);
      prevCkByOffset.set(offset, r.checkout_sessions);
    }
    const prevAttrByOffset = new Map<number, number>();
    for (const r of prevAttrRows) {
      const offset = Math.round((new Date(r.day).getTime() - cmpStart.getTime()) / 86400000);
      prevAttrByOffset.set(offset, r.attributed_value);
    }

    // Build comparison arrays aligned to current period dates
    const sortedDates = Array.from(daily.keys()).sort();
    successRateComparison = sortedDates.map((date, i) => {
      const prev = prevCartByOffset.get(i);
      const rate = prev && prev.sessions_coupon_attempted > 0
        ? Math.round((prev.sessions_coupon_applied / prev.sessions_coupon_attempted) * 1000) / 10
        : 0;
      return { date, value: rate };
    });

    cartsWithCouponComparison = sortedDates.map((date, i) => {
      const prev = prevCartByOffset.get(i);
      const pct = prev && prev.sessions_with_products > 0
        ? Math.round((prev.sessions_with_coupon / prev.sessions_with_products) * 1000) / 10
        : 0;
      return { date, value: pct };
    });

    attrSalesComparison = sortedDates.map((date, i) => {
      return { date, value: Math.round((prevAttrByOffset.get(i) ?? 0) * 100) / 100 };
    });

    cartViewsTotalComparison = sortedDates.map((date, i) => {
      return { date, value: prevCartByOffset.get(i)?.total_sessions ?? 0 };
    });

    cartViewsWithProductsComparison = sortedDates.map((date, i) => {
      return { date, value: prevCartByOffset.get(i)?.sessions_with_products ?? 0 };
    });

    cartViewsCheckoutsComparison = sortedDates.map((date, i) => {
      const cartClicked = prevCartByOffset.get(i)?.checkout_clicked_sessions ?? 0;
      const ckSessions = prevCkByOffset.get(i) ?? 0;
      return { date, value: Math.max(cartClicked, ckSessions) };
    });
  }
```

Then **update the response** to include all comparisons:

```ts
  return NextResponse.json({
    couponSuccessRate: {
      average: avgSuccessRate,
      daily: successRateDaily,
      comparison: successRateComparison,
    },
    cartsWithCoupon: {
      average: avgCartsWithCoupon,
      daily: cartsWithCouponDaily,
      comparison: cartsWithCouponComparison,  // ADD
    },
    attributedSales: {
      total: Math.round(attrTotal * 100) / 100,
      daily: attrSalesDaily,
      comparison: attrSalesComparison,  // ADD
    },
    cartViews: {
      total:        { total: totalCartViews,    daily: cartViewsDaily },
      withProducts: { total: totalWithProducts, daily: withProductsDaily },
      checkouts:    { total: totalCheckouts,    daily: checkoutsDaily },
      comparison: {  // ADD entire block
        total:        { daily: cartViewsTotalComparison ?? [] },
        withProducts: { daily: cartViewsWithProductsComparison ?? [] },
        checkouts:    { daily: cartViewsCheckoutsComparison ?? [] },
      },
    },
    funnel: {
      cartViews:          funnel.total_sessions,
      cartsWithProducts:  funnel.sessions_with_products,
      couponsAttempted:   funnel.sessions_with_coupon,
      couponsApplied:     funnel.coupon_applied,
      couponsFailed:      funnel.coupon_failed,
      reachedCheckout:    funnel.reached_checkout,
      daily:              funnelDaily,
    },
  });
```

Also **delete the old `prevStart` variable** at the top (around line 37):
```ts
// DELETE this line:
const prevStart = subDays(start, Math.round(rangeMs / 86400000));
```
It's replaced by `cmpStart` inside the compare block.

And **delete the old `prevEnd`** variable that was placed mid-file:
```ts
// DELETE this line (around line 93):
const prevEnd = new Date(start.getTime() - 1);
```
It's replaced by `cmpEnd` inside the compare block.

VERIFY:
```bash
grep -c "previous_year" app/api/couponmaxx/analytics/route.ts
# Must: >= 1
grep -c "cartsWithCouponComparison\|attrSalesComparison\|cartViewsTotalComparison" app/api/couponmaxx/analytics/route.ts
# Must: >= 3
grep -c "prevStart\b" app/api/couponmaxx/analytics/route.ts
# Must: 0 (replaced by cmpStart)
```

---

## D-5. Compare mode — frontend already expects comparison data

The analytics page frontend already reads `data?.cartsWithCoupon.comparison`, `data?.attributedSales.comparison`, etc. and passes them to `MetricCard` as `compareData`. So D-4's API changes should "just work" on the frontend.

BUT — check the `cartViews` comparison shape. The frontend (in analytics/page.tsx) reads:
```ts
const cartViewsCompare = compareActive
  ? (data?.cartViews.comparison?.[cartViewMetric]?.daily ?? [])
  : undefined;
```

The API now returns `cartViews.comparison.total.daily`, `.withProducts.daily`, `.checkouts.daily`. Verify this matches. If the frontend reads `comparison?.[cartViewMetric]` and `cartViewMetric` is `'total' | 'withProducts' | 'checkouts'`, the shape matches.

VERIFY:
```bash
# Check that the frontend reads the comparison correctly
grep "cartViews.comparison" app/\(embedded\)/couponmaxx/analytics/page.tsx
# Should show accessing comparison[cartViewMetric].daily
```

---

# PART B — BFS REQUIREMENTS (3 items)

---

## B-1. OnboardingBanner — check REAL extension status

**BFS Requirement 4.2.3**: "An app has an app block and/or app embed to be activated in a theme but fails to communicate the corresponding status(es) on the app's homepage using `app.extensions()`."

**Current state**: OnboardingBanner shows 3 static steps (Pixel is tracking, Review codes, Set up alerts). It doesn't actually check if the pixel IS tracking.

**Fix**: Replace `components/couponmaxx/OnboardingBanner.tsx` entirely:

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Banner, BlockStack, Button, Card, Icon, InlineStack, ProgressBar, Text } from '@shopify/polaris';
import { CheckCircleIcon, AlertCircleIcon } from '@shopify/polaris-icons';

const STORAGE_KEY = 'cm_onboarding_dismissed';

type ExtensionStatus = {
  cartMonitor: boolean;
  checkoutPixel: boolean;
};

type Props = {
  hasData: boolean;
};

export function OnboardingBanner({ hasData }: Props) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [extensions, setExtensions] = useState<ExtensionStatus>({
    cartMonitor: false,
    checkoutPixel: false,
  });

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  // Check extension status via App Bridge
  useEffect(() => {
    async function check() {
      try {
        // @ts-expect-error — shopify global from App Bridge
        if (typeof shopify !== 'undefined' && shopify.app?.extensions) {
          const exts = await shopify.app.extensions();
          const cart = exts.find((e: { handle: string }) => e.handle === 'cart-monitor');
          const pixel = exts.find((e: { handle: string }) => e.handle === 'checkout-monitor');
          setExtensions({
            cartMonitor: cart?.status === 'active',
            checkoutPixel: pixel?.status === 'active',
          });
        } else {
          // Fallback: if API not available, assume active to not block
          setExtensions({ cartMonitor: true, checkoutPixel: true });
        }
      } catch {
        setExtensions({ cartMonitor: true, checkoutPixel: true });
      }
    }
    check();
  }, []);

  const handleDismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch {}
    setDismissed(true);
  };

  if (dismissed === null || dismissed) return null;

  const steps = [
    {
      label: 'Cart monitor',
      done: extensions.cartMonitor,
      ok: 'Active on your storefront',
      fail: 'Not active — enable the Cart Monitor block in your theme',
    },
    {
      label: 'Checkout pixel',
      done: extensions.checkoutPixel,
      ok: 'Tracking checkout events',
      fail: 'Not detected — try reinstalling the app',
    },
    {
      label: 'Receiving data',
      done: hasData,
      ok: 'Data is flowing into your dashboard',
      fail: 'Waiting for first customer sessions (usually a few hours)',
    },
  ];

  const doneCount = steps.filter(s => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h2">
              {allDone ? 'Setup complete' : 'Getting started with CouponMaxx'}
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              {doneCount} of {steps.length} completed
            </Text>
          </BlockStack>
          {allDone && (
            <Button variant="plain" onClick={handleDismiss}>Dismiss</Button>
          )}
        </InlineStack>

        <ProgressBar progress={(doneCount / steps.length) * 100} tone="primary" size="small" />

        {steps.map((step) => (
          <InlineStack key={step.label} gap="300" blockAlign="start">
            <div style={{ flexShrink: 0, marginTop: 2 }}>
              <Icon
                source={step.done ? CheckCircleIcon : AlertCircleIcon}
                tone={step.done ? 'success' : 'subdued'}
              />
            </div>
            <BlockStack gap="050">
              <Text variant="bodyMd" fontWeight="semibold" as="span">{step.label}</Text>
              <Text variant="bodySm" tone={step.done ? 'subdued' : 'caution'} as="span">
                {step.done ? step.ok : step.fail}
              </Text>
            </BlockStack>
          </InlineStack>
        ))}
      </BlockStack>
    </Card>
  );
}
```

**Then update the analytics page** where `<OnboardingBanner>` is used — pass the `hasData` prop:

```tsx
<OnboardingBanner hasData={!!(data && data.funnel.cartViews > 0)} />
```

VERIFY:
```bash
grep -c "app.extensions\|shopify.app" components/couponmaxx/OnboardingBanner.tsx
# Must: >= 1
grep -c "hasData" components/couponmaxx/OnboardingBanner.tsx
# Must: >= 2
grep "OnboardingBanner" app/\(embedded\)/couponmaxx/analytics/page.tsx
# Must show hasData prop being passed
```

---

## B-2. App status banner — show after onboarding is dismissed

**BFS Requirement 4.2.3**: Homepage must indicate if the app is set up and working.

After onboarding is dismissed, there's currently no status indicator. Add one to `analytics/page.tsx`.

In the analytics page, AFTER the `<OnboardingBanner>` block, add:

```tsx
{/* App status — shown when onboarding is dismissed */}
{!showOnboarding && (
  <AppStatusBanner />
)}
```

Create a simple inline component in the analytics page (or a separate file):

```tsx
function AppStatusBanner() {
  const [status, setStatus] = useState<'checking' | 'active' | 'issue'>('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function check() {
      try {
        // @ts-expect-error — shopify global
        if (typeof shopify !== 'undefined' && shopify.app?.extensions) {
          const exts = await shopify.app.extensions();
          const cart = exts.find((e: { handle: string }) => e.handle === 'cart-monitor');
          if (!cart || cart.status !== 'active') {
            setStatus('issue');
            setMessage('Cart monitor is not active. Enable it in your theme settings.');
            return;
          }
        }
        setStatus('active');
        setMessage('CouponMaxx is active and monitoring your store.');
      } catch {
        setStatus('active'); // don't alarm if API unavailable
        setMessage('CouponMaxx is running.');
      }
    }
    check();
  }, []);

  if (status === 'checking') return null;

  return (
    <Banner tone={status === 'active' ? 'success' : 'warning'}>
      {message}
    </Banner>
  );
}
```

Put this function INSIDE the analytics page file (before the default export) or extract to a component.

The `showOnboarding` variable needs to be accessible. If OnboardingBanner manages its own dismissed state internally, you need to know when it's not rendering. Simplest approach: check localStorage directly:

```tsx
const [onboardingDismissed, setOnboardingDismissed] = useState(false);
useEffect(() => {
  try {
    setOnboardingDismissed(localStorage.getItem('cm_onboarding_dismissed') === 'true');
  } catch {}
}, []);
```

Then:
```tsx
{!onboardingDismissed && <OnboardingBanner hasData={...} />}
{onboardingDismissed && <AppStatusBanner />}
```

VERIFY:
```bash
grep -c "AppStatusBanner\|app.extensions" app/\(embedded\)/couponmaxx/analytics/page.tsx
# Must: >= 2
grep -c "tone.*success\|tone.*warning" app/\(embedded\)/couponmaxx/analytics/page.tsx
# Must: >= 2 (the status banner tones)
```

---

## B-3. Contextual Save Bar — verify it works correctly

The SaveBar was added in a previous round. Verify the implementation is complete:

```bash
# SaveBar imported:
grep "SaveBar" app/\(embedded\)/couponmaxx/notifications/page.tsx | head -2

# isDirty state exists:
grep "isDirty" app/\(embedded\)/couponmaxx/notifications/page.tsx | head -3

# No separate save buttons remain:
grep -c "saveTriggers\|saveChannels\|saveDigest" app/\(embedded\)/couponmaxx/notifications/page.tsx
# Must: 0 (all replaced by single saveAll)
```

If the old save functions still exist, they need to be consolidated into one `saveAll` function.

---

# PART C — FINAL VERIFICATION SUITE

Run this AFTER all tasks. Paste complete output into CHANGELOG.md.

```bash
echo "=== BFS FINAL VERIFICATION ==="
echo ""

echo "D-1 UTM tiktok_ads:" $(grep -c "tiktok_ads" supabase/analytics-functions.sql || echo 0)
echo "(Must: >= 1)"
echo "D-1 No invalid UTM options:" $(grep -c "Organic\|Affiliate\|Referral" app/\(embedded\)/couponmaxx/sessions/page.tsx || echo 0)
echo "(Must: 0)"
echo ""

echo "D-2 Prisma cols:" $(grep -c "notificationSettings\|notificationEmail\|slackChannelName" prisma/schema.prisma || echo 0)
echo "(Must: 3)"
echo ""

echo "D-3 Truncated:" $(grep -c "truncated" app/api/couponmaxx/coupons/route.ts || echo 0)
echo "(Must: >= 2)"
echo ""

echo "D-4 Compare previous_year:" $(grep -c "previous_year" app/api/couponmaxx/analytics/route.ts || echo 0)
echo "(Must: >= 1)"
echo "D-4 All comparison fields:" $(grep -c "cartsWithCouponComparison\|attrSalesComparison\|cartViewsTotalComparison" app/api/couponmaxx/analytics/route.ts || echo 0)
echo "(Must: >= 3)"
echo ""

echo "B-1 Extension check in onboarding:" $(grep -c "app.extensions\|shopify.app" components/couponmaxx/OnboardingBanner.tsx || echo 0)
echo "(Must: >= 1)"
echo "B-1 hasData prop:" $(grep -c "hasData" components/couponmaxx/OnboardingBanner.tsx || echo 0)
echo "(Must: >= 2)"
echo ""

echo "B-2 Status banner:" $(grep -c "AppStatusBanner" app/\(embedded\)/couponmaxx/analytics/page.tsx || echo 0)
echo "(Must: >= 2)"
echo ""

echo "B-3 SaveBar:" $(grep -c "SaveBar" app/\(embedded\)/couponmaxx/notifications/page.tsx || echo 0)
echo "(Must: >= 2)"
echo "B-3 No old save fns:" $(grep -c "saveTriggers\|saveChannels\|saveDigest" app/\(embedded\)/couponmaxx/notifications/page.tsx || echo 0)
echo "(Must: 0)"
echo ""

echo "--- PREVIOUS FIXES STILL INTACT ---"
echo "IndexTable:" $(grep -rl "IndexTable" app/\(embedded\)/couponmaxx/ 2>/dev/null | wc -l)
echo "(Must: 2)"
echo "Modal:" $(grep -rl "Modal" app/\(embedded\)/couponmaxx/ 2>/dev/null | wc -l)
echo "(Must: 2)"
echo "Page:" $(grep -rl "<Page " app/\(embedded\)/couponmaxx/ 2>/dev/null | wc -l)
echo "(Must: 4)"
echo "No Header.tsx:" && ls components/couponmaxx/Header.tsx 2>&1
echo "No FilterPill:" && ls components/couponmaxx/FilterPill.tsx 2>&1
echo "OptionList DatePicker:" $(grep -c "OptionList" components/couponmaxx/DateRangePicker.tsx || echo 0)
echo "(Must: >= 1)"
echo "No custom card divs:" $(grep -rn "background.*#FFFFFF.*border.*#E3E3E3" app/\(embedded\)/couponmaxx/ components/couponmaxx/ 2>/dev/null | wc -l)
echo "(Must: 0)"
echo ""

echo "--- BUILD ---"
npx next build 2>&1 | tail -5
echo ""
echo "=== END ==="
```

---

# AFTER THIS FILE

Once all checks pass and the build succeeds:

1. **Deploy to Vercel** — push to main, Vercel auto-deploys
2. **Run the SQL migration** — execute the updated `couponmaxx_utm_sessions` function in Supabase SQL editor  
3. **Update app name in Partner Dashboard** — Apps → your app → App setup → change name to "CouponMaxx"
4. **Wait 28 days** for Shopify to collect 100+ Web Vitals measurements (LCP, CLS, INP)
5. **Get 50 installs + 5 reviews** — prerequisite for BFS application
6. **Apply for BFS** in Partner Dashboard → Distribution → Apply now

The code will be ready. The waiting is for Shopify's measurement window and the install/review thresholds.
