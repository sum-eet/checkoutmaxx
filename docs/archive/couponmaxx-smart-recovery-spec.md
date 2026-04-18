# CouponMaxx — Smart Recovery Spec
> Feature: Inline coupon failure recovery on storefront
> Appended to existing couponmaxx spec set.
> Do not modify any existing routes or components unless noted.

---

## WHAT THIS IS

When a customer enters a coupon code and it fails, CouponMaxx currently
tracks the failure silently. The merchant sees it in the dashboard later.
The customer sees Shopify's default "Enter a valid discount code" error
and either tries another code, pays full price, or leaves.

Smart Recovery changes the failure moment from a dead end into a
recovery opportunity. The storefront error message is enriched with
a contextual, rule-driven response that either explains the failure
and offers a fix, or presents a recovery code.

No modals. No toasts. No pop-ups. The recovery message replaces or
extends the existing Shopify error message inline — right where the
customer is already looking.

---

## GUARDRAILS

Never touch:
```
pixel/checkout-monitor.js          — existing pixel, read only
app/api/pixel/ingest/              — existing ingest
app/api/cart/ingest/               — existing ingest
lib/supabase.ts                    — shared client
prisma/schema.prisma               — do not modify schema directly
All existing /api/couponmaxx/* routes
All existing /couponmaxx/* pages
shopify.app.toml
vercel.json
```

What you are building (new files only):
```
extensions/smart-recovery/          — new theme app extension (storefront JS + CSS)
app/api/couponmaxx/recovery/        — recovery decision API
app/(embedded)/couponmaxx/settings/ — merchant config panel for recovery rules
supabase/recovery-functions.sql     — Postgres functions for recovery logic
```

Update (minimal changes only):
```
extensions/cart-monitor/            — add hook to detect coupon failure event
                                      and trigger recovery lookup
app/(embedded)/couponmaxx/layout.tsx — add Settings nav item
```

---

## HOW IT WORKS — END TO END

```
Customer enters code → Shopify validates → Code fails
    ↓
cart-monitor extension detects the failure event
    ↓
Sends failure context to /api/couponmaxx/recovery/decide
  Payload: {
    failedCode,
    failureReason (expired, min_not_met, usage_limit, invalid, etc),
    cartValue,
    cartItems (product titles, collections, quantities),
    customerName (if logged in),
    sessionId,
    attemptsThisSession,
    device,
    source (utm)
  }
    ↓
Recovery API applies merchant's rules (see RULES ENGINE below)
    ↓
Returns recovery response:
  {
    action: "show_code" | "show_hint" | "show_upsell" | "show_nothing",
    message: string,
    code?: string (unique, single-use, auto-generated),
    discount?: { type: "percentage" | "fixed", value: number },
    expiresInMinutes?: number,
    productSuggestion?: { title, url, price }
  }
    ↓
smart-recovery extension renders the response INLINE
in the error message area below the coupon input field
    ↓
All recovery events logged to CartEvent table for analytics
```

---

## STOREFRONT UI — THE INLINE RECOVERY MESSAGE

### Design principle
The recovery message lives in the same DOM location where Shopify
renders its native coupon error. It does NOT create a new UI element,
modal, toast, overlay, or floating widget. It replaces or extends the
error text.

### Visual treatment

