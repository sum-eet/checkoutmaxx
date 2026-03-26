# CheckoutMaxx — Complete Test Plan
> Execute in order. Each test builds state for the next.
> Store: drwater.store | App: checkoutmaxx-rt55.vercel.app
> DB: Supabase — have CartEvent and CheckoutEvent tables open in a side tab throughout.
> Coupon for T6: CREDIT565 = $17.63 off orders over $60

---

## PRE-TEST SETUP

Before starting:
1. Open drwater.store in an incognito window (fresh session, no existing cart)
2. Open checkoutmaxx-rt55.vercel.app → Cart Activity tab
3. Open Supabase → Table editor → CartEvent table (sorted by createdAt DESC)
4. Open Supabase → Table editor → CheckoutEvent table (sorted by createdAt DESC)
5. Note the current time — you'll use it to filter "events after X" in Supabase

Keep all four tabs open simultaneously throughout testing.

---

## T1 — Page Load Performance

**What we're testing:** Cache behaviour, load time, Refresh button.

**Steps:**
1. Navigate to Cart Activity tab cold (first load)
2. Start a stopwatch when you click the tab
3. Note when the page fully renders (KPI cards + table visible)
4. Navigate to Converted Carts tab, then back to Cart Activity within 60 seconds
5. Click the Refresh button

**Expected:**
- Cold load: <3 seconds
- Return within 60s: near-instant (cache hit, no spinner)
- After Refresh: spinner appears briefly, data re-fetches

**DB check:** None for this test.

**Pass criteria:**
- [ ] Cold load <3s
- [ ] Cache return is visibly faster than cold load
- [ ] Refresh button triggers a visible re-fetch

---

## T2 — Cart Item Added + Products Column

**What we're testing:** `cart_item_added` event writes correctly, lineItems populated,
Products column shows product name not "X items".

**Steps:**
1. On drwater.store (incognito), add **HydroPitcher 68oz** to cart (1 unit, $124.99)
2. Wait 5 seconds
3. Click Refresh on Cart Activity

**Expected in dashboard:**
- New session row appears in Sessions tab
- Time column: current time (within a minute)
- Products column: "HydroPitcher 68oz – Glass Hydrogen Water Pitcher ×1" (NOT "1 items")
- Cart value: $124.99
- Coupons: — (none attempted)
- Outcome: Abandoned (grey)

**DB check — CartEvent table:**
```
Filter: sessionId = [the session from the new row]
Expected rows:
  - eventType: cart_item_added
  - cartValue: 12499
  - cartItemCount: 1
  - lineItems: [{"productTitle": "HydroPitcher 68oz...", "price": 12499, "quantity": 1, ...}]
  - couponCode: null
  - couponSuccess: null
```

**Cross-validate:**
- Cart value in dashboard ($124.99) = cartValue in DB (12499 cents) ✓
- Product name in dashboard = lineItems[0].productTitle in DB ✓

**Pass criteria:**
- [ ] Session row appears after Refresh
- [ ] Products column shows product name, not item count
- [ ] cartValue in DB = 12499
- [ ] lineItems in DB is populated array (not null, not [])
- [ ] No cart_fetched rows in DB for this session

---

## T3 — Cart Item Removed

**What we're testing:** `cart_item_removed` writes correctly, timeline order correct.

**Steps:**
1. Continuing from T2 (same session, same incognito window)
2. Remove the HydroPitcher from cart (click the trash icon)
3. Wait 5 seconds
4. Click Refresh on Cart Activity
5. Click View on the session row to open timeline modal

**Expected in timeline modal:**
```
[time]  Cart    Added item to cart          Cart: $124.99
[time]  Cart    Removed item                Cart: $0.00
```
Events in chronological order, earliest first.

**DB check — CartEvent table:**
```
Filter: sessionId = [same session]
Expected new row:
  - eventType: cart_item_removed
  - cartValue: 0
  - cartItemCount: 0
```

**Cross-validate:**
- Timeline order in dashboard matches occurredAt order in DB ✓
- Cart value after removal = $0 in both dashboard and DB ✓

**Pass criteria:**
- [ ] cart_item_removed row exists in DB
- [ ] Timeline shows Added then Removed in correct order
- [ ] No duplicate events (each action = 1 row, not 2-3)

---

## T4 — Coupon Failed (Invalid Code)

**What we're testing:** `cart_coupon_failed` fires for a code that doesn't exist.
Deduplication works (1 event per attempt, not 3-4).

