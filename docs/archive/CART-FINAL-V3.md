# Cart Page — Final Spec

## Rule: The date picker controls EVERYTHING. No "today" anywhere. If picker says Mar 19-26, all data is Mar 19-26.

---

## SECTION 1: FUNNEL

Kill the headline card. Kill "today vs 7-day." Replace with ONE visual.

**Visual: Proportional horizontal bars for the selected date range.**

```
Added to cart     ████████████████████████████████████  587
                           22.5% →
Started checkout  ████████                              132
                           33.3% →
Completed         ███                                    44
```

Bar widths are proportional. 587 = full width. 132 = 22.5% width. 44 = 7.5% width. You SEE the drop.

Between bars: the conversion rate. That's it. No averages, no pp, no arrows.

**If a rate dropped >5pp vs prior period of same length:** that rate turns red. One word appears next to it: "(was 88.9%)". Nothing else.

```
                           33.3% → (was 88.9%)    ← red
```

**Below funnel, only if a UTM source dropped >10pp:**
One red line: `google / product_sync: 0% checkout rate (was 25%)`

If nothing dropped, nothing shows. Clean.

---

## SECTION 2 + 3: TWO COLUMNS

**Left: Checkout step funnel**

Same proportional bars. Biggest drop in red.

```
Started          ████████████████████████████  89   100%
Contact info     ██████████████                44    49%    -45 ●
Address          ████████████                  34    38%    -10
Shipping         ███████████                   33    37%     -1
Payment          █████████                     26    29%     -7
Completed        ███████                       22    25%     -4
```

Only the largest drop number is red with a red dot. Everything else grey.

**Right: Last activity before abandoning**

Simple list. NO bar chart.

FIX THE RPC: exclude `cart_page_hidden`, `cart_viewed`, `cart_fetched`. Only active events.

```
227 sessions never started checkout

Added an item              98   43.2%
Browsed cart only          64   28.2%
Updated cart               25   11.0%
Coupon failed              18    7.9%  ← red
Removed an item            12    5.3%
Applied coupon              6    2.6%
Changed quantity            3    1.3%
Returned from checkout      1    0.4%  ← red
```

"Coupon failed" and "Returned from checkout" counts in red. Everything else black.

Map ALL raw event names to human labels. No `cart_page_hidden` or `cart_bulk_updated` visible.

---

## SECTION 4: TIMING

Two charts side by side. Nothing else.

**Left: "Completed checkouts"** — BLACK bars. Below: "Median: 1m 42s"
**Right: "Abandoned checkouts"** — RED bars. Below: "Median: 32s"

Remove the third chart. No gridlines. No borders.

---

## SECTION 5: CONVERTERS VS NON-CONVERTERS

FIX: MEDIAN for time. Cap at 30 min.

```
                        Checked out    Didn't
Sessions                132            455
Median time in cart     2m 08s         3m 45s
Avg items               1.3            1.4
Avg cart value           $102           $117
Used a coupon           30.3%          17.1%     ← red border, +13pp
Coupon failed           37.1%          25.3%     ← red border, +12pp
Had item removed        10.6%          14.1%
From UTM traffic        42.4%          52.1%
On mobile               72.7%          74.5%
```

Rows with >10pp difference: red left border + pp badge.

---

## 3 RPC FIXES

1. **`cart_abandoned_last_event`**: Exclude `cart_page_hidden`, `cart_viewed`, `cart_fetched`. No-active-events sessions = "Browsed cart only"

2. **`cart_converter_comparison`**: `PERCENTILE_CONT(0.5)` for time. Cap `<= 1800` seconds.

3. **Funnel RPC**: Returns selected range data + prior period of same length for comparison. Not "today vs 7d."

## EVENT LABELS

```typescript
const EVENT_LABELS: Record<string, string> = {
  'cart_item_added': 'Added an item',
  'cart_item_removed': 'Removed an item',
  'cart_item_changed': 'Changed quantity',
  'cart_coupon_failed': 'Coupon failed',
  'cart_coupon_applied': 'Applied coupon',
  'cart_bulk_updated': 'Updated cart',
  'cart_atc_clicked': 'Clicked add to cart',
  'returned_from_checkout': 'Returned from checkout',
  'browsed_cart_only': 'Browsed cart only',
};
```

## COLORS

- #202223: text, good bars
- #D72C0D: problems only
- #6D7175: secondary
- #FFF4F4: problem row backgrounds

## BUILD ORDER

1. Fix 3 RPCs → 2. Proportional funnel → 3. Two-column (steps + abandoned list) → 4. Red/black timing charts → 5. Comparison table → 6. Build + test + push