```
┌─────────────────────────────────────────────────────┐
│  Discount code                                      │
│  ┌─────────────────────────────┐  ┌──────────┐     │
│  │ HYDRATEFIRST                │  │  Apply    │     │
│  └─────────────────────────────┘  └──────────┘     │
│                                                     │
│  ⚠ That code expired on Mar 28.                     │  ← line 1: explain WHY
│  Here's one that works: ┌──────────────┐            │  ← line 2: recovery
│                         │ SARAH-7X92   │ ← tap      │  ← code pill (auto-apply)
│                         └──────────────┘            │
│  15% off · expires in 15 min                        │  ← line 3: terms
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Line 1 — Failure explanation (always shown)
Replaces Shopify's generic "Enter a valid discount code" with a
specific, human-readable reason:

```
Expired:              "That code expired on [date]."
Min not met:          "This code needs $[X]+ in your cart. You're at $[Y]."
Usage limit:          "That code has been fully redeemed."
Wrong collection:     "That code works on [collection name] products."
Invalid/unknown:      "We couldn't find that code. Check the spelling?"
Already used (customer): "You've already used this code."
```

### Line 2 — Recovery action (conditional, based on rules)
Only shown if the merchant has configured a recovery rule for this
failure type AND the rules engine returns an action.

Four possible actions:

**show_code** — Display a recovery code pill
```
"Here's one that works:" [CODE-PILL]
```
The code pill is a small rounded rectangle (border-radius 4px,
background #F0F9FF, border 1px #0EA5E9, text #0EA5E9, font-weight 500,
font-size 13px, padding 4px 10px). Tapping it auto-applies the code
to the cart (via Shopify's discount apply JS API).

**show_hint** — Help the customer qualify for their original code
```
"Add $13 more to unlock this discount."
```
Optionally with a product suggestion link (see show_upsell).

**show_upsell** — Suggest a product that qualifies them
```
"Add [Product Name] ($X) to unlock this code."
```
Product name is a link to the product page. Opens in same tab.

**show_nothing** — Suppress recovery (for serial hunters or merchant choice)
Show only line 1 (the failure explanation). No recovery offer.

### Line 3 — Terms (only with show_code)
```
"[X]% off · expires in [Y] min"
```
Small text, 12px, #9CA3AF. Creates urgency. Disappears when the
code expires (countdown runs client-side).

### Mobile treatment
Same layout, same position. The code pill should be full-width on
screens below 480px so it's easy to tap. Line 2 and line 3 stack
vertically. Total height of recovery message: max 80px on mobile.

### Animation
Recovery message fades in over 300ms after the failure renders.
No bounce, no slide. Just a gentle opacity transition so it feels
like helpful information appearing, not an ad popping up.

---

## RULES ENGINE — MERCHANT CONFIGURATION

### Settings page
**Route:** /couponmaxx/settings
**Nav:** Add "Settings" after Notifications in layout.tsx

The settings page has one section: "Smart Recovery"

```
┌─────────────────────────────────────────────────────┐
│  Smart Recovery                                      │
│  ──────────────────────────────────────────────────  │
│                                                      │
│  Master toggle: [ON / OFF]                           │
│                                                      │
│  When a coupon fails, show a recovery offer to       │
│  help the customer complete their purchase.          │
│                                                      │
│  ── RULES ──────────────────────────────────────────  │
│                                                      │
│  Each failure type can have its own recovery action.  │
│                                                      │
│  1. Expired code                                     │
│     Action: [Offer fallback code ▾]                  │
│     Fallback: [Auto-generate unique code ▾]          │
│     Discount: [__15__]% off                          │
│     Expires: [__15__] minutes                        │
│                                                      │
│  2. Minimum not met                                  │
│     Action: [Show hint + product suggestion ▾]       │
│     Suggest products from: [All collections ▾]       │
│                                                      │
│  3. Usage limit reached                              │
│     Action: [Offer smaller discount ▾]               │
│     Discount: [__10__]% off                          │
│     Expires: [__15__] minutes                        │
│                                                      │
│  4. Wrong collection                                 │
│     Action: [Redirect to correct collection ▾]       │
│                                                      │
│  5. Unknown / invalid code                           │
│     Action: [Show explanation only ▾]                │
│                                                      │
│  6. Already used by customer                         │
│     Action: [Offer smaller one-time code ▾]          │
│     Discount: [__5__]% off                           │
│                                                      │
│  ── ADVANCED ───────────────────────────────────────  │
│                                                      │
│  Serial coupon hunter protection                     │
│  After [__3__] failed attempts in one session:       │
│  [Show nothing — don't reward hunting ▾]             │
│                                                      │
│  High-value cart protection                          │
│  For carts above $[__200__]:                         │
│  Increase recovery discount by [__5__]pp             │
│  (e.g., 15% default becomes 20% for $200+ carts)    │
│                                                      │
│  ── PERSONALIZATION ────────────────────────────────  │
│                                                      │
│  Use customer's first name: [ON / OFF]               │
│  (Only available for logged-in customers)            │
│                                                      │
│  Reference cart contents: [ON / OFF]                 │
│  ("15% off your HydroPitcher" vs "15% off")         │
│                                                      │
│  ── PREVIEW ────────────────────────────────────────  │
│                                                      │
│  [Show preview of recovery message]                  │
│  Renders a mock of what the customer would see       │
│  for each failure type with current settings.        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### Action dropdown options per rule:
```
- "Offer fallback code" → generates unique code with configured discount
- "Offer smaller discount" → same as above but at lower %
- "Show hint only" → explains failure, no code offered
- "Show hint + product suggestion" → explains + suggests product to qualify
- "Redirect to correct collection" → link to the right collection page
- "Show explanation only" → just the failure reason, no recovery
- "Show nothing" → suppress even the explanation (use default Shopify error)
```

### Default configuration (for new installs):
```
Expired code:           Offer fallback code, 10% off, 15 min expiry
Minimum not met:        Show hint + product suggestion
Usage limit:            Show explanation only
Wrong collection:       Redirect to correct collection
Unknown/invalid:        Show explanation only
Already used:           Show explanation only
Serial hunter (3+):     Show nothing
High-value cart:        +5pp
Personalization name:   ON
Personalization cart:   ON
```

Merchants can change any of these. The defaults are intentionally
conservative — you can always loosen them. Starting strict and
loosening is easier than starting loose and having merchants
complain about giving away too many discounts.

---

## UNIQUE CODE GENERATION

When the rules engine decides to offer a recovery code, it generates
a unique, single-use Shopify discount code via the Shopify Admin API.

### Code format:
```
[FIRST_NAME or "SAVE"]-[4 random alphanumeric chars]
Examples:
  SARAH-7X92
  SAVE-K3M1
  RAJAN-P8N4
```

### Code properties:
```
- Discount type: percentage or fixed (per merchant config)
- Discount value: per merchant config (e.g., 15%)
- Usage limit: 1 (single use)
- Starts at: now
- Ends at: now + merchant-configured expiry (default 15 min)
- Applies to: entire order (simplest) OR same collection as failed
  code (if the failed code was collection-specific)
- Minimum purchase: none (we already know the cart qualifies since
  they have items in cart)
```

### Why unique codes matter:
- Cannot be shared on coupon aggregator sites (single use, short expiry)
- Feel personal ("this code was made for me")
- Trackable — CouponMaxx can attribute the recovery to the original
  failure event, closing the analytics loop
- Merchant can see in the dashboard: "Recovery codes generated: 14,
  Recovery codes used: 8, Revenue recovered: $1,240"

### Rate limiting:
- Max 1 recovery code per session per 10 minutes
  (prevents abuse from rapid retry)
- Max 50 recovery codes per store per day on free plan
- Max 500 recovery codes per store per day on paid plan
- All generated codes logged with session context for audit

---

## RECOVERY DECISION API

### POST /api/couponmaxx/recovery/decide

```typescript
// Request — sent by cart-monitor extension when coupon fails
{
  shopId: string,
  sessionId: string,
  failedCode: string,
  failureReason: "expired" | "min_not_met" | "usage_limit" |
                 "wrong_collection" | "invalid" | "already_used",
  cartValue: number,            // cents
  cartItems: {
    productTitle: string,
    collectionIds: string[],
    price: number,              // cents
    quantity: number
  }[],
  customerName: string | null,  // null if not logged in
  attemptsThisSession: number,
  device: "mobile" | "desktop",
  source: string | null         // utm_source
}

// Response
{
  action: "show_code" | "show_hint" | "show_upsell" | "show_nothing",
  line1: string,                // failure explanation
  line2: string | null,         // recovery message (null if show_nothing)
  code: string | null,          // generated code (null if no code offered)
  discount: {
    type: "percentage" | "fixed",
    value: number
  } | null,
  expiresInMinutes: number | null,
  productSuggestion: {
    title: string,
    url: string,
    price: number               // cents
  } | null,
  recoveryId: string            // UUID for tracking conversion
}
```

### Decision logic (pseudocode):
```
function decideRecovery(request, merchantSettings):

  // Check serial hunter protection
  if request.attemptsThisSession >= merchantSettings.hunterThreshold:
    return merchantSettings.hunterAction  // usually "show_nothing"

  // Get rule for this failure reason
  rule = merchantSettings.rules[request.failureReason]

  // Apply high-value cart override
  if request.cartValue >= merchantSettings.highValueThreshold:
    rule.discountValue += merchantSettings.highValueBoost

  // Build response based on rule action
  switch rule.action:
    case "offer_fallback_code":
      code = generateUniqueCode(
        shopId, discount, expiry, request.customerName
      )
      return {
        action: "show_code",
        line1: explainFailure(request.failureReason, request.failedCode),
        line2: formatRecoveryMessage(request.customerName, request.cartItems),
        code: code,
        discount: rule.discount,
        expiresInMinutes: rule.expiry
      }

    case "show_hint_and_suggest":
      deficit = rule.minimumRequired - request.cartValue
      product = findCheapestProductToQualify(deficit, rule.collections)
      return {
        action: "show_upsell",
        line1: explainMinNotMet(request.cartValue, rule.minimumRequired),
        line2: formatUpsellMessage(deficit, product),
        productSuggestion: product
      }

    case "redirect_collection":
      return {
        action: "show_hint",
        line1: explainWrongCollection(request.failedCode, correctCollection),
        line2: formatCollectionLink(correctCollection)
      }

    case "explanation_only":
      return {
        action: "show_hint",
        line1: explainFailure(request.failureReason, request.failedCode),
        line2: null
      }

    case "show_nothing":
      return { action: "show_nothing" }
```

---

## ANALYTICS — RECOVERY DASHBOARD

On the existing Dashboard page, add a new section below the current KPIs:

```
┌─────────────────────────────────────────────────────┐
│  Smart Recovery                        Last 7 days   │
│  ──────────────────────────────────────────────────  │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Recovery      │  │ Codes used   │  │ Revenue    │ │
│  │ codes offered │  │              │  │ recovered  │ │
│  │     47        │  │    18        │  │   $1,240   │ │
│  │               │  │ 38.3% rate   │  │ +$68/use   │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│                                                      │
│  Top recovery trigger: Expired codes (62%)           │
│  Best converting rule: High-value cart recovery (54%)│
│                                                      │
└─────────────────────────────────────────────────────┘
```

This is the merchant's ROI proof. They see exactly how much money
Smart Recovery saved them. This is also what makes them pay —
"CouponMaxx recovered $1,240 this month" is a much stronger
retention signal than "CouponMaxx tracked 94 codes."

---

## ALERT EMAIL IMPROVEMENT

Update the existing alert email (the one you showed me) to include
revenue impact:

**Current:**
```
Code PLJADCZ54 failed 1 times (100% failure rate)
1 customers tried code PLJADCZ54 and it didn't work.
0 uses succeeded.
```

**Updated:**
```
⚠ Code PLJADCZ54 failed 3 times today

Cart value at risk: $347.94
Customers affected: 3
Abandoned after failure: 2 ($234.97 in cart value left behind)
Completed anyway: 1

→ Smart Recovery caught 2 of these and offered a fallback code.
  1 customer used it — $112.97 recovered.

→ Fix this code: [View coupons]
→ View recovery stats: [Dashboard]
```

This tells the merchant: "Your code broke. You almost lost $347.
We saved $112. Here's where to fix the rest."

---

## DATA MODEL — NEW TABLES/COLUMNS

### RecoveryEvent (new table)
```sql
CREATE TABLE "RecoveryEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shopId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "failedCode" TEXT NOT NULL,
  "failureReason" TEXT NOT NULL,
  "recoveryAction" TEXT NOT NULL,     -- show_code, show_hint, etc.
  "recoveryCode" TEXT,                -- the generated code, if any
  "discountValue" NUMERIC,
  "discountType" TEXT,
  "cartValueAtFailure" INTEGER,       -- cents
  "recoveryUsed" BOOLEAN DEFAULT FALSE,
  "revenueRecovered" INTEGER,         -- cents, filled when code is used
  "customerName" TEXT,
  "attemptsThisSession" INTEGER,
  "device" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "usedAt" TIMESTAMPTZ
);

CREATE INDEX idx_recovery_shop_date ON "RecoveryEvent" ("shopId", "createdAt");
CREATE INDEX idx_recovery_session ON "RecoveryEvent" ("sessionId");
CREATE INDEX idx_recovery_code ON "RecoveryEvent" ("recoveryCode");
```

### MerchantRecoverySettings (new table)
```sql
CREATE TABLE "MerchantRecoverySettings" (
  "shopId" TEXT PRIMARY KEY,
  "enabled" BOOLEAN DEFAULT TRUE,
  "rules" JSONB NOT NULL DEFAULT '{
    "expired": { "action": "offer_fallback_code", "discount": 10, "discountType": "percentage", "expiryMinutes": 15 },
    "min_not_met": { "action": "show_hint_and_suggest", "collections": "all" },
    "usage_limit": { "action": "explanation_only" },
    "wrong_collection": { "action": "redirect_collection" },
    "invalid": { "action": "explanation_only" },
    "already_used": { "action": "explanation_only" }
  }',
  "hunterThreshold" INTEGER DEFAULT 3,
  "hunterAction" TEXT DEFAULT 'show_nothing',
  "highValueThreshold" INTEGER DEFAULT 20000,  -- cents ($200)
  "highValueBoost" INTEGER DEFAULT 5,           -- percentage points
  "useCustomerName" BOOLEAN DEFAULT TRUE,
  "useCartContents" BOOLEAN DEFAULT TRUE,
  "dailyCodeLimit" INTEGER DEFAULT 50,
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);
```

---

## BUILD SEQUENCE

```
1. Run npx tsc --noEmit — fix any existing errors first
2. Create RecoveryEvent and MerchantRecoverySettings tables
   Run the SQL in Supabase SQL editor
3. Build /api/couponmaxx/recovery/decide
   - Reads merchant settings
   - Applies rules engine
   - Generates unique Shopify discount code via Admin API
   - Logs RecoveryEvent
   - Test with curl
4. Build the smart-recovery theme app extension
   - Detect coupon failure in the storefront
   - Call recovery API
   - Render inline recovery message
   - Handle code auto-apply on tap
   - Handle countdown timer for expiry
5. Build /couponmaxx/settings page
   - Recovery rules configuration UI
   - Master toggle
   - Preview panel
6. Add Settings nav item to layout.tsx
7. Update alert email to include revenue impact
8. Add Smart Recovery section to Dashboard page
9. npx tsc --noEmit — fix all errors
10. npm run build — fix all errors
11. Test on DrWater store with intentional code failures
12. Verify recovery message renders correctly on:
    - Desktop Chrome, Safari, Firefox
    - Mobile Safari (iPhone)
    - Mobile Chrome (Android)
    - Multiple Shopify themes (Dawn, Debut, at least one paid theme)
13. git add -A && git commit -m "feat: Smart Recovery — inline coupon failure recovery" && git push
```

---

## PRICING IMPLICATION

Smart Recovery is the paid feature. The free plan includes:
- Coupon tracking and analytics (existing)
- Broken code alerts (existing)
- Smart Recovery with max 50 codes/day

The paid plan ($19-29/month) includes:
- Everything in free
- Smart Recovery with max 500 codes/day
- High-value cart rules
- Serial hunter protection
- Recovery analytics dashboard
- Custom discount values per rule

The pitch for upgrade: "You recovered $1,240 this month with
Smart Recovery. Upgrade to increase your daily recovery limit
and protect high-value carts."

---

## EMPTY STATES

```
Settings page — first visit:
  "Smart Recovery is ready to go.
   When a customer's coupon fails, we'll show them a helpful
   message and optionally offer a recovery code.
   Review the default settings below or turn it on now."

Dashboard — recovery section, no data yet:
  "Smart Recovery is active but hasn't triggered yet.
   It activates when a customer enters a coupon that doesn't work."

Dashboard — recovery section, recovery off:
  "Smart Recovery is turned off.
   Turn it on in Settings to start recovering failed coupon sessions."
```