**Steps:**
1. Add HydroPitcher back to cart (fresh add in same incognito window)
2. Open the "Coupons and offers" section in the cart drawer
3. Type **ZZZZTEST99** and click Apply
4. Wait 5 seconds
5. Click Refresh on Cart Activity
6. Click View on the session row

**Expected in dashboard:**
- Coupons column: red pill labelled "ZZZZTEST99" (no discount amount)
- Timeline shows: "Tried coupon ZZZZTEST99 — Not applicable"

**DB check — CartEvent table:**
```
Filter: sessionId = [same session], eventType = cart_coupon_failed
Expected: EXACTLY 1 row (not 2, not 3)
  - couponCode: "ZZZZTEST99"
  - couponSuccess: false
  - couponRecovered: null
  - discountAmount: null
  - cartValue: 12499
```

**Also check — no false HYDRATEFIRST events:**
```
Filter: sessionId = [same session], couponCode = "HYDRATEFIRST"
Expected: 0 rows
```
HYDRATEFIRST is an automatic discount on drwater that appears in every
/cart/update response with applicable: false. It must NOT generate a
cart_coupon_failed event.

**Cross-validate:**
- Coupon pill colour in dashboard (red) = couponSuccess: false in DB ✓
- Exactly 1 failed event in DB despite multiple rapid /cart/update requests ✓

**Pass criteria:**
- [ ] Red ZZZZTEST99 pill appears in Sessions tab
- [ ] Timeline shows failed coupon event
- [ ] Exactly 1 cart_coupon_failed row in DB for ZZZZTEST99
- [ ] Zero rows with couponCode = "HYDRATEFIRST" in DB

---

## T5 — Coupon Applied (Valid Code)

**What we're testing:** `cart_coupon_applied` fires correctly, discount amount
captured in cents, green pill with discount amount shown.

**Steps:**
1. Continuing same session, cart has HydroPitcher ($124.99)
2. Clear the discount field (remove ZZZZTEST99 if still there)
3. Type **PITCHER15** and click Apply
   (This is the 15% off pitcher code — should apply ~$15 off $124.99 = ~$18.75 off)
4. Wait 5 seconds
5. Click Refresh on Cart Activity
6. Check Sessions tab and Coupon Intelligence tab

**Expected in dashboard — Sessions tab:**
- Coupons column: green pill "PITCHER15 −$18.75" (or whatever the exact amount is)
- Cart value column: updated to $106.24 (or actual discounted value)

**Expected in dashboard — Coupon Intelligence tab:**
- PITCHER15 row: attempts ≥ 1, success rate 100% (or >0%), avg cart value ~$124.99

**DB check — CartEvent table:**
```
Filter: sessionId = [same session], eventType = cart_coupon_applied
Expected: 1 row
  - couponCode: "PITCHER15"
  - couponSuccess: true
  - discountAmount: [value in cents matching what cart showed]
  - cartValue: [post-discount total in cents]
```

**Cross-validate:**
- discountAmount in DB (cents) ÷ 100 = discount shown in green pill in dashboard ✓
- cartValue in DB (cents) ÷ 100 = cart total shown in dashboard ✓
- Coupon Intelligence tab attempts count = count of cart_coupon_applied +
  cart_coupon_failed rows for PITCHER15 in DB ✓

**Pass criteria:**
- [ ] Green PITCHER15 pill with correct discount amount
- [ ] couponSuccess: true in DB
- [ ] discountAmount in DB matches pill amount (divide by 100)
- [ ] PITCHER15 appears in Coupon Intelligence tab
- [ ] Success rate in Coupon Intelligence = 100% if this is first attempt

---

## T6 — Coupon Recovered (The Key Scenario)

**What we're testing:** Customer tries CREDIT565, fails (cart below $60 min),
adds items to meet minimum, code unlocks. `cart_coupon_recovered` fires.
This is the unique value prop of CheckoutMaxx.

**Setup:** CREDIT565 = $17.63 off orders over $60.

**Steps:**
1. Open a **new incognito window** (fresh session)
2. Add only 1 item worth LESS than $60 to cart
   (need a product under $60 — check drwater for something appropriate,
   or if all products are over $60, use quantity 1 of the cheapest item
   and note that the test may need CREDIT565 applied at a cart value
   that IS above $60 — adjust accordingly)

   **IF all drwater products are over $60:** Skip to step 3 with HydroPitcher,
   but note CREDIT565 should apply. In this case use BRRRRR or another known
   invalid code for the "fail" state, then use CREDIT565 as T5-style success.
   Document what actually happened.

