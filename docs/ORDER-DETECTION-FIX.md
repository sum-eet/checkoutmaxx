# Fix: Orders Not Detected — CheckoutEvent → Session Outcome

## DO NOT redeploy couponmaxx. Push to main only. Test on Dr.Water.

---

## THE PROBLEM

The session builder determines outcome like this:
```ts
if (row.has_ordered)          outcome = 'ordered';
else if (row.has_checkout_started || row.has_checkout_clicked) outcome = 'checkout';
```

`has_ordered` comes from the `couponmaxx_session_summaries` RPC which ONLY queries `CartEvent`. But order completion events (`checkout_completed`) are in the `CheckoutEvent` table — written by the checkout pixel, not the cart monitor.

**Result:** 0 sessions ever show "Ordered." The user sees 9 real orders in Shopify admin but the app shows 1 or 0.

**SQL proof (user confirmed):**
- CartEvent `cart_checkout_clicked` sessions: 13
- CartEvent `checkout_completed` sessions: 0
- CheckoutEvent rows for same period: 15

---

## STEP 1: Verify CheckoutEvent has order data

Give this to Claude Code to run or ask the user to run in Supabase:

```sql
-- What event types exist in CheckoutEvent for this shop?
SELECT DISTINCT "eventType", COUNT(*) as cnt
FROM "CheckoutEvent"
WHERE "shopId" = (SELECT id FROM "Shop" WHERE "shopDomain" = 'jg2svv-pc.myshopify.com')
AND "occurredAt" >= '2026-03-20T00:00:00Z'
AND "occurredAt" < '2026-03-22T00:00:00Z'
GROUP BY "eventType"
ORDER BY cnt DESC;

-- Do CheckoutEvent rows have sessionId that matches CartEvent sessions?
SELECT ce."sessionId", ce."eventType", ce."occurredAt"
FROM "CheckoutEvent" ce
WHERE ce."shopId" = (SELECT id FROM "Shop" WHERE "shopDomain" = 'jg2svv-pc.myshopify.com')
AND ce."occurredAt" >= '2026-03-20T00:00:00Z'
AND ce."occurredAt" < '2026-03-22T00:00:00Z'
ORDER BY ce."occurredAt" DESC
LIMIT 20;
```

This tells us:
1. What eventTypes CheckoutEvent actually has (e.g., `checkout_completed`, `checkout_started`, `payment_info_submitted`)
2. Whether CheckoutEvent rows have a `sessionId` that can be matched to CartEvent sessions

---

## STEP 2: Fix depends on CheckoutEvent structure

### Option A: CheckoutEvent has sessionId matching CartEvent

If CheckoutEvent rows have a `sessionId` column that matches the cart session IDs, the fix is in the `couponmaxx_session_summaries` RPC.

**Modify the RPC in Supabase SQL editor:**

The current RPC probably has something like:
```sql
bool_or("eventType" IN ('checkout_completed', 'order_completed')) as has_ordered
```
which only looks at CartEvent. Change it to also check CheckoutEvent:

```sql
-- Add a LEFT JOIN or subquery to check CheckoutEvent for completed orders
-- Example: add to the session summary query
COALESCE(
  bool_or(ce."eventType" IN ('checkout_completed', 'order_completed')),
  EXISTS (
    SELECT 1 FROM "CheckoutEvent" cke
    WHERE cke."sessionId" = ce."sessionId"
    AND cke."shopId" = p_shop_id
    AND cke."eventType" IN ('checkout_completed', 'payment_info_submitted')
  )
) as has_ordered
```

BUT — we need to see the actual RPC first. The exact fix depends on the SQL.

### Option B: CheckoutEvent does NOT have matching sessionId

The checkout pixel runs in a different context (Shopify checkout) than the cart monitor (storefront). They may not share session IDs. If session IDs don't match, we need to correlate by:
- Same shopId + similar timestamp (within 30 min)
- OR same checkout token / order ID

This is more complex. We'd need to:
1. Get all CheckoutEvent rows with `checkout_completed` for the date range
2. For each, find the CartEvent session that had `cart_checkout_clicked` within 30 min before
3. Mark that session as 'ordered'

### Option C: Write CartEvent row from pixel ingest (simplest long-term fix)

**File:** `app/api/pixel/ingest/route.ts`

When the pixel ingest route receives a `checkout_completed` event, also write a `CartEvent` row with `eventType: 'checkout_completed'`. This way the session builder finds it naturally.

Find the pixel ingest handler and add:

```ts
// After writing to CheckoutEvent table, ALSO write to CartEvent
// so the session builder can detect order completion

if (event.eventType === 'checkout_completed' || event.eventType === 'payment_info_submitted') {
  // Try to find the matching cart session
  // The checkout event should have a checkout token or we match by shopId + recent time
  
  // Write a CartEvent row
  await supabase.from('CartEvent').insert({
    shopId: shop.id,
    sessionId: event.sessionId || `checkout_${event.checkoutToken || Date.now()}`,
    eventType: 'checkout_completed',
    occurredAt: new Date().toISOString(),
    // Copy relevant fields
    cartValue: event.totalPrice || null,
    country: event.country || null,
    device: event.device || null,
  });
}
```

**The exact implementation depends on what fields CheckoutEvent has.** We need to see:
1. The CheckoutEvent table schema
2. The pixel ingest route code
3. Whether sessionId is shared between cart monitor and checkout pixel

---

## STEP 3: What to give Claude Code RIGHT NOW

Since we don't know the CheckoutEvent schema yet, give Claude Code this task:

```
TASK: Diagnose and fix why "Ordered" outcome never appears in Cart Sessions.

CONTEXT:
- CartEvent has 0 rows with eventType='checkout_completed' for any session
- CheckoutEvent table has 15 rows for Mar 20-21 (from checkout pixel)
- The session builder (couponmaxx_session_summaries RPC) only reads CartEvent
- Shopify admin shows 9 orders for Mar 20-21 but the app shows 0-1 "Ordered" sessions

STEPS:
1. Read app/api/pixel/ingest/route.ts — understand what events the checkout pixel sends and what table they write to
2. Read the CheckoutEvent table schema (check prisma/schema.prisma)
3. Run SQL to check if CheckoutEvent has sessionId that matches CartEvent sessionIds
4. If yes: modify the couponmaxx_session_summaries RPC to JOIN CheckoutEvent when determining has_ordered
5. If no: modify app/api/pixel/ingest/route.ts to ALSO write a CartEvent row with eventType='checkout_completed' when a checkout_completed event is received, matching to the nearest cart session by shopId + timestamp

VERIFY:
- After fix, re-query: sessions with outcome='ordered' should be >= 9 for Mar 20-21
- The "Reached Checkout" filter should show both "Checkout" and "Ordered" outcomes
- npx next build must succeed
- Test on Dr.Water after push

DO NOT:
- Modify shopify.app.toml
- Modify extensions/ files
- Redeploy couponmaxx on Vercel
- Delete any file in app/api/webhooks/ or app/api/auth/
```

---

## STEP 4: Verify after fix

```sql
-- After the fix is deployed and some time has passed (or after triggering test orders):

-- Sessions with ordered outcome:
SELECT COUNT(DISTINCT "sessionId")
FROM "CartEvent"
WHERE "shopId" = (SELECT id FROM "Shop" WHERE "shopDomain" = 'jg2svv-pc.myshopify.com')
AND "occurredAt" >= '2026-03-20T00:00:00Z'
AND "occurredAt" < '2026-03-22T00:00:00Z'
AND "eventType" = 'checkout_completed';
-- Should be > 0 after fix

-- Or check via the API:
-- GET https://checkoutmaxx-rt55.vercel.app/api/couponmaxx/sessions?shop=jg2svv-pc.myshopify.com&start=2026-03-20T00:00:00Z&end=2026-03-22T00:00:00Z&outcome=ordered
-- Should return sessions with outcome='ordered'
```

---

## NOTE ON HISTORICAL DATA

The fix will only work for NEW orders going forward (Option C) or for orders that already have CheckoutEvent rows (Option A/B). Historical CartEvent data won't retroactively get 'ordered' outcomes unless you run a backfill script that reads CheckoutEvent and writes corresponding CartEvent rows.

A backfill script (optional, run once after fix):
```sql
-- Only needed if using Option C (writing CartEvent from pixel ingest)
-- This backfills historical orders from CheckoutEvent into CartEvent

INSERT INTO "CartEvent" ("shopId", "sessionId", "eventType", "occurredAt", "cartValue", "country", "device")
SELECT 
  cke."shopId",
  COALESCE(cke."sessionId", 'checkout_' || cke.id),
  'checkout_completed',
  cke."occurredAt",
  cke."totalPrice",
  cke."country",
  cke."device"
FROM "CheckoutEvent" cke
WHERE cke."eventType" IN ('checkout_completed', 'payment_info_submitted')
AND NOT EXISTS (
  SELECT 1 FROM "CartEvent" ce
  WHERE ce."sessionId" = cke."sessionId"
  AND ce."eventType" = 'checkout_completed'
);
```

Run this AFTER the code fix is deployed and verified. It will retroactively mark historical sessions as 'ordered'.
