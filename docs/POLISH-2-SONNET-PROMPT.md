# Sonnet Execution Prompt — Polish 2

You are Sonnet. Execute this plan verbatim. Do not refactor or add features beyond what's listed. Test on prod (Vercel auto-deploy from `couponmaxx-submission` branch). No `shopify app dev`, no dev tunnels.

## Context

CouponMaxx Shopify app. Admin has 3 tabs (Diagnostics / Sessions / Discounts). Polish 1 shipped working checkout-claim + liquid-glass cart + simplified sessions/discounts pages. User now wants:

1. **Reorder nav**: Diagnostics moves to position 3 (last). New order: `Sessions · Discounts · Diagnostics`.
2. **Discounts KPIs**: add cart-views count (today) + "+X in last hour".
3. **Sessions page**:
   - Coupon attempts column currently empty → run SQL to verify DB state before touching code.
   - Also surface products per session (`CartEvent.lineItems` exists but unused by API).
   - Include `cart_coupon_recovered` eventType in attempts list.

## Data path (already wired end-to-end — verified)

- `extensions/cart-monitor/assets/cart-monitor.js` emits `{eventType, payload:{code,...}}` for `cart_coupon_applied|failed|recovered|removed` (lines 281–332, 405)
- `app/api/cart/ingest/route.ts` writes `CartEvent.couponCode = payload.code` (line 120); lineItems sanitized at lines 86–98
- `app/api/couponmaxx/sessions/route.ts` groups by sessionId, pushes to couponAttempts only for `applied|failed` (line 68)

## Step 0 — SQL verification (run FIRST in Supabase SQL editor, before coding)

Paste each into Supabase SQL editor and share results with user if anything looks off:

```sql
-- 1. Are coupon events arriving at all (last 7 days)?
SELECT "eventType", COUNT(*) AS n, MAX("occurredAt") AS last_at
FROM "CartEvent"
WHERE "occurredAt" > NOW() - INTERVAL '7 days'
GROUP BY "eventType"
ORDER BY n DESC;

-- 2. For coupon events, is couponCode populated?
SELECT "occurredAt", "sessionId", "eventType", "couponCode", "couponSuccess", "couponFailReason"
FROM "CartEvent"
WHERE "eventType" LIKE 'cart_coupon_%'
  AND "occurredAt" > NOW() - INTERVAL '7 days'
ORDER BY "occurredAt" DESC
LIMIT 50;

-- 3. Do coupon sessionIds overlap with non-coupon sessionIds?
SELECT "sessionId", ARRAY_AGG(DISTINCT "eventType") AS event_types
FROM "CartEvent"
WHERE "occurredAt" > NOW() - INTERVAL '7 days'
GROUP BY "sessionId"
HAVING bool_or("eventType" LIKE 'cart_coupon_%')
ORDER BY MAX("occurredAt") DESC
LIMIT 20;

-- 4. lineItems populated?
SELECT "occurredAt", "sessionId", "eventType", "lineItems"
FROM "CartEvent"
WHERE "lineItems" IS NOT NULL
  AND "occurredAt" > NOW() - INTERVAL '7 days'
ORDER BY "occurredAt" DESC
LIMIT 10;
```

**Interpret:**
- Query 1 has zero `cart_coupon_*` rows → no coupons ever tested. UI is fine; user needs to actually apply one. Proceed with code anyway.
- Query 1 has rows but Query 2 shows null `couponCode` → ingest bug. Stop and report.
- Query 3 shows coupon events under a different sessionId than regular cart events → cart-monitor.js session jitter. Stop and report.
- Query 4 populated → products rendering is safe.

Proceed with code changes regardless (UI changes are orthogonal to whether data currently exists).

---

## Step 1 — Nav reorder

**File:** `app/(embedded)/couponmaxx/layout.tsx`

Replace the `TABS` const:

```tsx
const TABS = [
  { id: 'sessions',    label: 'Sessions',    href: '/couponmaxx/sessions' },
  { id: 'discounts',   label: 'Discounts',   href: '/couponmaxx/discounts' },
  { id: 'diagnostics', label: 'Diagnostics', href: '/couponmaxx/diagnostics' },
];
```

**Also check:** `app/(embedded)/couponmaxx/page.tsx`. If it exists and does a redirect, repoint default to `/couponmaxx/sessions`. If it does not exist, do nothing.

---

## Step 2 — Cart-views KPI on Discounts page

### 2a. Pick the eventType

Grep `extensions/cart-monitor/assets/cart-monitor.js` for `logEvent(buildEvent('cart_` and pick the event name that fires once per cart page visit. Candidates you'll see: `cart_drawer_opened`, `cart_checkout_clicked`, `cart_atc_clicked`, `cart_page_hidden`.

**Pick `cart_drawer_opened`** unless that one is absent — it's the closest proxy to "cart views". Do NOT invent a new event name. Do NOT use `cart_fetched` (SKIP-listed in ingest).

### 2b. Extend `app/api/couponmaxx/claims/route.ts`

Add two parallel count queries. Inside `Promise.all([...])`, after the existing 3 queries, add:

```ts
supabase
  .from('CartEvent')
  .select('*', { count: 'exact', head: true })
  .eq('shopId', shop.id)
  .eq('eventType', 'cart_drawer_opened')
  .gte('occurredAt', todayStart.toISOString()),
supabase
  .from('CartEvent')
  .select('*', { count: 'exact', head: true })
  .eq('shopId', shop.id)
  .eq('eventType', 'cart_drawer_opened')
  .gte('occurredAt', new Date(Date.now() - 60 * 60 * 1000).toISOString()),
```

Destructure as `cvTodayRes, cvHourRes`.

Update return payload:

```ts
return NextResponse.json({
  counts: {
    today: todayRes.count ?? 0,
    week: weekRes.count ?? 0,
    cartViewsToday: cvTodayRes.count ?? 0,
    cartViewsHour: cvHourRes.count ?? 0,
  },
  recent: recentRes.data ?? [],
});
```

Add console.log line for visibility: `console.log('[CMX claims] cartViews today:', cvTodayRes.count, 'hour:', cvHourRes.count);`

### 2c. Update `app/(embedded)/couponmaxx/discounts/page.tsx`

Extend `ClaimsData['counts']` type:

```tsx
type ClaimsData = {
  counts: {
    today: number;
    week: number;
    cartViewsToday: number;
    cartViewsHour: number;
  };
  recent: ClaimRow[];
};
```

Add a 3rd `<div style={{ flex: 1 }}>...</div>` tile inside the existing `<InlineStack gap="400">` KPI row:

```tsx
<div style={{ flex: 1 }}>
  <Card>
    <BlockStack gap="100">
      <Text variant="bodySm" tone="subdued" as="p">Cart views today</Text>
      <Text variant="heading2xl" as="p">
        {loading ? '—' : String(data?.counts.cartViewsToday ?? 0)}
      </Text>
      <Text variant="bodySm" tone="subdued" as="p">
        +{data?.counts.cartViewsHour ?? 0} in last hour
      </Text>
    </BlockStack>
  </Card>
</div>
```

---

## Step 3 — Sessions: products column + include recovered

### 3a. `app/api/couponmaxx/sessions/route.ts`

**Three changes:**

1. Add `lineItems` to the `.select()`:

```ts
.select('sessionId, eventType, couponCode, couponSuccess, cartValue, lineItems, device, country, occurredAt')
```

2. Extend the map-entry shape with `lineItems: any[]` init `[]`:

```ts
const bySession = new Map<string, {
  sessionId: string;
  startedAt: string;
  lastSeenAt: string;
  device: string | null;
  country: string | null;
  cartValue: number;
  lineItems: any[];
  couponAttempts: { code: string | null; success: boolean | null; at: string }[];
  reachedCheckout: boolean;
  completed: boolean;
}>();
```

And in the `bySession.set(...)` initializer, add `lineItems: []`.

3. In the row-merge loop (after the existing `if (r.cartValue) s.cartValue = r.cartValue;` line), add:

```ts
if (Array.isArray(r.lineItems) && r.lineItems.length > 0) {
  s.lineItems = r.lineItems;
}
```

4. Broaden coupon check:

```ts
if (
  r.eventType === 'cart_coupon_applied' ||
  r.eventType === 'cart_coupon_failed' ||
  r.eventType === 'cart_coupon_recovered'
) {
  s.couponAttempts.push({ code: r.couponCode, success: r.couponSuccess, at: r.occurredAt });
}
```

### 3b. `app/(embedded)/couponmaxx/sessions/page.tsx`

Extend types and add helper:

```tsx
type LineItem = {
  productTitle: string | null;
  quantity: number | null;
  price: number | null;
};

type Session = {
  sessionId: string;
  startedAt: string;
  lastSeenAt: string;
  device: string | null;
  country: string | null;
  cartValue: number;
  lineItems: LineItem[];
  couponAttempts: CouponAttempt[];
  reachedCheckout: boolean;
  completed: boolean;
};

function productsCell(items: LineItem[]): string {
  if (!items?.length) return '—';
  const titles = items.map(i => i.productTitle).filter(Boolean) as string[];
  if (!titles.length) return `${items.length} item${items.length > 1 ? 's' : ''}`;
  const head = titles.slice(0, 2).join(', ');
  const extra = titles.length > 2 ? ` +${titles.length - 2}` : '';
  return head + extra;
}
```

Add header cell between "Cart value" and "Coupon attempts":

```tsx
{['Started', 'Device / Country', 'Cart value', 'Products', 'Coupon attempts', 'Status'].map(h => ( ... ))}
```

Add body cell in the same position for each row:

```tsx
<td style={{
  padding: '8px 10px',
  color: '#374151',
  maxWidth: 220,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}}>
  {productsCell(s.lineItems)}
</td>
```

---

## Step 4 — Deploy + verify

1. Typecheck: `npx tsc --noEmit` — must be zero errors.
2. Commit:
   ```
   polish-2: nav reorder + cart-views KPI + sessions products & coupon-recovered
   ```
3. Push `couponmaxx-submission` → Vercel auto-deploys.
4. No `shopify app deploy` needed (no extension changes).

### Manual verification on 20aprtest (real storefront)

1. Admin tabs display in order: `Sessions · Discounts · Diagnostics`.
2. Discounts tab → 3 KPI cards render. Visit storefront cart, wait 30s, refresh admin → `Cart views today` increments.
3. Sessions tab → Products column shows product titles for sessions that had lineItems.
4. Apply a coupon on storefront (valid or invalid). Refresh Sessions tab → Coupon attempts column shows the code + success badge.

If coupon column stays empty after a real apply, **stop and paste SQL query 1–4 results**. Do not dig for code bugs blindly.

---

## DO NOT

- Do NOT modify the checkout extension. It's live as `couponmaxx-23` and working.
- Do NOT modify `cart-monitor.js` unless Step 0 SQL proves ingest bug.
- Do NOT invent eventType names. Grep cart-monitor.js before picking.
- Do NOT add date pickers, filters, charts, or CSV export.
- Do NOT run `shopify app dev` or tunneling.
- Do NOT touch `.toml` files.

## Out of scope

- Session drill-down panel.
- Sparkline / time-series charts.
- Per-code analytics.
- Notifications inbox.