3. Type **CREDIT565** in discount field, click Apply
4. Wait 3 seconds — verify error message shows on cart ("Discount code cannot
   be applied to your cart" or similar)
5. Now add more items to bring cart over $60 (add another product)
6. Wait 5 seconds — the theme should auto-retry CREDIT565 on the next /cart/update
7. Click Refresh on Cart Activity

**Expected in dashboard:**
- Coupons column: "↑ CREDIT565 −$17.63" green pill (the ↑ prefix indicates recovered)
- Recovered revenue banner visible: "X customers unlocked a discount by adding items
  after a failed coupon — $X in recovered cart value today"

**Expected in timeline modal:**
```
[time]  Cart    Added item to cart              Cart: $XX.XX
[time]  Cart    Tried coupon CREDIT565          Not applicable
[time]  Cart    Added item to cart              Cart: $XX.XX  (bringing over $60)
[time]  Cart    Coupon CREDIT565 unlocked       Added items to qualify — saved $17.63
```

**DB check — CartEvent table:**
```
Filter: sessionId = [new session], couponCode = "CREDIT565"
Expected rows (in order):
  Row 1:
    - eventType: cart_coupon_failed
    - couponSuccess: false
    - couponRecovered: null
  Row 2:
    - eventType: cart_coupon_recovered
    - couponSuccess: true
    - couponRecovered: true
    - discountAmount: 1763
```

**Cross-validate:**
- discountAmount in DB: 1763 cents = $17.63 shown in dashboard ✓
- couponRecovered: true in DB = ↑ prefix on pill in dashboard ✓
- recoveredRevenue in KPI banner = sum of cartValue where couponRecovered=true for today ✓

**Pass criteria:**
- [ ] cart_coupon_failed row exists for CREDIT565
- [ ] cart_coupon_recovered row exists for CREDIT565
- [ ] couponRecovered: true in DB
- [ ] discountAmount: 1763 in DB
- [ ] ↑ prefix on pill in dashboard
- [ ] Recovered revenue banner appears
- [ ] Timeline shows the full sequence in correct order

---

## T7 — Coupon Removed

**What we're testing:** `cart_coupon_removed` fires when customer removes an
applied code.

**Steps:**
1. Continuing from T5 or T6 session (PITCHER15 or CREDIT565 applied)
2. Click the X next to the applied coupon code in the cart drawer
3. Wait 5 seconds
4. Click Refresh, open timeline modal

**Expected in timeline:**
```
[time]  Cart    Applied coupon PITCHER15    Saved $18.75
[time]  Cart    Removed coupon PITCHER15
```

**DB check:**
```
Filter: sessionId = [session], eventType = cart_coupon_removed
Expected: 1 row
  - couponCode: "PITCHER15" (or whichever code was removed)
  - couponSuccess: null
```

**Pass criteria:**
- [ ] cart_coupon_removed row in DB
- [ ] Timeline shows "Removed coupon" after "Applied coupon"

---

## T8 — Rebuy Noise (No False Coupon Events)

**What we're testing:** Rebuy's `/cart/update.js` attribute updates do NOT
generate false coupon events. These fire constantly on drwater.

**Steps:**
1. Add an item to cart (triggers Rebuy Smart Cart 2.0 attribution update)
2. Wait 10 seconds (Rebuy fires multiple times)
3. Check DB

**DB check:**
```
Filter: sessionId = [current session], eventType LIKE 'cart_coupon_%'
Expected: 0 rows from Rebuy-triggered updates

Also check:
Filter: sessionId = [current session], eventType = 'cart_bulk_updated'
Expected: rows exist (Rebuy updates go here) but none have couponCode populated
```

**Pass criteria:**
- [ ] No cart_coupon_* rows triggered by Rebuy attribute updates
- [ ] cart_bulk_updated rows exist for Rebuy updates (confirming they're captured)
- [ ] couponCode is null on all cart_bulk_updated rows

---

## T9 — Checkout Clicked

**What we're testing:** `cart_checkout_clicked` fires, Outcome column updates
to "Checkout" (amber).

**Steps:**
1. Have an item in cart
2. Click "Checkout Securely" button in cart drawer
3. You will be taken to Shopify checkout — stop there (don't complete)
4. Go back to drwater, wait 5 seconds
5. Click Refresh on Cart Activity

**Expected in dashboard:**
- Outcome column: amber "Checkout" badge

**DB check:**
```
Filter: sessionId = [session], eventType = cart_checkout_clicked
Expected: 1 row
  - cartToken: populated
  - cartValue: populated
```

**Cross-validate:**
- Outcome "Checkout" in dashboard = cart_checkout_clicked exists in DB
  AND no checkout_completed in CheckoutEvent for this sessionId ✓

**Pass criteria:**
- [ ] Amber "Checkout" badge in Outcome column
- [ ] cart_checkout_clicked row in DB with cartToken populated

---

## T10 — Full Funnel (Cart → Checkout → Order)

**What we're testing:** Complete purchase. Cart events + Web Pixel checkout
events stitch together in timeline. Outcome shows "Ordered".

**Steps:**
1. Open a new incognito window (fresh session)
2. Add HydroPitcher to cart
3. Apply PITCHER15
4. Click Checkout Securely
5. Complete the full purchase (use a test card: 4242 4242 4242 4242,
   any future expiry, any CVV, any billing zip)
6. Wait 10 seconds after order confirmation
7. Click Refresh on Cart Activity
8. Find the session row, click View

**Expected in dashboard — Sessions tab:**
- Outcome: green "Ordered" badge

**Expected in timeline modal (full stitched journey):**
```
[time]  Cart      Added item to cart              Cart: $124.99
[time]  Cart      Applied coupon PITCHER15        Saved $18.75
[time]  Cart      Clicked checkout
[time]  Checkout  Reached checkout
[time]  Checkout  Filled contact info
[time]  Checkout  Filled shipping address
[time]  Checkout  Selected shipping method
[time]  Checkout  Entered payment
[time]  Checkout  Order completed ✓
```
All in chronological order, Cart events in grey badge, Checkout events in
blue "Checkout" badge.

**DB check — CartEvent:**
```
Filter: sessionId = [session]
Expected events: cart_item_added, cart_coupon_applied, cart_checkout_clicked
```

**DB check — CheckoutEvent:**
```
Filter: sessionId = [SAME sessionId]
Expected events: checkout_started, checkout_contact_info_submitted,
  checkout_address_info_submitted, checkout_shipping_info_submitted,
  payment_info_submitted, checkout_completed
```

**Cross-validate:**
- sessionId in CartEvent = sessionId in CheckoutEvent ✓ (this is the critical join)
- checkout_completed in CheckoutEvent = "Ordered" in dashboard ✓
- Timeline events sorted by occurredAt across both tables ✓
- No gaps in timeline (cart events come before checkout events chronologically) ✓

**If sessionId does NOT match between tables:**
This means the session was lost between cart and checkout (e.g. checkout opened
in new tab, or sessionStorage was cleared). Document exactly what happened.
This is a known risk and needs to be understood.

**Pass criteria:**
- [ ] Green "Ordered" badge in Outcome column
- [ ] Cart events AND Checkout events both appear in timeline modal
- [ ] sessionId matches between CartEvent and CheckoutEvent in DB
- [ ] Timeline is in correct chronological order
- [ ] "Order completed ✓" is the last event

---

## T11 — Session Timeline Modal (UI Validation)

**What we're testing:** Modal renders correctly, badge colours correct,
cart vs checkout events distinguished.

**Steps:**
1. From T10, click View on the completed order session

**Expected:**
- Cart events: grey/default badge labelled "Cart"
- Checkout events: blue "Checkout" badge
- Positive events (applied, completed): green text
- Negative events (failed coupon): red text
- Neutral events (added item, clicked checkout): default text
- Products section: shows product name, quantity, price
- Summary row: shows cart value, item count, outcome

**Pass criteria:**
- [ ] Cart vs Checkout badges visually distinct
- [ ] Positive/negative text colours correct
- [ ] Products populated in modal header
- [ ] Events in correct time order
- [ ] Modal closes cleanly with X

---

## T12 — Coupon Intelligence Tab (30-day)

**What we're testing:** Aggregate stats correct, cross-validated against DB.

**Steps:**
1. Click "Coupon Intelligence" tab on Cart Activity page
2. Note the numbers for each code you tested today
3. Query DB to verify

**Expected codes to appear:** ZZZZTEST99, PITCHER15, CREDIT565 (at minimum)

**DB verification query (run in Supabase SQL editor):**
```sql
SELECT
  "couponCode",
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE "couponSuccess" = true) as successes,
  COUNT(*) FILTER (WHERE "couponRecovered" = true) as recoveries,
  AVG("cartValue") as avg_cart_value_cents
FROM "CartEvent"
WHERE "couponCode" IS NOT NULL
  AND "occurredAt" > NOW() - INTERVAL '30 days'
  AND "eventType" IN ('cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered')
GROUP BY "couponCode"
ORDER BY total_events DESC;
```

**Cross-validate each row:**
- Dashboard "Attempts" = total_events from query ✓
- Dashboard "Success rate" = (successes / total_events) × 100 ✓
- Dashboard "Avg cart value" = avg_cart_value_cents ÷ 100 ✓
- Dashboard "Unlocked after fail" count = recoveries from query ✓

**Pass criteria:**
- [ ] All codes from today's tests appear
- [ ] Attempts count matches DB query
- [ ] Success rate % matches manual calculation from DB
- [ ] Avg cart value matches DB (within $0.01 rounding)
- [ ] Recovered count matches DB

---

## T13 — KPI Cards Cross-Validation

**What we're testing:** The three KPI cards at the top of Cart Activity
show numbers that match DB counts exactly.

**DB verification query:**
```sql
-- Carts opened today (distinct sessions)
SELECT COUNT(DISTINCT "sessionId") as carts_opened
FROM "CartEvent"
WHERE DATE("occurredAt") = CURRENT_DATE;

-- Carts with coupon attempt today
SELECT COUNT(DISTINCT "sessionId") as carts_with_coupon
FROM "CartEvent"
WHERE DATE("occurredAt") = CURRENT_DATE
  AND "eventType" IN ('cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered');

-- Carts that reached checkout today
SELECT COUNT(DISTINCT "sessionId") as carts_checked_out
FROM "CartEvent"
WHERE DATE("occurredAt") = CURRENT_DATE
  AND "eventType" = 'cart_checkout_clicked';

-- Recovered carts + revenue today
SELECT
  COUNT(DISTINCT "sessionId") as recovered_carts,
  SUM("cartValue") as recovered_revenue_cents
FROM "CartEvent"
WHERE DATE("occurredAt") = CURRENT_DATE
  AND "eventType" = 'cart_coupon_recovered';
```

**Cross-validate:**
- "Carts opened" card = carts_opened from query ✓
- "Coupon attempted" card = carts_with_coupon from query ✓
- "Reached checkout" card = carts_checked_out from query ✓
- Recovered revenue banner amount = recovered_revenue_cents ÷ 100 ✓

**Pass criteria:**
- [ ] All 3 KPI cards match DB queries exactly
- [ ] Recovered revenue banner amount matches DB sum
- [ ] Coupon % sub-label (e.g. "58% of carts") = (carts_with_coupon / carts_opened) × 100

---

## T14 — Existing Dashboard Sanity Check

**What we're testing:** The existing Converted and Abandoned Carts pages
still work correctly after Phase 3 changes.

**Steps:**
1. Navigate to Converted Carts
2. Verify funnel numbers are coherent (Completed ≤ Started)
3. Navigate to Abandoned Carts
4. Verify drop-off % badges are showing
5. Navigate to Notifications
6. Verify page loads without errors

**DB check (CheckoutEvent — not touched by Phase 3):**
```sql
SELECT "eventType", COUNT(*) as count
FROM "CheckoutEvent"
WHERE DATE("occurredAt") = CURRENT_DATE
GROUP BY "eventType"
ORDER BY count DESC;
```

**Cross-validate:**
- checkout_completed count ≤ checkout_started count ✓
- Numbers in Converted Carts page match checkout_completed / checkout_started
  ratio in DB ✓

**Pass criteria:**
- [ ] Converted Carts page loads and shows data
- [ ] Abandoned Carts page loads and shows data
- [ ] Notifications page loads without errors
- [ ] checkout_completed ≤ checkout_started in DB

---

## T15 — DB Hygiene Audit

**What we're testing:** The DB contains only clean, expected data.
No noise events, no PII, no malformed rows.

**Run these queries in Supabase SQL editor:**

```sql
-- 1. Should return 0 — no noise events in DB
SELECT COUNT(*) as noise_events
FROM "CartEvent"
WHERE "eventType" IN ('cart_fetched', 'cart_fetch_error',
  'cart_non_json_response', 'cart_xhr_parse_error', 'cart_unknown_endpoint');

-- 2. Should return 0 — no PII fields (no customer names, emails)
-- (verify lineItems column doesn't contain email/name fields)
SELECT id, "lineItems"
FROM "CartEvent"
WHERE "lineItems" IS NOT NULL
LIMIT 5;
-- Manually inspect: should only see productId, variantId, productTitle, price, quantity

-- 3. Should return 0 — no raw query params in pageUrl (could contain discount codes)
SELECT COUNT(*) as urls_with_params
FROM "CartEvent"
WHERE "pageUrl" LIKE '%?%';

-- 4. Coupon events should all have couponCode populated
SELECT COUNT(*) as coupon_events_without_code
FROM "CartEvent"
WHERE "eventType" LIKE 'cart_coupon_%'
  AND "couponCode" IS NULL;

-- 5. Check cartToken is populated on checkout click events
SELECT COUNT(*) as checkout_clicks_without_token
FROM "CartEvent"
WHERE "eventType" = 'cart_checkout_clicked'
  AND ("cartToken" IS NULL OR "cartToken" = '');

-- 6. Verify no duplicate coupon events per session per code
-- (should return 0 rows with count > 1 for failed events)
SELECT "sessionId", "couponCode", COUNT(*) as cnt
FROM "CartEvent"
WHERE "eventType" = 'cart_coupon_failed'
GROUP BY "sessionId", "couponCode"
HAVING COUNT(*) > 1;
```

**Pass criteria:**
- [ ] Query 1: 0 noise events
- [ ] Query 2: lineItems contain only product fields, no PII
- [ ] Query 3: 0 pageUrls with query params
- [ ] Query 4: 0 coupon events without couponCode
- [ ] Query 5: 0 checkout clicks without cartToken
- [ ] Query 6: 0 duplicate coupon_failed events per session per code

---

## RESULTS TRACKER

Fill this in as you go:

| Test | Pass | Fail | Notes |
|---|---|---|---|
| T1 — Page load performance | | | |
| T2 — Cart item added + products column | | | |
| T3 — Cart item removed | | | |
| T4 — Coupon failed (ZZZZTEST99) | | | |
| T4a — HYDRATEFIRST not in DB | | | |
| T4b — Dedup (exactly 1 row) | | | |
| T5 — Coupon applied (PITCHER15) | | | |
| T6 — Coupon recovered (CREDIT565) | | | |
| T7 — Coupon removed | | | |
| T8 — Rebuy noise (no false events) | | | |
| T9 — Checkout clicked | | | |
| T10 — Full funnel (cart → order) | | | |
| T10a — sessionId join integrity | | | |
| T11 — Timeline modal UI | | | |
| T12 — Coupon Intelligence tab | | | |
| T13 — KPI cards cross-validation | | | |
| T14 — Existing dashboard sanity | | | |
| T15 — DB hygiene audit | | | |

---

## KNOWN RISKS TO WATCH FOR

**SessionId join (T10):** If checkout opens in a new tab or Shopify's checkout
is on a subdomain that clears sessionStorage, the CartEvent.sessionId will NOT
match CheckoutEvent.sessionId. If T10 fails on join integrity, document:
- Did checkout events appear in DB at all?
- Was the sessionId in CheckoutEvent completely different?
- Or was CheckoutEvent empty (pixel not firing)?

**HYDRATEFIRST (T4):** This automatic discount is always present in drwater's
/cart/update responses with applicable: false. If T4 shows HYDRATEFIRST rows
in DB, the dedup logic has a bug — the code was already known when the first
real cart_fetched happened and should not have been treated as a new attempt.

**CREDIT565 minimum (T6):** All drwater products are $109+, which is above
the $60 minimum. This means CREDIT565 will succeed immediately on the first
attempt without a failure → recovery sequence. If this happens:
- T6 becomes a T5-style success test only
- cart_coupon_recovered will never fire in this scenario
- To properly test T6, you need to either: (a) create a product under $60 on
  drwater, or (b) create a new discount code with a minimum higher than the
  cheapest product's price (e.g. min $500 order)

**Rapid-fire dedup:** The theme fires 2-4 /cart/update requests per Apply click.
The `lastDiscountPayload` guard deduplicates by the discount field string.
If the same code is tried twice in a session (removed and re-added), the second
attempt may be silently dropped if lastDiscountPayload isn't reset on removal.
Watch for this in T7 → re-apply scenario.
