# Cart Page — UX Redesign Spec

## THE PROBLEM WITH THE CURRENT PAGE

Everything has equal visual weight. All sections, all numbers, all chart bars look the same importance. The merchant has to mentally process every section to find the insight. A diagnostic page should answer "what's broken?" in 3 seconds. Right now it takes 30.

## DESIGN PRINCIPLES FOR THIS PAGE

1. **3-second answer**: The single biggest problem must be visible without scrolling, without reading, without thinking.
2. **Red means broken**: ONE color for problems (#D72C0D). Everything else is black/grey. No blue, no teal, no green-for-good. Problems stand out because they're the ONLY color.
3. **Numbers beat charts**: The merchant reads "96 dropped (53%)" faster than interpreting a bar width. Use numbers as the primary data, charts as supporting visual.
4. **Progressive depth**: Top of page = headline finding. Middle = evidence. Bottom = detail. Merchant stops scrolling when they have their answer.
5. **Breathe**: 32px between sections. No section should feel "packed."

## OVERALL PAGE STRUCTURE

```
┌──────────────────────────────────────────────────────────┐
│  SECTION 1: HEADLINE METRIC (the heartbeat)              │
│  One huge number. Is the funnel healthy today or not.     │
├──────────────────────────────────────────────────────────┤
│  SECTION 2: FUNNEL (the evidence)                        │
│  Full funnel with today vs average. Problem step in red.  │
│  + Source breakdown IF a source is broken.                │
├──────────────────────────────────────────────────────────┤
│  SECTION 3: TWO-COLUMN DETAIL                            │
│  Left: Checkout step funnel    Right: Abandoned sessions  │
│  (where in checkout)           (what was last activity)   │
├──────────────────────────────────────────────────────────┤
│  SECTION 4: TIMING                                       │
│  Two charts side-by-side: completed vs abandoned timing   │
│  + Time from ATC to checkout below                        │
├──────────────────────────────────────────────────────────┤
│  SECTION 5: COMPARISON TABLE                             │
│  Converters vs non-converters with highlighted diffs      │
└──────────────────────────────────────────────────────────┘
```

---

## SECTION 1: THE HEADLINE

### Current problem
Three equal-sized KPI boxes. None stands out. You have to read all three and mentally compare.

### New design
ONE large number, centered, taking the full width of the card. This is the cart-to-checkout rate.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│     Cart-to-checkout rate today                          │
│                                                          │
│     22.5%                                                │  ← 48px bold
│                                                          │
│     7-day average: 28.3%  ·  ▼ 5.8pp                    │  ← 14px grey, pp change in red
│                                                          │
│     23 added to cart  →  6 started checkout  →  4 done   │  ← 13px grey, inline
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Sizing:**
- The rate: 48px font, bold, #202223 (black)
- If the rate dropped >5pp vs average: the rate itself turns #D72C0D (red), and the pp change is red
- If the rate is within 5pp: stays black, pp change is grey
- The "7-day average" line: 14px, #6D7175 (grey)
- The raw counts line: 13px, #6D7175 (grey), all on one line with → arrows

**Why this works:** One number. One glance. "22.5% — that's low." Or "22.5% and it's red — something's wrong." The raw counts are there for context but they're secondary.

The two other KPIs (cart sessions count, abandoned count) are REMOVED from the top. They're contextual, not diagnostic. The raw counts in the grey line give you the same information.

---

## SECTION 2: THE FUNNEL

### Current problem
Three small cards with rates between them. The rates are physically smaller than the counts, even though rates are more important. The arrows between cards are decorative, not informative.

### New design
A horizontal table-like layout. Each STEP is a row. The RATE between steps is a connector row with prominent styling.

Actually — simpler. Keep the horizontal flow but flip the hierarchy: rates are BIG, counts are small.

```
┌──────────────────────────────────────────────────────────────────┐
│  Today vs. 7-day average                                         │
│                                                                  │
│  Added to cart          Started checkout        Completed         │
│  ─────────────          ─────────────────       ─────────         │
│  23                     6                       4                 │  ← 28px bold
│  7d avg: 42             7d avg: 9               7d avg: 8         │  ← 13px grey
│  ▼ 45%                  ▼ 33%                   ▼ 50%             │  ← 13px, red if >20%
│                                                                   │
│         26.1%                  66.7%                              │  ← 20px bold
│         avg: 21.4%             avg: 88.9%                        │  ← 13px grey
│         ▲ 4.7pp                ▼ 22.2pp 🔴                       │  ← the rate CHANGE is prominent
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

**Key changes from current:**
1. The RATE between steps (26.1%, 66.7%) is 20px bold — bigger than counts
2. The rate CHANGE (▲ 4.7pp, ▼ 22.2pp) is directly below the rate in red/grey
3. The red dot (🔴) only appears on the rate with the biggest drop — use Polaris `<Badge status="critical">Biggest drop</Badge>` next to it
4. Counts are secondary (smaller font, grey for averages)

**The source breakdown table:**
Stays the same. Only appears if a source dropped >10pp. But add ONE change: put a red background (#FFF4F4) on the entire row for sources that dropped, so it's visually obvious without reading.

---

## SECTION 3: TWO-COLUMN DETAIL

### Current problem
Checkout step funnel and abandoned sessions are full-width stacked sections. Combined they take up a LOT of vertical space. The abandoned sessions chart is broken (dominated by "Left the page").

### New design
Put them SIDE BY SIDE in two columns. This saves vertical space and creates a natural "where they drop in checkout" (left) vs "what they did before leaving the cart" (right) comparison.

#### LEFT COLUMN: Checkout Step Funnel

**Current problem:** All bars are black. You can't tell which step is the problem without reading every number. The drop counts are cut off.

**New design:** 

Instead of uniform black bars, use a WATERFALL approach:
- The bar shows the remaining sessions in dark (#202223)
- The DROP portion at each step is shown as a lighter grey gap
- The step with the biggest drop has its drop number in RED

```
Checkout step funnel
Where customers drop off inside checkout

Started checkout  ████████████████████████████  182 (100%)
Contact info      ████████████████              86  (47%)    -96 dropped 🔴
Address           ██████████████                70  (38%)    -16 dropped
Shipping          █████████████                 69  (38%)    -1 dropped
Payment           ███████████                   53  (29%)    -16 dropped
Completed         █████████                     44  (24%)    -9 dropped
```

**Specific changes:**
- Bar color: #202223 (keep black)
- Drop count: ALWAYS visible, never cut off. Right-aligned in the card. If the card isn't wide enough, the bars must be shorter.
- The step with the LARGEST drop: its "-96 dropped" text is #D72C0D (red) and has a small red dot
- All other drop counts: #6D7175 (grey)
- Add the percentage of total to each row: "(47%)" after the count
- Remove the light grey background bar — it's not adding information

#### RIGHT COLUMN: Last Activity in Abandoned Sessions

**Current problem:** "Left the page" dominates the chart at ~370 out of 455. It's a garbage event — of course they left the page. The chart is useless.

**NEW DATA LOGIC (must change the RPC):**

The `cart_abandoned_last_event` RPC must EXCLUDE these passive events from the "last event" calculation:
- `cart_page_hidden` (this is just "they closed/navigated away" — always happens)
- `cart_viewed` / `cart_fetched` (passive loads, not actions)

Only count ACTIVE events as "last meaningful activity":
- `cart_item_added`
- `cart_item_removed`
- `cart_item_changed`
- `cart_coupon_applied`
- `cart_coupon_failed`
- `cart_bulk_updated`
- `cart_checkout_clicked` (for returned-from-checkout detection)

If a session has NO active events (only passive), bucket it as **"No cart interaction"** — these are people who viewed the cart page but didn't do anything.

**EVENT NAME MAPPING (must update frontend):**

| Raw event | Display label |
|-----------|--------------|
| cart_item_added | Added item to cart |
| cart_item_removed | Removed item from cart |
| cart_item_changed | Changed quantity |
| cart_coupon_failed | Coupon attempt (failed) |
| cart_coupon_applied | Coupon applied |
| cart_bulk_updated | Multiple items updated |
| cart_atc_clicked | Add to cart button clicked |
| returned_from_checkout | Started checkout then returned |
| (no active events) | No cart interaction |

**New visual:** 

SWITCH FROM BAR CHART TO A SIMPLE LIST with counts and percentages. Bar charts are hard to read when one category dominates. A list with numbers is faster to scan.

```
Last activity in abandoned sessions
455 sessions with cart activity that never started checkout

Added item to cart           201   (44.2%)
No cart interaction          112   (24.6%)
Multiple items updated        48   (10.5%)
Coupon attempt (failed)       35   (7.7%)   ← red text
Removed item from cart        28   (6.2%)
Coupon applied                18   (4.0%)
Changed quantity               8   (1.8%)
Started checkout, returned     5   (1.1%)   ← red text
```

**Styling:**
- Simple list, no bars. Each row: label (left), count + percentage (right-aligned)
- "Coupon attempt (failed)" row: count in red (#D72C0D) — this is directly actionable
- "Started checkout, returned" row: count in red — this means something in checkout scared them
- All other rows: #202223 (black)
- Sort by count descending
- Each row has subtle bottom border (#E1E3E5) for visual separation

**Why list instead of bar chart:** When one category is 5-10x larger than others, a bar chart makes the small categories invisible. A list treats every row equally and lets the numbers speak.

---

## SECTION 4: CHECKOUT TIMING

### Current problem
Three charts crammed together. Too much visual noise. The bottom chart ("How long before checking out") overlaps conceptually with the top-left ("Time to complete checkout").

### New design

**REMOVE the third chart** ("How long before checking out" — time from ATC to checkout click). This data is partially redundant with the top-left chart and adds clutter. If the merchant needs this, it can go on a future detailed page.

**Keep the two side-by-side charts** but make them BIGGER. Each chart gets 50% width with proper padding.

**Chart improvements:**
- Bar color: #202223 (keep black) for completed sessions
- Bar color for abandoned: #D72C0D (red). This creates instant visual contrast — "black = good, red = problem"
- Y-axis: Remove the gridlines. Just show the numbers.
- X-axis labels: Keep as-is (< 1 min, 1-3 min, etc.)
- Add a ONE-LINE summary below each chart:
  - Completed: "Median: 1m 42s" (one number, that's it)
  - Abandoned: "Median: 32s" (one number)
- The summary line difference tells the whole story without reading the chart: completers take 1m 42s, abandoners leave in 32 seconds.

```
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ Time to complete checkout     │  │ Time in checkout before       │
│ Sessions that completed       │  │ leaving (abandoned)           │
│                               │  │                               │
│  ▐▐                           │  │  ▐▐▐▐▐▐▐▐                    │
│  ▐▐  ▐▐                       │  │  ▐▐▐▐▐▐▐▐                    │
│  ▐▐  ▐▐  ▐▐                   │  │  ▐▐▐▐▐▐▐▐  ▐▐               │
│  ▐▐  ▐▐  ▐▐  ▐▐  ▐▐          │  │  ▐▐▐▐▐▐▐▐  ▐▐  ▐▐  ▐▐  ▐▐  │
│  <1  1-3 3-5 5-10 10+         │  │  <1  1-3 3-5 5-10 10+        │
│                               │  │                               │
│  Median: 1m 42s               │  │  Median: 32s                  │
└──────────────────────────────┘  └──────────────────────────────┘
                                      ↑ RED BARS (#D72C0D)
```

**Why red bars for abandoned:** The two charts sit side by side. Black bars on the left (good outcome), red bars on the right (bad outcome). The color difference makes the comparison instant — you see the shape difference AND the color tells you which is which without reading the title.

---

## SECTION 5: CONVERTERS VS NON-CONVERTERS

### Current problem
All rows have equal visual weight. "97m 55s" is clearly a data outlier. No way to tell which differences matter.

### New design

**DATA FIX (must change the RPC):**

1. Use MEDIAN instead of AVERAGE for "time in cart." Average is destroyed by outliers (sessions where someone adds to cart, leaves for hours, session ID persists). Median will show the true number (~2-5 minutes, not 97 minutes).

2. Cap session duration at 30 minutes. Any session longer than 30 minutes between events is treated as a new session for timing purposes.

**VISUAL CHANGES:**

Add a third column: the DIFFERENCE between the two groups. This saves the merchant from doing mental math.

```
Converters vs. non-converters
Sessions that started checkout vs. those that added to cart but never did

                        Started checkout    Didn't start    Difference
Sessions                132                 455             —
Median time in cart     2m 08s              3m 45s          +1m 37s
Avg items in cart       1.3                 1.4             +0.1
Avg cart value          $102                $117            +$15
Used a coupon           30.3%               17.1%           +13.2pp  
Coupon failed           37.1%               25.3%           +11.8pp  ← red
Had item removed        10.6%               14.1%           +3.5pp
From UTM traffic        42.4%               52.1%           +9.7pp
On mobile               72.7%               74.5%           +1.8pp
```

**Highlighting rules:**
- If the difference is >10 percentage points or >2x for numeric values: make the Difference cell BOLD and #D72C0D (red)
- If the difference is <3pp or <20% relative: make the Difference cell grey (#6D7175) — it's not significant
- In between: normal black text

In the Dr.Water data, the significant differences would be:
- "Used a coupon" (+13.2pp) — red, bold
- "Coupon failed" (+11.8pp) — red, bold  
- "From UTM traffic" (+9.7pp) — near threshold, maybe red

This instantly tells the merchant: "The biggest behavioral difference between converters and non-converters is coupon usage. Converters use coupons 13pp more and also fail more." That's one glance.

**Column widths:**
- Row label: 40% width
- Started checkout: 20% width, right-aligned
- Didn't start: 20% width, right-aligned
- Difference: 20% width, right-aligned

---

## GLOBAL STYLING RULES

### Colors (the entire page uses only these)
```
#202223  — primary text, chart bars (good/neutral)
#D72C0D  — problems, drops, anomalies (red — Polaris critical)
#6D7175  — secondary text, labels, "normal" differences
#E1E3E5  — borders, dividers
#FFF4F4  — light red background for problem rows in tables
#FFFFFF  — card backgrounds
#F6F6F7  — page background (standard Polaris)
```

NO other colors. No blue. No green. No teal. The restraint is the point — when red appears, it MEANS something.

### Typography
- Section titles: 16px, semi-bold, #202223
- Section subtitles: 13px, regular, #6D7175
- Headline number (Section 1): 48px, bold, #202223 or #D72C0D
- Primary numbers (funnel counts, rates): 20-28px, bold, #202223
- Secondary numbers (averages, changes): 13-14px, regular, #6D7175
- Table cells: 14px, regular, #202223
- Chart axis labels: 12px, regular, #6D7175

### Spacing
- Between sections: 32px
- Card padding: 20px (slightly more than Polaris default 16px)
- Between elements inside a card: 16px

### Cards
- White background, 1px border #E1E3E5, 8px border-radius
- No shadow — flat design matches Polaris
- Full width of the content area

---

## SUMMARY OF CHANGES FROM CURRENT IMPLEMENTATION

### Data/RPC changes:
1. `cart_abandoned_last_event` — EXCLUDE passive events (cart_page_hidden, cart_viewed, cart_fetched) from "last event" detection. Only count active cart events.
2. `cart_converter_comparison` — Change "avg time in cart" to MEDIAN. Cap session duration at 30 minutes.
3. Event name mapping — Add a frontend mapping object that converts raw event names to human-readable labels.

### Layout changes:
1. REMOVE the Conversion/Activity tab toggle — it's now one page, no tabs
2. REPLACE three KPI boxes at top with ONE headline metric (cart-to-checkout rate)
3. REPLACE the product/source/device toggle table (it's useless with current data — shows 0% CTR and $0 values. Bring it back later when we have better data.)
4. MOVE checkout step funnel and abandoned sessions into a TWO-COLUMN layout
5. REMOVE the third timing chart ("How long before checking out"). Keep only the two side-by-side (completed vs abandoned).
6. ADD a "Difference" column to the converters vs non-converters table
7. ADD visual highlighting (red) only on significant deviations

### Visual changes:
1. Bars in abandoned timing chart → RED (#D72C0D) instead of black
2. Biggest drop in checkout funnel → red text + dot
3. Remove bar chart for abandoned sessions → replace with simple numbered list
4. Add red background tint (#FFF4F4) on source rows with significant drops
5. All chart bars: remove gridlines, keep minimal axes
6. Increase whitespace between sections from ~16px to 32px

### Things that are GOOD and should NOT change:
1. Checkout step funnel data (just fix the visual styling)
2. Checkout timing concept (two side-by-side charts)
3. Converters vs non-converters table structure (just add difference column + highlighting)
4. Date picker (works fine)
5. Source breakdown table (works fine, just needs red row highlighting)
6. The "How long before checking out" chart from the old Activity tab — actually keep this one, I changed my mind. Put it BELOW the two timing charts as a third row. It shows time from ATC to checkout click which is different from time inside checkout. Label it clearly: "Time from add-to-cart to checkout click" vs "Time inside checkout."

---

## IMPLEMENTATION ORDER

1. Fix the data issues first (RPC changes for abandoned events + median time)
2. Restructure the page layout (remove tabs, single page, new section order)
3. Apply the styling (colors, typography, spacing)
4. Test on Dr.Water with real data

Build must pass `npx next build` before pushing. Test that no hydration errors occur (all recharts components in 'use client' files).
