
# CheckoutMaxx — Cart Intelligence Phase 1
> Paste this entire prompt into Claude Code from the repo root.
> This is a discovery phase. The goal is to capture and log every possible
> cart interaction reliably. No UI. No DB writes. No analytics. Just events.

---

## CONTEXT — WHAT THIS APP IS AND WHAT EXISTS

CheckoutMaxx is a Shopify embedded app (Next.js 14, App Router, Polaris,
Prisma, Supabase) that monitors the checkout funnel via a Web Pixel. It is
live and actively ingesting events on a real merchant store.

The following is fully built, tested, and live. **Do not touch any of it.**

```
app/api/pixel/ingest/              ← Web Pixel event receiver (sendBeacon)
app/api/jobs/evaluate-alerts/      ← cron, alert engine
app/api/jobs/compute-baselines/    ← cron, baselines
app/api/webhooks/                  ← GDPR + uninstall, HMAC verified
app/(embedded)/                    ← all embedded app pages
app/privacy/                       ← privacy policy
lib/alert-engine.ts                ← alert logic
lib/metrics.ts                     ← funnel queries
lib/notifications/                 ← Resend + Slack
lib/billing.ts                     ← Shopify billing
pixel/checkout-monitor.js          ← Web Pixel (sandboxed, sendBeacon only)
prisma/schema.prisma               ← Shop, CheckoutEvent, AlertLog, Baseline
shopify.app.toml                   ← app config, GDPR webhooks registered
vercel.json                        ← cron schedule
```

You are adding one new thing: a **theme app extension** that runs on the
storefront (cart page and all pages) and captures cart interactions.

Phase 1 scope is discovery only:
- Intercept all cart-related network activity
- Log everything to console with full payloads
- Beacon a copy to a new logging endpoint (writes to a temp log file only,
  NO DB writes in Phase 1)
- Do not modify any existing file except where explicitly instructed below

---

## WHAT YOU ARE BUILDING

### 1. Theme App Extension — `extensions/cart-monitor/`

A Shopify theme app extension. This is JavaScript that Shopify automatically
injects into the merchant's storefront when they install the app. It runs on
every page of the store (not just cart — because cart drawers can open on
any page).

It captures every possible cart interaction via network-level interception
(fetch + XHR), which is consistent across all themes regardless of DOM
structure.

### 2. Logging Endpoint — `app/api/cart/log/route.ts`

A POST endpoint that receives beaconed cart events and writes them to a
local log file (`/tmp/cart-events.log`) for inspection. No DB. No Prisma.
No analytics. Just a file you can read to see what's coming in.

### 3. Log Viewer Script — `scripts/read-cart-log.ts`

A simple script you run with `npx ts-node scripts/read-cart-log.ts` that
pretty-prints the log file so you can read captured events during testing.

---

## STEP 1 — SCAFFOLD THE THEME EXTENSION

From the repo root:

```bash
npx @shopify/cli@latest app generate extension
```

When prompted:
- Type: **Theme app extension**
- Name: **cart-monitor**

This creates `extensions/cart-monitor/` with a default structure. You will
replace the generated JS with the code below.

Confirm the scaffold created:
```
extensions/cart-monitor/
  assets/
    cart-monitor.js     ← you will write this
  blocks/
    cart-monitor.liquid ← auto-generated, minimal edits needed
  snippets/
  locales/
  shopify.extension.toml
```

---

## STEP 2 — WRITE THE EXTENSION ENTRY POINT

Edit `extensions/cart-monitor/blocks/cart-monitor.liquid`:

```liquid
{% comment %}
  CheckoutMaxx Cart Monitor
  Injected automatically on all storefront pages via theme app extension.
  Loads the cart monitoring script which intercepts cart network activity.
{% endcomment %}

<script
  src="{{ 'cart-monitor.js' | asset_url }}"
  data-shop="{{ shop.permanent_domain }}"
  data-log-url="{{ 'https://YOUR_VERCEL_URL/api/cart/log' }}"
  defer
></script>
```

Replace `YOUR_VERCEL_URL` with the actual Vercel deployment URL from
`process.env.NEXT_PUBLIC_APP_URL`. Read the current value from `.env.local`
or `vercel.json` and substitute it directly — do not leave a placeholder.

---

## STEP 3 — WRITE THE CART MONITOR SCRIPT

Create `extensions/cart-monitor/assets/cart-monitor.js`.

This is plain JavaScript (no bundler, no imports — it runs directly in the
browser). Write it carefully. Every section is explained.

```javascript
/**
 * CheckoutMaxx Cart Monitor — Phase 1 Discovery
 *
 * Intercepts all cart-related network activity on the Shopify storefront.
 * Runs on every page (cart page, product pages, collection pages) because
 * cart drawers can open anywhere.
 *
 * Phase 1: logs to console + beacons to /api/cart/log for inspection.
 * Phase 2 will replace the beacon target with the real ingest endpoint.
 *
 * WHAT THIS INTERCEPTS:
 * Shopify cart operations use these endpoints:
 *   POST /cart/add.js          — add item to cart
 *   POST /cart/change.js       — change item quantity (includes remove at qty=0)
 *   POST /cart/update.js       — bulk update multiple items
 *   POST /cart/clear.js        — empty the cart
 *   GET  /cart.js              — fetch current cart state
 *   POST /discount/apply       — apply discount code (most themes)
 *   POST /discount/remove      — remove discount code
 *   POST /cart/apply_coupon    — some themes use this instead
 *
 * Network-level interception is used (not DOM events) because:
 * - Works identically across all Shopify themes
 * - Captures headless cart implementations (drawer carts, AJAX carts)
 * - Captures the actual server response including failure reasons
 */

(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────
  const script = document.currentScript ||
    document.querySelector('script[data-shop]');

  const CONFIG = {
    shopDomain: script?.dataset?.shop || window.location.hostname,
    logUrl: script?.dataset?.logUrl || null,
    debug: true, // Phase 1: always log to console
  };

  // ── Session ID ────────────────────────────────────────────────────────
  // Generate a stable session ID for this browser session.
  // This links all cart events from one visit together.
  // In Phase 2 this will be linked to the checkout pixel sessionId.
  function getSessionId() {
    let id = sessionStorage.getItem('_cmx_sid');
    if (!id) {
      id = 'cart_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      sessionStorage.setItem('_cmx_sid', id);
    }
    return id;
  }

  // ── Cart Token ────────────────────────────────────────────────────────
  // Shopify assigns a unique token to each cart. This is the key that
  // links all events for one cart lifecycle together, and will link
  // to the checkout token in Phase 2 (they share the same token).
  let cartToken = null;

  function extractCartToken(responseData) {
    if (responseData?.token) {
      cartToken = responseData.token;
    }
  }

  // ── Event Builder ─────────────────────────────────────────────────────
  function buildEvent(type, payload) {
    return {
      eventType: type,
      shopDomain: CONFIG.shopDomain,
      sessionId: getSessionId(),
      cartToken: cartToken,
      occurredAt: new Date().toISOString(),
      url: window.location.href,
      payload: payload,
    };
  }

  // ── Logger ────────────────────────────────────────────────────────────
  function logEvent(event) {
    if (CONFIG.debug) {
      console.group('[CheckoutMaxx Cart]', event.eventType);
      console.log('Session:', event.sessionId);
      console.log('Cart token:', event.cartToken);
      console.log('Payload:', event.payload);
      console.groupEnd();
    }

    if (CONFIG.logUrl) {
      // Use sendBeacon so it fires even if page navigates away
      // sendBeacon sends as text/plain — same pattern as checkout pixel
      navigator.sendBeacon(
        CONFIG.logUrl,
        JSON.stringify(event)
      );
    }
  }

  // ── Payload Parsers ───────────────────────────────────────────────────
  // Parse request body for each cart endpoint.
  // Bodies come in as FormData, URLSearchParams, or JSON strings.
  function parseRequestBody(body) {
    if (!body) return null;

    // Try JSON first
    try {
      return { format: 'json', data: JSON.parse(body) };
    } catch {}

    // Try URLSearchParams (form-encoded)
    try {
      const params = new URLSearchParams(body);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return { format: 'form', data: obj };
    } catch {}

    // Return raw if neither parses
    return { format: 'raw', data: String(body) };
  }

  // ── Cart Event Classifier ─────────────────────────────────────────────
  // Given a URL and request/response, determine what happened and
  // extract the relevant fields.
  function classifyCartEvent(url, requestBody, responseData, status) {
    const path = new URL(url, window.location.origin).pathname;
    const req = parseRequestBody(requestBody);

    // ── Item Added ──────────────────────────────────────────────────────
    if (path.includes('/cart/add')) {
      const items = responseData?.items || [];
      return {
        type: 'cart_item_added',
        data: {
          success: status >= 200 && status < 300,
          itemsAdded: items.map(i => ({
            productId: i.product_id,
            variantId: i.variant_id,
            productTitle: i.product_title,
            variantTitle: i.variant_title,
            price: i.price,          // in cents
            quantity: i.quantity,
            sku: i.sku,
          })),
          cartValue: responseData?.total_price,    // in cents
          cartItemCount: responseData?.item_count,
          cartToken: responseData?.token,
          errorMessage: status >= 400 ? responseData?.description : null,
        },
      };
    }

    // ── Item Removed / Quantity Changed ────────────────────────────────
    if (path.includes('/cart/change')) {
      const qty = req?.data?.quantity !== undefined
        ? parseInt(req.data.quantity)
        : null;
      return {
        type: qty === 0 ? 'cart_item_removed' : 'cart_item_changed',
        data: {
          variantId: req?.data?.id || req?.data?.variant_id,
          newQuantity: qty,
          lineKey: req?.data?.key,
          cartValue: responseData?.total_price,
          cartItemCount: responseData?.item_count,
          cartToken: responseData?.token,
          lineItems: (responseData?.items || []).map(i => ({
            productId: i.product_id,
            variantId: i.variant_id,
            productTitle: i.product_title,
            price: i.price,
            quantity: i.quantity,
          })),
        },
      };
    }

    // ── Bulk Update ─────────────────────────────────────────────────────
    if (path.includes('/cart/update')) {
      return {
        type: 'cart_bulk_updated',
        data: {
          cartValue: responseData?.total_price,
          cartItemCount: responseData?.item_count,
          cartToken: responseData?.token,
          updates: req?.data?.updates || req?.data,
        },
      };
    }

    // ── Cart Cleared ────────────────────────────────────────────────────
    if (path.includes('/cart/clear')) {
      return {
        type: 'cart_cleared',
        data: {
          cartToken: responseData?.token,
        },
      };
    }

    // ── Discount Applied / Failed ───────────────────────────────────────
    // Shopify uses different endpoints depending on theme:
    // /discount/apply, /cart/apply_coupon, or sometimes AJAX to /discount
    if (
      path.includes('/discount/apply') ||
      path.includes('/discount/remove') ||
      path.includes('/cart/apply_coupon') ||
      path.includes('/discount')
    ) {
      const code =
        req?.data?.discount ||
        req?.data?.code ||
        req?.data?.coupon ||
        // Some themes send code in the URL path: /discount/MYCODE
        path.split('/discount/')[1]?.split('?')[0] ||
        null;

      const success = status >= 200 && status < 300 &&
        !responseData?.error &&
        !responseData?.errors;

      // Shopify returns different error formats — capture all of them
      const errorRaw =
        responseData?.error ||
        responseData?.errors ||
        responseData?.message ||
        null;

      // Normalise failure reason into a consistent enum
      // These are the known Shopify discount failure messages
      let failureReason = null;
      if (!success && errorRaw) {
        const msg = String(errorRaw).toLowerCase();
        if (msg.includes('expired') || msg.includes('no longer valid')) {
          failureReason = 'expired';
        } else if (msg.includes('minimum') || msg.includes('subtotal')) {
          failureReason = 'minimum_not_met';
        } else if (msg.includes('not applicable') || msg.includes('not eligible')) {
          failureReason = 'product_ineligible';
        } else if (msg.includes('usage') || msg.includes('limit') || msg.includes('already been used')) {
          failureReason = 'usage_limit_reached';
        } else if (msg.includes('not found') || msg.includes('invalid') || msg.includes('does not exist')) {
          failureReason = 'invalid_code';
        } else if (msg.includes('customer') || msg.includes('once per')) {
          failureReason = 'customer_usage_limit';
        } else {
          failureReason = 'unknown';
        }
      }

      return {
        type: success ? 'cart_coupon_applied' : 'cart_coupon_failed',
        data: {
          code: code,
          success: success,
          failureReason: failureReason,
          errorRaw: errorRaw,
          statusCode: status,
          // Full cart state at time of coupon attempt
          cartValue: responseData?.total_price,
          cartValueAfterDiscount: responseData?.total_discounts
            ? responseData.total_price - responseData.total_discounts
            : null,
          discountAmount: responseData?.total_discounts,
          cartItemCount: responseData?.item_count,
          lineItems: (responseData?.items || []).map(i => ({
            productId: i.product_id,
            variantId: i.variant_id,
            productTitle: i.product_title,
            price: i.price,
            quantity: i.quantity,
          })),
          // Raw response for Phase 1 inspection
          rawResponse: responseData,
        },
      };
    }

    // ── Cart Fetched ────────────────────────────────────────────────────
    if (path.includes('/cart.js') || path === '/cart') {
      return {
        type: 'cart_fetched',
        data: {
          cartToken: responseData?.token,
          cartValue: responseData?.total_price,
          cartItemCount: responseData?.item_count,
          hasDiscount: !!(responseData?.cart_level_discount_applications?.length),
          appliedDiscounts: responseData?.cart_level_discount_applications || [],
        },
      };
    }

    // ── Unknown cart endpoint — log it anyway ──────────────────────────
    return {
      type: 'cart_unknown_endpoint',
      data: {
        path: path,
        status: status,
        requestBody: req,
        responseData: responseData,
      },
    };
  }

  // ── Fetch Interceptor ─────────────────────────────────────────────────
  // Wraps window.fetch to capture all cart API calls.
  // This is the primary interception method — works on all modern themes.
  const _originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const url = typeof input === 'string'
      ? input
      : input instanceof Request
        ? input.url
        : String(input);

    // Only intercept cart/discount endpoints
    const isCartEndpoint =
      url.includes('/cart/') ||
      url.includes('/cart.js') ||
      url.includes('/discount/') ||
      url.includes('/discount');

    if (!isCartEndpoint) {
      return _originalFetch(input, init);
    }

    // Capture request body before it's consumed
    const requestBody = init?.body
      ? (typeof init.body === 'string' ? init.body : null)
      : null;

    let response;
    try {
      response = await _originalFetch(input, init);
    } catch (err) {
      logEvent(buildEvent('cart_fetch_error', {
        url: url,
        error: err.message,
      }));
      throw err;
    }

    // Clone response to read body without consuming it
    const clone = response.clone();
    clone.json().then(responseData => {
      extractCartToken(responseData);

      const classified = classifyCartEvent(
        url,
        requestBody,
        responseData,
        response.status
      );

      logEvent(buildEvent(classified.type, classified.data));
    }).catch(() => {
      // Response wasn't JSON — log the URL at least
      logEvent(buildEvent('cart_non_json_response', { url, status: response.status }));
    });

    return response;
  };

  // ── XHR Interceptor ───────────────────────────────────────────────────
  // Some older or custom themes use XMLHttpRequest instead of fetch.
  // This catches those.
  const _originalOpen = XMLHttpRequest.prototype.open;
  const _originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._cmx_url = url;
    this._cmx_method = method;
    return _originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const url = this._cmx_url || '';
    const isCartEndpoint =
      url.includes('/cart/') ||
      url.includes('/cart.js') ||
      url.includes('/discount/') ||
      url.includes('/discount');

    if (isCartEndpoint) {
      this._cmx_requestBody = body;

      this.addEventListener('load', () => {
        try {
          const responseData = JSON.parse(this.responseText);
          extractCartToken(responseData);

          const classified = classifyCartEvent(
            url,
            this._cmx_requestBody,
            responseData,
            this.status
          );

          logEvent(buildEvent(classified.type, classified.data));
        } catch {
          logEvent(buildEvent('cart_xhr_parse_error', {
            url,
            status: this.status,
          }));
        }
      });

      this.addEventListener('error', () => {
        logEvent(buildEvent('cart_xhr_error', { url }));
      });
    }

    return _originalSend.call(this, body);
  };

  // ── Checkout Navigation Capture ───────────────────────────────────────
  // Capture when a customer leaves cart and goes to checkout.
  // This is the bridge event between cart monitoring and checkout pixel.
  // We capture the cart token here so Phase 2 can link cart → checkout.
  document.addEventListener('click', function (e) {
    const target = e.target.closest('a, button');
    if (!target) return;

    const href = target.href || '';
    const isCheckoutLink =
      href.includes('/checkout') ||
      target.getAttribute('name') === 'checkout' ||
      target.getAttribute('data-checkout') !== null ||
      (target.tagName === 'BUTTON' && target.form?.action?.includes('/cart'));

    if (isCheckoutLink) {
      logEvent(buildEvent('cart_checkout_clicked', {
        cartToken: cartToken,
        cartValue: null, // will be filled from last cart_fetched event
        triggerElement: target.tagName,
        triggerText: target.innerText?.trim()?.slice(0, 50),
      }));
    }
  });

  // ── Page Visibility — Cart Abandonment Signal ─────────────────────────
  // When the page becomes hidden (tab closed, navigated away), log it.
  // If we have a cartToken and no checkout_clicked event followed,
  // this is a cart abandonment signal.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && cartToken) {
      logEvent(buildEvent('cart_page_hidden', {
        cartToken: cartToken,
        // Phase 1: just log that it happened
        // Phase 2: correlate with checkout_clicked to distinguish
        // "went to checkout" vs "abandoned"
      }));
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────
  // Fetch current cart state on load to capture cartToken immediately
  // (needed to link events if customer has an existing cart)
  fetch('/cart.js')
    .then(r => r.json())
    .then(cart => {
      if (cart?.token) {
        cartToken = cart.token;
        if (CONFIG.debug) {
          console.log('[CheckoutMaxx Cart] Initialised. Cart token:', cartToken);
        }
      }
    })
    .catch(() => {
      // No cart yet — that's fine, token will be captured on first add
    });

})();
```

---

## STEP 4 — THE LOGGING ENDPOINT

Create `app/api/cart/log/route.ts`.

**Phase 1 only.** Writes to `/tmp/cart-events.log`. No DB. No Prisma.
No imports from lib/. This file is deleted entirely in Phase 2.

```typescript
// app/api/cart/log/route.ts
// PHASE 1 ONLY — discovery logging, not production code
// Delete this file entirely when Phase 2 begins

import { NextRequest, NextResponse } from 'next/server';
import { appendFileSync } from 'fs';
import { join } from 'path';

const LOG_FILE = join('/tmp', 'cart-events.log');

export async function POST(req: NextRequest) {
  const text = await req.text();

  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const line = JSON.stringify({
    ...event,
    receivedAt: new Date().toISOString(),
  }) + '\n';

  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // /tmp may not be writable in all environments — fail silently
    // Events are still logged to console in the extension
  }

  return NextResponse.json({ ok: true });
}
```

---

## STEP 5 — THE LOG READER SCRIPT

Create `scripts/read-cart-log.ts`.

```typescript
// scripts/read-cart-log.ts
// Run with: npx ts-node scripts/read-cart-log.ts
// Or: npx ts-node scripts/read-cart-log.ts --type cart_coupon_failed
// Or: npx ts-node scripts/read-cart-log.ts --summary

import { readFileSync } from 'fs';
import { join } from 'path';

const LOG_FILE = join('/tmp', 'cart-events.log');
const filterType = process.argv.includes('--type')
  ? process.argv[process.argv.indexOf('--type') + 1]
  : null;
const summaryMode = process.argv.includes('--summary');

let lines: any[] = [];
try {
  const raw = readFileSync(LOG_FILE, 'utf-8');
  lines = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
} catch {
  console.log('No log file found at', LOG_FILE);
  console.log('Make sure you have run some cart interactions on the store.');
  process.exit(0);
}

if (summaryMode) {
  const counts: Record<string, number> = {};
  for (const e of lines) {
    counts[e.eventType] = (counts[e.eventType] || 0) + 1;
  }
  console.log('\n── Cart Event Summary ──────────────────────');
  for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(35)} ${count}`);
  }
  console.log(`\nTotal events: ${lines.length}`);
  console.log('────────────────────────────────────────────\n');
  process.exit(0);
}

const filtered = filterType
  ? lines.filter(e => e.eventType === filterType)
  : lines;

console.log(`\n── Cart Events (${filtered.length}) ─────────────────────\n`);
for (const event of filtered) {
  console.log(`[${event.receivedAt}] ${event.eventType}`);
  console.log(`  Session: ${event.sessionId}`);
  console.log(`  Cart token: ${event.cartToken}`);
  console.log(`  Payload:`, JSON.stringify(event.payload, null, 4));
  console.log('');
}
```

---

## STEP 6 — EXTENSION CONFIG

Edit `extensions/cart-monitor/shopify.extension.toml` to confirm it looks
like this (the scaffold may generate it slightly differently — adjust to match):

```toml
api_version = "2024-01"

[[extensions]]
type = "theme"
name = "cart-monitor"
handle = "cart-monitor"

  [[extensions.targeting]]
  target = "body"
```

The `target = "body"` ensures the script block is injected on every page,
not just specific page types. This is required because cart drawers open
on product pages, collection pages, etc.

---

## STEP 7 — UPDATE shopify.app.toml

The theme extension needs to be listed alongside the existing web pixel
extension. Open `shopify.app.toml` and confirm it has an `[[extensions]]`
entry or `[extensions]` block that includes both. If the CLI scaffold
added it automatically, verify it. If not, add:

```toml
[[extensions]]
type = "theme"
handle = "cart-monitor"
```

Do not remove or modify the existing pixel extension entry.

---

## STEP 8 — GITIGNORE THE LOG FILE

Add to `.gitignore`:
```
/tmp/cart-events.log
scripts/read-cart-log.ts
```

The log file contains real store data and should never be committed.
The reader script is a dev tool, not production code.

---

## STEP 9 — DEPLOY AND TEST

### Deploy the extension

```bash
npx @shopify/cli@latest app deploy
```

This deploys the theme extension to Shopify. It will appear in the merchant's
theme customizer as an app block. For development, you can also use:

```bash
npx @shopify/cli@latest app dev
```

### Activate the extension on the theme

After deploy, the merchant (you, on drwater) needs to activate the app block:
1. Shopify admin → Online Store → Themes → Customize
2. App embeds section (or Theme settings → App embeds)
3. Toggle on "cart-monitor"

For dev mode (`app dev`), Shopify may handle this automatically.

### Manual test scenarios to run on drwater

Run each of these and verify the event appears in the log.
After each scenario, run `npx ts-node scripts/read-cart-log.ts --summary`
to confirm the event was captured.

```
SCENARIO 1 — Add item to cart
  Action: Add any product to cart
  Expected event: cart_item_added
  Check: itemsAdded has correct product title, price, quantity
         cartToken is populated
         cartValue matches cart total in cents

SCENARIO 2 — Change quantity
  Action: Increase quantity of item in cart from 1 to 2
  Expected event: cart_item_changed
  Check: newQuantity = 2, lineItems shows updated quantities

SCENARIO 3 — Remove item
  Action: Remove an item from cart (set quantity to 0)
  Expected event: cart_item_removed
  Check: variantId matches removed item

SCENARIO 4 — Valid coupon
  Action: Apply a discount code that works
  Expected event: cart_coupon_applied
  Check: code matches, success=true, discountAmount > 0
         lineItems captured, cartValue before and after

SCENARIO 5 — Expired coupon
  Action: Apply a discount code that is expired
  Expected event: cart_coupon_failed
  Check: failureReason = "expired", errorRaw has Shopify's message
         code matches what you typed

SCENARIO 6 — Invalid coupon (doesn't exist)
  Action: Type a random code that doesn't exist (e.g. "ZZZZTEST99")
  Expected event: cart_coupon_failed
  Check: failureReason = "invalid_code"

SCENARIO 7 — Minimum order not met
  Action: Apply a code that requires $X minimum, with cart below that
  Expected event: cart_coupon_failed
  Check: failureReason = "minimum_not_met"

SCENARIO 8 — Product ineligible
  Action: Apply a code that only works on specific products,
          with a non-qualifying product in cart
  Expected event: cart_coupon_failed
  Check: failureReason = "product_ineligible"

SCENARIO 9 — Clear cart
  Action: Empty the cart
  Expected event: cart_cleared

SCENARIO 10 — Proceed to checkout
  Action: Click the checkout button from cart
  Expected event: cart_checkout_clicked
  Check: cartToken matches the cart token from earlier events
         This is the bridge event between cart and checkout data

SCENARIO 11 — Open cart then close tab without checking out
  Action: Have items in cart, do nothing, close the tab
  Expected event: cart_page_hidden
  Check: cartToken present
```

### After all scenarios

Run the full summary:
```bash
npx ts-node scripts/read-cart-log.ts --summary
```

Run detailed view of coupon events:
```bash
npx ts-node scripts/read-cart-log.ts --type cart_coupon_failed
npx ts-node scripts/read-cart-log.ts --type cart_coupon_applied
```

---

## STEP 10 — DOCUMENT YOUR FINDINGS

After running all 11 scenarios, create `docs/cart-events-discovery.md`
(new file, not tracked in git) and fill in this template from your actual
log output:

```markdown
# Cart Events Discovery — Phase 1 Findings

Date: [today]
Store: drwater.myshopify.com
Theme: [theme name]

## Events Captured Successfully
| Event Type | Payload Complete? | Notes |
|---|---|---|
| cart_item_added | | |
| cart_coupon_failed | | |
| ... | | |

## Failure Reason Mapping
| Shopify Error Message (raw) | Normalised failureReason |
|---|---|
| [actual message from log] | expired / minimum_not_met / etc |

## Fields Available on cart_coupon_failed
- code: [yes/no, always present?]
- failureReason: [yes/no, accurate?]
- lineItems: [yes/no, complete?]
- cartValue: [yes/no]
- [any unexpected fields?]

## Surprises / Gaps
[Anything the interceptor missed or got wrong]

## Ready for Phase 2?
[ ] All 11 scenarios captured
[ ] Coupon failure reasons mapping to correct enum values
[ ] cartToken present on all events
[ ] cart_checkout_clicked fires before checkout pixel fires
```

This document is the input to Phase 2 schema design.
Do not start Phase 2 until this document exists and all 11 scenarios
show green.

---

## ABSOLUTE HARD RULES

1. **Do not modify any existing file** except:
   - `.gitignore` (add log file entry)
   - `shopify.app.toml` (add extension entry if not auto-added by CLI)
   These are the only two existing files you may touch.

2. **No DB writes in Phase 1.** The logging endpoint writes to `/tmp` only.
   Do not import Prisma into any Phase 1 file.

3. **No imports from `lib/`** in any Phase 1 file. The extension is standalone
   browser JS. The logging endpoint is standalone Next.js. No shared code.

4. **Do not modify `pixel/checkout-monitor.js`.** The Web Pixel continues
   running exactly as before. Cart monitoring is additive, not a replacement.

5. **Do not modify `app/api/pixel/ingest/route.ts`.** Phase 2 will extend it.
   Phase 1 uses its own separate `/api/cart/log` endpoint.

6. **Do not add the Cart Activity nav tab to the embedded app yet.**
   That is Phase 3. Phase 1 has no UI in the embedded app at all.

7. **Do not run `prisma migrate` for anything.** No schema changes in Phase 1.

8. **`npm run build` must still pass clean after this task.**
   The new endpoint and script must have no TypeScript errors.

9. **The theme extension JS is plain browser JavaScript — no TypeScript,
   no imports, no bundler.** It runs directly in the browser as-is.

10. **Phase 1 is complete only when all 11 test scenarios are captured
    and `docs/cart-events-discovery.md` is filled in with real data.**
    Do not mark this done based on code alone.

---

## WHAT PHASE 2 WILL DO (do not build this yet — for context only)

- Replace `/api/cart/log` with `/api/cart/ingest` that writes to a new
  `CartEvent` Prisma model
- `CartEvent` schema designed from the Phase 1 discovery document
- Update the theme extension beacon URL to point to the new endpoint
- Link `CartEvent.cartToken` → `CheckoutEvent.sessionId` for full
  cart-to-order journey reconstruction
- Add `Cart Activity` as the 5th nav item in the embedded app

Phase 2 starts only after Phase 1 discovery is complete and documented.

v1.2:
cart-stage discount application is standard on most Shopify themes including Dawn. The discount field on the cart page is a core Shopify feature, not a theme quirk.
On 1 and 2 — both are real issues but solvable. On 4 — here's the exact fix.

Fix for issue 1 — local dev instead of Vercel /tmp
During Phase 1 testing, run npx shopify app dev which tunnels to your local machine. The log endpoint runs locally, /tmp/cart-events.log writes to your actual filesystem, and the reader script works. Don't deploy to Vercel for Phase 1 testing — run it locally the whole time.
Add one line to the prompt under Step 9:

Run Phase 1 testing exclusively via npx shopify app dev, not against the Vercel deployment. The log file writes to your local /tmp/ and is readable with the script. Do not use npx shopify app deploy until Phase 2.


Fix for issue 2 — manual theme activation
Already in the prompt under Step 9. No change needed, it's documented.

Fix for issue 4 — CORS header
In app/api/cart/log/route.ts, add this at the top of the POST handler and add an OPTIONS handler:
typescriptconst CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  // ... existing code ...
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
sendBeacon sends as text/plain so technically no preflight — but the response headers still need to permit the cross-origin read. This covers it cleanly.



phase v1.3
# CheckoutMaxx — Cart Intelligence: Complete Spec
> Single source of truth. Covers what's done, what to change, and what comes next.
> Paste the relevant phase section into Claude Code when you're ready to build.

---

## PART 0 — WHAT THIS APP IS (never changes)

CheckoutMaxx is a Shopify embedded app (Next.js 14, App Router, Polaris, Prisma,
Supabase) that gives non-Plus merchants visibility into their cart-to-order funnel.
The core thesis: CRO tools cover landing pages. Shopify analytics covers completed
orders. The cart-to-order gap is a black box. CheckoutMaxx owns it.

**Live repo:** github.com/sum-eet/checkoutmaxx
**Live app:** https://checkoutmaxx-rt55.vercel.app
**Test store:** drwater.myshopify.com

---

## PART 1 — WHAT IS LIVE AND MUST NOT BE TOUCHED

Everything below is deployed, tested, and actively ingesting real data.
**Do not modify any of these files for any reason.**

```
app/api/pixel/ingest/              ← Web Pixel event receiver (sendBeacon)
app/api/jobs/evaluate-alerts/      ← cron, alert engine
app/api/jobs/compute-baselines/    ← cron, baselines
app/api/webhooks/                  ← GDPR + uninstall, HMAC verified
app/(embedded)/                    ← all embedded app pages (4 nav items)
lib/alert-engine.ts
lib/metrics.ts
lib/notifications/
lib/billing.ts
pixel/checkout-monitor.js          ← Web Pixel (sandboxed, sendBeacon only)
prisma/schema.prisma               ← Shop, CheckoutEvent, AlertLog, Baseline
shopify.app.toml
vercel.json
```

**Existing Web Pixel events (live):**
`checkout_started`, `checkout_contact_info_submitted`, `checkout_address_info_submitted`,
`checkout_shipping_info_submitted`, `payment_info_submitted`, `checkout_completed`,
`alert_displayed` (discount failures at checkout), `ui_extension_errored`

**Existing cart extension (live, Phase 1):**
`extensions/cart-monitor/assets/cart-monitor.js` — deployed, injected on drwater.
Currently captures: `cart_fetched`, `cart_item_added`, `cart_item_changed`,
`cart_item_removed`, `cart_bulk_updated`, `cart_checkout_clicked`, `cart_page_hidden`.
Beacons to `/api/cart/log` (temp file, not DB).

---

## PART 2 — WHAT WAS DISCOVERED IN PHASE 1

### How drwater's cart discount works (confirmed via HAR analysis)

The cart drawer on drwater uses **`POST /cart/update`** for all discount code
operations. This is NOT `/discount/apply` or `/cart/apply_coupon`.

**Request payload format:**
```json
{
  "discount": "EXISTINGCODE,NEWCODE",
  "sections": ["sections--19958470410412__header_section"]
}
```

The `discount` field is a comma-separated string of ALL currently active
discount codes. When a customer adds a new code, the theme appends it to
whatever codes are already present and sends the full string.

**Response always contains:**
```json
{
  "discount_codes": [
    {"code": "HYDRATEFIRST", "applicable": false},
    {"code": "NEWCODE", "applicable": true}
  ],
  "total_discount": 1500,
  "total_price": 10999,
  "items": [
    {
      "discounts": [{"amount": 1500, "title": "NEWCODE"}]
    }
  ]
}
```

### Critical observations from HAR

**1. Failure case (invalid/not applicable code):**
- `discount_codes[n].applicable = false`
- `total_discount` stays at 1 (from HYDRATEFIRST automatic discount, always present)
- `cart_level_discount_applications` has the automatic discount entry
- `items[].discounts` is empty for the failed code
- Shopify does NOT return a failure reason string. There is no `error` field.
  `applicable: false` is the only signal.

**2. Success case (PITCHER15 — 15% off the pitcher):**
- `discount_codes[n].applicable = true`
- `total_discount` jumps to 1500 (cents)
- `cart_level_discount_applications` is EMPTY (counter-intuitive but confirmed)
- Discount appears in `items[].discounts[].amount` and `items[].discounts[].title`
- `items[].discounted_price` and `items[].original_price` show before/after

**3. Deduplication needed:**
- The theme fires multiple `/cart/update` requests rapidly when a code is applied
- Some get aborted (status 0) before completing
- Some complete with status 200 with identical payloads
- We must deduplicate by the `discount` field string to avoid emitting the
  same event multiple times

**4. Rebuy also fires `/cart/update.js` (with .js suffix):**
- `POST /cart/update.js` with form-encoded body (not JSON)
- Payload: `attributes[_source]=Rebuy&attributes[_attribution]=Smart Cart 2.0`
- No `discount` field — this is an attribute update, not a coupon operation
- Our interceptor must catch both `/cart/update` and `/cart/update.js`

**5. Failure reason is unknowable from the cart API:**
- Shopify's `/cart/update` response only says `applicable: false`
- It does not say WHY (expired, minimum not met, wrong product, invalid code)
- The `applicable: false` + no matching item discount = the only signal we have
- Failure reason classification only works at checkout via Web Pixel (`alert_displayed`)

### Confirmed working events (Phase 1)

| Event | Status | Notes |
|---|---|---|
| `cart_fetched` | ✅ Working | Deduplication working, Rebuy polling filtered |
| `cart_item_added` | ✅ Working | Dawn fix applied (bare item vs {items:[...]}) |
| `cart_item_changed` | ✅ Working | Dawn fix applied (lineIndex not variantId) |
| `cart_item_removed` | ✅ Working | |
| `cart_bulk_updated` | ✅ Working | Fires for Rebuy cross-sells |
| `cart_checkout_clicked` | ✅ Working | Tightened to submit+name=checkout only |
| `cart_page_hidden` | ✅ Working | |
| `cart_coupon_applied` | ❌ MISSING | Fires as cart_bulk_updated instead |
| `cart_coupon_failed` | ❌ MISSING | Fires as cart_bulk_updated instead |
| `cart_coupon_removed` | ❌ MISSING | Not captured at all |

### Why coupon events are missing

The existing classifier has a coupon block (lines 202–266 in cart-monitor.js)
that looks for `/discount/apply` and `/cart/apply_coupon` URL paths. drwater
never hits those paths. All coupon operations go through `/cart/update`.

The `/cart/update` classifier (line 181) currently fires `cart_bulk_updated`
for everything, with no coupon intelligence extracted.

### Discount path coverage across Shopify themes

| Path | Which themes | Current status |
|---|---|---|
| `POST /cart/update` with `discount` field | drwater, Turbo, many custom | ❌ Fix in Phase 2 |
| `POST /discount/apply` or `/cart/apply_coupon` | Some themes | ✅ Classifier exists (untested on live store) |
| Checkout-only discount field | Dawn default | ✅ Web Pixel `alert_displayed` covers this |

---

## PART 3 — PHASE 2: COUPON INTELLIGENCE FIX

> This is the task to build now.
> Paste this section into Claude Code from the repo root.

### What Phase 2 changes

**One file changes:** `extensions/cart-monitor/assets/cart-monitor.js`

Everything else stays identical. No new endpoints yet. The beacon still goes
to `/api/cart/log`. No DB writes. No schema changes. No Prisma.

**What we're adding:**
Inside the `/cart/update` classifier block, detect when the payload contains
a `discount` field, diff against previously seen discount codes, and emit
clean discrete coupon events instead of the generic `cart_bulk_updated`.

**New events that will fire:**
- `cart_coupon_failed` — a new code appeared in the response with `applicable: false`
- `cart_coupon_applied` — a code appeared or transitioned to `applicable: true`
- `cart_coupon_recovered` — a previously failed code is now `applicable: true`
  (this is the key event: customer added items to meet a minimum and the code unlocked)
- `cart_coupon_removed` — a code was present before, now absent from response

### Exact changes to cart-monitor.js

**Change 1: Add coupon state tracking variables** (after `var lastCartState = null;`)

```javascript
// ── Coupon State ───────────────────────────────────────────────────────
// Track discount codes seen across /cart/update calls.
// Key: code string, Value: boolean (applicable)
var lastDiscountCodes = {};
// Last discount field string sent, to deduplicate rapid-fire requests
var lastDiscountPayload = null;
```

**Change 2: Replace the entire `/cart/update` classifier block**

Find this block (around line 181):
```javascript
// ── Bulk Update ──────────────────────────────────────────────────────
if (path.indexOf('/cart/update') !== -1) {
  return {
    type: 'cart_bulk_updated',
    data: {
      cartValue: responseData && responseData.total_price,
      cartItemCount: responseData && responseData.item_count,
      cartToken: responseData && responseData.token,
      updates: req && req.data && (req.data.updates || req.data),
    },
  };
}
```

Replace with:
```javascript
// ── Cart Update (includes coupon operations) ─────────────────────────
if (path.indexOf('/cart/update') !== -1) {
  var discountField = req && req.data && req.data.discount
    ? String(req.data.discount).trim()
    : null;

  // If this update contains a discount field, extract coupon intelligence
  if (discountField && discountField !== lastDiscountPayload) {
    lastDiscountPayload = discountField;

    var newCodes = (responseData && responseData.discount_codes) || [];
    var couponEvents = [];

    // Find discount amount for a specific code from items[].discounts
    function getDiscountAmount(code) {
      var total = 0;
      var items = (responseData && responseData.items) || [];
      items.forEach(function(item) {
        (item.discounts || []).forEach(function(d) {
          if (d.title === code) total += d.amount;
        });
      });
      return total;
    }

    // Check each code in the response
    newCodes.forEach(function(entry) {
      var code = entry.code;
      var applicable = entry.applicable;
      var wasKnown = lastDiscountCodes.hasOwnProperty(code);
      var wasApplicable = lastDiscountCodes[code];

      if (!wasKnown) {
        // Brand new code we haven't seen before
        if (applicable) {
          couponEvents.push({
            type: 'cart_coupon_applied',
            data: {
              code: code,
              discountAmount: getDiscountAmount(code),
              cartValue: responseData.total_price,
              cartItemCount: responseData.item_count,
              cartToken: responseData.token || cartToken,
              retriedAfterFail: false,
            },
          });
        } else {
          couponEvents.push({
            type: 'cart_coupon_failed',
            data: {
              code: code,
              // Shopify does not return a failure reason from /cart/update.
              // applicable: false is the only signal. Reason classification
              // happens at checkout via Web Pixel alert_displayed event.
              failureReason: 'unknown',
              cartValue: responseData.total_price,
              cartItemCount: responseData.item_count,
              cartToken: responseData.token || cartToken,
            },
          });
        }
      } else if (!wasApplicable && applicable) {
        // Was failing before, now succeeds.
        // This is the "customer added more items to unlock the discount" scenario.
        couponEvents.push({
          type: 'cart_coupon_recovered',
          data: {
            code: code,
            discountAmount: getDiscountAmount(code),
            cartValue: responseData.total_price,
            cartItemCount: responseData.item_count,
            cartToken: responseData.token || cartToken,
            retriedAfterFail: true,
          },
        });
      }
      // Update known state
      lastDiscountCodes[code] = applicable;
    });

    // Check for removed codes (present before, absent now)
    Object.keys(lastDiscountCodes).forEach(function(code) {
      var stillPresent = newCodes.some(function(c) { return c.code === code; });
      if (!stillPresent) {
        couponEvents.push({
          type: 'cart_coupon_removed',
          data: {
            code: code,
            cartValue: responseData && responseData.total_price,
            cartToken: (responseData && responseData.token) || cartToken,
          },
        });
        delete lastDiscountCodes[code];
      }
    });

    // If coupon events were generated, return the first one.
    // The call site needs to be updated to handle arrays (see Change 3).
    if (couponEvents.length > 0) {
      return couponEvents; // array
    }
  }

  // Non-discount update (Rebuy attribute update, quantity bulk update, etc.)
  return {
    type: 'cart_bulk_updated',
    data: {
      cartValue: responseData && responseData.total_price,
      cartItemCount: responseData && responseData.item_count,
      cartToken: responseData && responseData.token,
    },
  };
}
```

**Change 3: Update the call site in the fetch interceptor to handle arrays**

In the fetch interceptor (around line 318), find:
```javascript
clone.json().then(function(responseData) {
  extractCartToken(responseData);
  var classified = classifyCartEvent(url, requestBody, responseData, response.status);
  if (!classified) return;
  logEvent(buildEvent(classified.type, classified.data));
```

Replace with:
```javascript
clone.json().then(function(responseData) {
  extractCartToken(responseData);
  var classified = classifyCartEvent(url, requestBody, responseData, response.status);
  if (!classified) return;
  // classifyCartEvent can return an array (multiple coupon events from one update)
  var events = Array.isArray(classified) ? classified : [classified];
  events.forEach(function(ev) {
    logEvent(buildEvent(ev.type, ev.data));
  });
```

**Change 4: Same update in the XHR interceptor**

Find:
```javascript
var classified = classifyCartEvent(url, self._cmx_requestBody, responseData, self.status);
if (!classified) return;
logEvent(buildEvent(classified.type, classified.data));
```

Replace with:
```javascript
var classified = classifyCartEvent(url, self._cmx_requestBody, responseData, self.status);
if (!classified) return;
var events = Array.isArray(classified) ? classified : [classified];
events.forEach(function(ev) {
  logEvent(buildEvent(ev.type, ev.data));
});
```

**Change 5: Set debug to false**

```javascript
debug: false, // Phase 2: console logging off in production
```

### What does NOT change in cart-monitor.js

- The existing `/discount/apply` and `/cart/apply_coupon` classifier block stays.
  It handles other theme types. Do not remove it.
- All other event classifiers stay identical.
- The XHR interceptor stays identical (except the call site fix above).
- The checkout click listener stays identical.
- The page visibility listener stays identical.
- The init fetch stays identical.

### Deploy sequence

```bash
npx shopify app deploy
git push  # triggers Vercel deploy
```

No `prisma migrate` needed. No new endpoints. No env vars.

### Test scenarios for Phase 2

Run these on drwater.myshopify.com and check console logs
(temporarily set `debug: true` during testing, then set back to `false`).

```
SCENARIO A — Invalid code (never existed)
  Action: Enter "ZZZZTEST99" in the discount field, click Apply
  Expected: cart_coupon_failed { code: "ZZZZTEST99", failureReason: "unknown" }
  Check: fires once, not multiple times (dedup working)

SCENARIO B — Valid code
  Action: Enter "PITCHER15" in the discount field, click Apply
  Expected: cart_coupon_applied { code: "PITCHER15", discountAmount: 1500 }
  Check: discountAmount matches the actual discount in cents

SCENARIO C — Code that fails, then cart modified, then code succeeds
  Action: Enter a minimum-order code with cart below minimum.
          Then add more items until minimum is met.
          Do not re-enter the code — the theme retries automatically on cart update.
  Expected: 
    First: cart_coupon_failed { code: "MINCODE" }
    Then: cart_item_added events
    Then: cart_coupon_recovered { code: "MINCODE", retriedAfterFail: true }
  This is the core use case. Verify the full sequence fires.

SCENARIO D — Remove a code
  Action: Apply a code successfully, then click the X to remove it
  Expected: cart_coupon_removed { code: "PITCHER15" }

SCENARIO E — Multiple codes, one fails one succeeds
  Action: If the theme supports multiple codes, apply two at once
  Expected: Two separate events fired in the same update

SCENARIO F — Rebuy attribute update (no discount field)
  Action: Trigger a Rebuy cross-sell add (this fires /cart/update.js with Rebuy attributes)
  Expected: cart_bulk_updated (no coupon events, because no discount field in payload)
  Check: Rebuy updates do not generate false coupon events
```

---

## PART 4 — PHASE 3: DB INGEST + CART ACTIVITY UI

> Do not build this until Phase 2 test scenarios A–F are all confirmed working.

### Schema changes (add to prisma/schema.prisma)

Add this model after the existing models. Do NOT modify any existing model
except adding the `cartEvents` relation to `Shop`.

```prisma
model CartEvent {
  id               String   @id @default(cuid())
  shopId           String
  sessionId        String
  cartToken        String
  eventType        String   // cart_coupon_failed | cart_coupon_applied |
                            // cart_coupon_recovered | cart_coupon_removed |
                            // cart_item_added | cart_item_changed |
                            // cart_item_removed | cart_bulk_updated |
                            // cart_checkout_clicked | cart_page_hidden
  cartValue        Int?     // cents
  cartItemCount    Int?
  lineItems        Json?    // sanitised — no PII
  couponCode       String?
  couponSuccess    Boolean?
  couponFailReason String?  // unknown | (future: expired | minimum_not_met | etc.)
  couponRecovered  Boolean? // true if cart_coupon_recovered (failed then unlocked)
  discountAmount   Int?     // cents
  lineIndex        Int?
  newQuantity      Int?
  pageUrl          String?
  occurredAt       DateTime
  createdAt        DateTime @default(now())
  shop             Shop     @relation(fields: [shopId], references: [id])

  @@index([shopId, occurredAt])
  @@index([sessionId])
  @@index([cartToken])
  @@index([shopId, eventType, occurredAt])
  @@index([shopId, couponCode, occurredAt])
}
```

Add to `Shop` model:
```prisma
cartEvents CartEvent[]
```

### New endpoint: `app/api/cart/ingest/route.ts`

Replaces `/api/cart/log`. Responds <200ms. Async DB write. CORS headers.
PII sanitisation on lineItems before any write.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  // CORS — extension beacons from the storefront domain
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers });
  }

  // Respond immediately — don't block the beacon
  const responsePromise = NextResponse.json({ ok: true }, { headers });

  try {
    const text = await req.text();
    const event = JSON.parse(text);

    const shopRecord = await prisma.shop.findFirst({
      where: { domain: event.shopDomain },
      select: { id: true },
    });

    if (!shopRecord) return responsePromise;

    const payload = event.payload || {};

    // Sanitise lineItems — strip customer-identifying fields
    const sanitisedLineItems = payload.lineItems
      ? payload.lineItems.map((item: any) => ({
          productId: item.productId,
          variantId: item.variantId,
          productTitle: item.productTitle,
          price: item.price,
          quantity: item.quantity,
        }))
      : null;

    // Write async — don't await, already responded
    prisma.cartEvent.create({
      data: {
        shopId: shopRecord.id,
        sessionId: event.sessionId,
        cartToken: event.cartToken || '',
        eventType: event.eventType,
        cartValue: payload.cartValue ?? null,
        cartItemCount: payload.cartItemCount ?? null,
        lineItems: sanitisedLineItems,
        couponCode: payload.code ?? null,
        couponSuccess: event.eventType === 'cart_coupon_applied' ||
                       event.eventType === 'cart_coupon_recovered'
          ? true
          : event.eventType === 'cart_coupon_failed'
          ? false
          : null,
        couponFailReason: payload.failureReason ?? null,
        couponRecovered: payload.retriedAfterFail ?? null,
        discountAmount: payload.discountAmount ?? null,
        lineIndex: payload.lineIndex ?? null,
        newQuantity: payload.newQuantity ?? null,
        pageUrl: event.url
          ? new URL(event.url).pathname  // strip query params
          : null,
        occurredAt: event.occurredAt
          ? new Date(event.occurredAt)
          : new Date(),
      },
    }).catch((err: Error) => {
      console.error('[cart/ingest] DB write failed:', err.message);
    });
  } catch (err) {
    // Silently swallow — never error to the client
    console.error('[cart/ingest] Parse error:', err);
  }

  return responsePromise;
}
```

### Update liquid block: `extensions/cart-monitor/blocks/cart-monitor.liquid`

Change `data-log-url` to `data-ingest-url` and point to new endpoint:

```liquid
<script
  src="{{ 'cart-monitor.js' | asset_url }}"
  data-shop="{{ shop.permanent_domain }}"
  data-ingest-url="https://checkoutmaxx-rt55.vercel.app/api/cart/ingest"
  defer
></script>
```

Update `cart-monitor.js` CONFIG to read `data-ingest-url`:
```javascript
logUrl: script && script.dataset && script.dataset.ingestUrl
  ? script.dataset.ingestUrl
  : null,
```

### Cleanup Phase 1 files

Delete:
- `app/api/cart/log/route.ts`
- `scripts/read-cart-log.ts`

### Cart Activity UI (5th nav item in embedded app)

Add to the embedded app navigation alongside the existing 4 tabs.

**Key metrics to show:**

**Coupon Intelligence table:**
| Code | Times Tried | Success Rate | Avg Cart Value | Recovered (added items) | Last Seen |
|---|---|---|---|---|---|

Query:
```sql
SELECT
  couponCode,
  COUNT(*) FILTER (WHERE eventType IN ('cart_coupon_failed','cart_coupon_applied','cart_coupon_recovered')) as attempts,
  COUNT(*) FILTER (WHERE couponSuccess = true) as successes,
  COUNT(*) FILTER (WHERE couponRecovered = true) as recovered_after_fail,
  AVG(cartValue) as avg_cart_value,
  MAX(occurredAt) as last_seen
FROM CartEvent
WHERE shopId = $shopId
  AND couponCode IS NOT NULL
  AND occurredAt > NOW() - INTERVAL '30 days'
GROUP BY couponCode
ORDER BY attempts DESC
```

**Cart funnel:**
- Carts started (first `cart_item_added` per session)
- Carts with coupon attempt
- Carts with successful coupon
- Carts that reached checkout (`cart_checkout_clicked`)
- Drop-off % at each stage

**Session timeline view (per session):**
Show the sequence of events for a single session — the cart modification loop
is visible here: coupon_failed → items_added → coupon_recovered → checkout_clicked.

### Deploy sequence for Phase 3

```bash
npx prisma migrate dev --name add_cart_events
npx shopify app deploy
git push
```

---

## PART 5 — ABSOLUTE HARD RULES (all phases)

1. Never call `cartDiscountCodesUpdate` or any Shopify Storefront API mutation
   from the extension. We are an observer only. Never an actor.

2. No localStorage or sessionStorage in the pixel. sessionStorage is used only
   for the session ID (not cart data).

3. No raw PII in any CartEvent write. Sanitise lineItems before every DB write.
   Strip: customer name, email, address, phone.

4. Ingest endpoints respond <200ms. DB writes are always async (fire and forget).

5. No Shopify Plus-only APIs anywhere.

6. The theme extension JS is plain browser JavaScript. No TypeScript, no imports,
   no bundler. It runs directly in the browser as-is.

7. `npm run build` must pass clean after every phase.

8. Do not modify `pixel/checkout-monitor.js` or `app/api/pixel/ingest/`.

9. Do not modify any existing Prisma model — only add new models and new fields.

10. Coupon failure reason from `/cart/update` is always `unknown`. Shopify
    does not return the reason. Do not attempt to infer it. The reason is
    only available at checkout via Web Pixel `alert_displayed`.

---

## PART 6 — PENDING ITEMS OUTSIDE CART INTELLIGENCE

These were pending before cart work began and remain pending:

- App Store submission (`/mnt/user-data/outputs/checkoutmaxx-submission-prompt.md`)
- App Store screenshots (5 × 1280×800) + icon (1200×1200)
- WhatsApp notifications (v2)
- Checkout Health Score 0–100
- Alia-style persistent top bar + live checkout view

next version HERE
# CheckoutMaxx — Cart Intelligence Phase 3
> Paste this entire prompt into Claude Code from the repo root.
> Phase 2 (coupon events in cart-monitor.js) is confirmed working.
> Phase 3 wires everything into the DB and builds the Cart Activity UI.

---

## CONTEXT — WHAT EXISTS AND MUST NOT BE TOUCHED

CheckoutMaxx is live. The following is untouchable:

```
app/api/pixel/ingest/              ← Web Pixel event receiver
app/api/jobs/evaluate-alerts/      ← cron, alert engine
app/api/jobs/compute-baselines/    ← cron, baselines
app/api/webhooks/                  ← GDPR + uninstall, HMAC verified
lib/alert-engine.ts
lib/metrics.ts
lib/notifications/
lib/billing.ts
pixel/checkout-monitor.js
shopify.app.toml
vercel.json
```

**Existing Prisma models (do not modify their fields):**
- `Shop` — add one relation field only: `cartEvents CartEvent[]`
- `CheckoutEvent` — read-only, queried for the session timeline join
- `AlertLog`, `Baseline` — do not touch

**Existing nav (4 tabs, do not modify their routes or components):**
```
Converted Carts     → /dashboard/converted
Abandoned Carts     → /dashboard/abandoned
Notifications       → /alerts
Settings            → /settings
```

**Existing cart extension:**
`extensions/cart-monitor/assets/cart-monitor.js` — live, beaconing to
`/api/cart/log`. Do not modify the JS. You are replacing the endpoint it
points to and updating the liquid block only.

---

## WHAT YOU ARE BUILDING

### 1. Prisma schema — new `CartEvent` model
### 2. New endpoint — `app/api/cart/ingest/route.ts`
### 3. Update liquid block to point to new endpoint
### 4. Delete Phase 1 temp files
### 5. Cart Activity page — `app/(embedded)/dashboard/cart/page.tsx`
### 6. Session detail modal/drawer
### 7. Coupon Intelligence tab
### 8. Add Cart Activity as 5th nav item

---

## STEP 1 — PRISMA SCHEMA

Open `prisma/schema.prisma`.

Add to the existing `Shop` model (one line only, do not change anything else):
```prisma
cartEvents CartEvent[]
```

Add this new model after all existing models:

```prisma
model CartEvent {
  id               String   @id @default(cuid())
  shopId           String
  sessionId        String
  cartToken        String
  eventType        String
  // eventType values:
  // cart_fetched | cart_item_added | cart_item_changed | cart_item_removed
  // cart_bulk_updated | cart_checkout_clicked | cart_page_hidden
  // cart_coupon_applied | cart_coupon_failed | cart_coupon_recovered | cart_coupon_removed

  cartValue        Int?     // in cents
  cartItemCount    Int?
  lineItems        Json?    // sanitised array: [{productId, variantId, productTitle, price, quantity}]
  couponCode       String?
  couponSuccess    Boolean?
  couponFailReason String?  // always "unknown" from cart; real reason at checkout via Web Pixel
  couponRecovered  Boolean? // true = customer added items after failure to unlock discount
  discountAmount   Int?     // in cents
  lineIndex        Int?
  newQuantity      Int?
  pageUrl          String?
  occurredAt       DateTime
  createdAt        DateTime @default(now())

  shop Shop @relation(fields: [shopId], references: [id])

  @@index([shopId, occurredAt])
  @@index([sessionId])
  @@index([cartToken])
  @@index([shopId, eventType, occurredAt])
  @@index([shopId, couponCode, occurredAt])
}
```

Run:
```bash
npx prisma migrate dev --name add_cart_events
```

---

## STEP 2 — INGEST ENDPOINT

Create `app/api/cart/ingest/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  // Respond immediately — sendBeacon doesn't wait for response
  // All processing is fire-and-forget after this point
  void processEvent(req);
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}

async function processEvent(req: NextRequest) {
  try {
    const text = await req.text();
    if (!text) return;

    const event = JSON.parse(text);
    const { eventType, shopDomain, sessionId, cartToken, occurredAt, url, payload = {} } = event;

    if (!eventType || !shopDomain || !sessionId) return;

    // Skip noisy low-value events to keep DB lean
    if (eventType === 'cart_fetched' || eventType === 'cart_unknown_endpoint') return;

    const shop = await prisma.shop.findFirst({
      where: { domain: shopDomain },
      select: { id: true },
    });
    if (!shop) return;

    // Sanitise lineItems — strip any PII, keep only product data
    const sanitisedLineItems = Array.isArray(payload.lineItems)
      ? payload.lineItems.map((item: any) => ({
          productId: item.productId ?? null,
          variantId: item.variantId ?? null,
          productTitle: item.productTitle ?? null,
          price: item.price ?? null,
          quantity: item.quantity ?? null,
        }))
      : null;

    // Determine coupon fields
    const isCouponEvent = [
      'cart_coupon_applied',
      'cart_coupon_failed',
      'cart_coupon_recovered',
      'cart_coupon_removed',
    ].includes(eventType);

    const couponSuccess = eventType === 'cart_coupon_applied' || eventType === 'cart_coupon_recovered'
      ? true
      : eventType === 'cart_coupon_failed'
      ? false
      : null;

    // Sanitise pageUrl — strip query params (may contain discount codes, session tokens)
    let sanitisedUrl: string | null = null;
    try {
      sanitisedUrl = url ? new URL(url).pathname : null;
    } catch {
      sanitisedUrl = null;
    }

    await prisma.cartEvent.create({
      data: {
        shopId: shop.id,
        sessionId,
        cartToken: cartToken ?? '',
        eventType,
        cartValue: typeof payload.cartValue === 'number' ? payload.cartValue : null,
        cartItemCount: typeof payload.cartItemCount === 'number' ? payload.cartItemCount : null,
        lineItems: sanitisedLineItems,
        couponCode: isCouponEvent ? (payload.code ?? null) : null,
        couponSuccess,
        couponFailReason: payload.failureReason ?? null,
        couponRecovered: payload.retriedAfterFail ?? null,
        discountAmount: typeof payload.discountAmount === 'number' ? payload.discountAmount : null,
        lineIndex: typeof payload.lineIndex === 'number' ? payload.lineIndex : null,
        newQuantity: typeof payload.newQuantity === 'number' ? payload.newQuantity : null,
        pageUrl: sanitisedUrl,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      },
    });
  } catch (err) {
    // Never surface errors — beacon is fire-and-forget
    console.error('[cart/ingest]', err);
  }
}
```

---

## STEP 3 — UPDATE LIQUID BLOCK

Open `extensions/cart-monitor/blocks/cart-monitor.liquid`.

Change `data-log-url` to `data-ingest-url` and point to the new endpoint.
Read the actual Vercel URL from `.env.local` or `vercel.json` — do not leave
a placeholder:

```liquid
{% comment %}
  CheckoutMaxx Cart Monitor
  Injected automatically on all storefront pages via theme app extension.
{% endcomment %}

<script
  src="{{ 'cart-monitor.js' | asset_url }}"
  data-shop="{{ shop.permanent_domain }}"
  data-ingest-url="https://checkoutmaxx-rt55.vercel.app/api/cart/ingest"
  defer
></script>
```

Open `extensions/cart-monitor/assets/cart-monitor.js`.
Find the CONFIG block and change `logUrl` to read from `data-ingest-url`:

```javascript
logUrl: script && script.dataset && script.dataset.ingestUrl
  ? script.dataset.ingestUrl
  : null,
```

Also set `debug: false` in the CONFIG block.

---

## STEP 4 — DELETE PHASE 1 TEMP FILES

```bash
rm app/api/cart/log/route.ts
rm scripts/read-cart-log.ts
```

Remove the entries from `.gitignore` if they were added there.

---

## STEP 5 — DATA QUERIES

Create `lib/cart-metrics.ts`. These are the queries that power the UI.

```typescript
import { prisma } from '@/lib/prisma';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CartSession = {
  sessionId: string;
  cartToken: string;
  firstSeen: Date;
  lastSeen: Date;
  cartValue: number | null;        // last known cart value in cents
  cartItemCount: number | null;
  lineItems: any[];                // from last cart_item_added/changed event
  couponsAttempted: CouponAttempt[];
  checkedOut: boolean;
  orderCompleted: boolean;         // from CheckoutEvent
  checkoutEvents: CheckoutStep[];  // stitched from CheckoutEvent table
};

export type CouponAttempt = {
  code: string;
  success: boolean;
  recovered: boolean;   // failed then unlocked after cart modification
  discountAmount: number | null;
};

export type CheckoutStep = {
  eventType: string;
  occurredAt: Date;
};

export type CouponStat = {
  code: string;
  attempts: number;
  successes: number;
  recoveries: number;
  avgCartValue: number | null;
  lastSeen: Date;
};

export type CartKPIs = {
  cartsOpened: number;
  cartsWithCoupon: number;
  cartsCheckedOut: number;
  recoveredCarts: number;
  recoveredRevenue: number;  // cents
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────

export async function getCartKPIs(shopId: string): Promise<CartKPIs> {
  const since = startOfToday();

  const [sessions, couponSessions, checkoutSessions, recoveries] = await Promise.all([
    // Distinct sessions that had any cart event today
    prisma.cartEvent.findMany({
      where: { shopId, occurredAt: { gte: since } },
      select: { sessionId: true },
      distinct: ['sessionId'],
    }),

    // Sessions that attempted at least one coupon
    prisma.cartEvent.findMany({
      where: {
        shopId,
        occurredAt: { gte: since },
        eventType: { in: ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'] },
      },
      select: { sessionId: true },
      distinct: ['sessionId'],
    }),

    // Sessions that clicked checkout
    prisma.cartEvent.findMany({
      where: { shopId, occurredAt: { gte: since }, eventType: 'cart_checkout_clicked' },
      select: { sessionId: true },
      distinct: ['sessionId'],
    }),

    // Recovered carts (failed coupon then unlocked)
    prisma.cartEvent.findMany({
      where: { shopId, occurredAt: { gte: since }, eventType: 'cart_coupon_recovered' },
      select: { sessionId: true, cartValue: true, discountAmount: true },
      distinct: ['sessionId'],
    }),
  ]);

  const recoveredRevenue = recoveries.reduce((sum, r) => sum + (r.cartValue ?? 0), 0);

  return {
    cartsOpened: sessions.length,
    cartsWithCoupon: couponSessions.length,
    cartsCheckedOut: checkoutSessions.length,
    recoveredCarts: recoveries.length,
    recoveredRevenue,
  };
}

// ── Session List ──────────────────────────────────────────────────────────────

export async function getCartSessions(shopId: string): Promise<CartSession[]> {
  const since = startOfToday();

  // Get all cart events for today, ordered by time
  const events = await prisma.cartEvent.findMany({
    where: { shopId, occurredAt: { gte: since } },
    orderBy: { occurredAt: 'asc' },
  });

  if (events.length === 0) return [];

  // Group events by sessionId
  const bySession = new Map<string, typeof events>();
  for (const ev of events) {
    if (!bySession.has(ev.sessionId)) bySession.set(ev.sessionId, []);
    bySession.get(ev.sessionId)!.push(ev);
  }

  // Get all distinct sessionIds to join with CheckoutEvent
  const sessionIds = Array.from(bySession.keys());

  // Fetch checkout events for these sessions (cross-table join)
  const checkoutEvents = await prisma.checkoutEvent.findMany({
    where: { shopId, sessionId: { in: sessionIds } },
    select: { sessionId: true, eventType: true, occurredAt: true },
    orderBy: { occurredAt: 'asc' },
  });

  const checkoutBySession = new Map<string, CheckoutStep[]>();
  for (const ce of checkoutEvents) {
    if (!checkoutBySession.has(ce.sessionId)) checkoutBySession.set(ce.sessionId, []);
    checkoutBySession.get(ce.sessionId)!.push({
      eventType: ce.eventType,
      occurredAt: ce.occurredAt,
    });
  }

  // Build CartSession objects
  const sessions: CartSession[] = [];

  for (const [sessionId, evs] of bySession) {
    // Last known cart state (most recent event with cartValue)
    const lastWithValue = [...evs].reverse().find(e => e.cartValue != null);
    const lastWithItems = [...evs].reverse().find(e => e.lineItems != null);

    // Coupon attempts — deduplicated by code, last state wins
    const couponMap = new Map<string, CouponAttempt>();
    for (const ev of evs) {
      if (!ev.couponCode) continue;
      const existing = couponMap.get(ev.couponCode);
      couponMap.set(ev.couponCode, {
        code: ev.couponCode,
        success: ev.couponSuccess ?? existing?.success ?? false,
        recovered: ev.couponRecovered ?? existing?.recovered ?? false,
        discountAmount: ev.discountAmount ?? existing?.discountAmount ?? null,
      });
    }

    const checkoutSteps = checkoutBySession.get(sessionId) ?? [];
    const checkedOut = evs.some(e => e.eventType === 'cart_checkout_clicked') ||
                       checkoutSteps.length > 0;
    const orderCompleted = checkoutSteps.some(e => e.eventType === 'checkout_completed');

    sessions.push({
      sessionId,
      cartToken: evs[0].cartToken,
      firstSeen: evs[0].occurredAt,
      lastSeen: evs[evs.length - 1].occurredAt,
      cartValue: lastWithValue?.cartValue ?? null,
      cartItemCount: lastWithValue?.cartItemCount ?? null,
      lineItems: (lastWithItems?.lineItems as any[]) ?? [],
      couponsAttempted: Array.from(couponMap.values()),
      checkedOut,
      orderCompleted,
      checkoutEvents: checkoutSteps,
    });
  }

  // Sort: most recent first
  return sessions.sort((a, b) => b.firstSeen.getTime() - a.firstSeen.getTime());
}

// ── Session Timeline (for detail view) ────────────────────────────────────────

export type TimelineEvent = {
  source: 'cart' | 'checkout';
  eventType: string;
  occurredAt: Date;
  label: string;
  detail: string | null;
  isPositive: boolean | null;  // null = neutral
};

export async function getSessionTimeline(shopId: string, sessionId: string): Promise<TimelineEvent[]> {
  const [cartEvents, checkoutEvents] = await Promise.all([
    prisma.cartEvent.findMany({
      where: { shopId, sessionId },
      orderBy: { occurredAt: 'asc' },
    }),
    prisma.checkoutEvent.findMany({
      where: { shopId, sessionId },
      select: { eventType: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    }),
  ]);

  const timeline: TimelineEvent[] = [];

  for (const ev of cartEvents) {
    let label = '';
    let detail: string | null = null;
    let isPositive: boolean | null = null;
    const payload = ev as any;

    switch (ev.eventType) {
      case 'cart_item_added':
        label = 'Added item to cart';
        detail = ev.cartValue != null ? `Cart: ${formatCents(ev.cartValue)}` : null;
        isPositive = null;
        break;
      case 'cart_item_changed':
        label = `Changed quantity to ${ev.newQuantity}`;
        detail = ev.cartValue != null ? `Cart: ${formatCents(ev.cartValue)}` : null;
        isPositive = null;
        break;
      case 'cart_item_removed':
        label = 'Removed item';
        detail = ev.cartValue != null ? `Cart: ${formatCents(ev.cartValue)}` : null;
        isPositive = null;
        break;
      case 'cart_coupon_applied':
        label = `Applied coupon ${ev.couponCode}`;
        detail = ev.discountAmount != null ? `Saved ${formatCents(ev.discountAmount)}` : null;
        isPositive = true;
        break;
      case 'cart_coupon_failed':
        label = `Tried coupon ${ev.couponCode}`;
        detail = 'Not applicable';
        isPositive = false;
        break;
      case 'cart_coupon_recovered':
        label = `Coupon ${ev.couponCode} unlocked`;
        detail = ev.discountAmount != null
          ? `Added items to qualify — saved ${formatCents(ev.discountAmount)}`
          : 'Added items to qualify';
        isPositive = true;
        break;
      case 'cart_coupon_removed':
        label = `Removed coupon ${ev.couponCode}`;
        isPositive = null;
        break;
      case 'cart_checkout_clicked':
        label = 'Clicked checkout';
        isPositive = null;
        break;
      case 'cart_page_hidden':
        label = 'Left the page';
        isPositive = null;
        break;
      default:
        label = ev.eventType;
    }

    timeline.push({ source: 'cart', eventType: ev.eventType, occurredAt: ev.occurredAt, label, detail, isPositive });
  }

  for (const ev of checkoutEvents) {
    const labels: Record<string, string> = {
      checkout_started: 'Reached checkout',
      checkout_contact_info_submitted: 'Filled contact info',
      checkout_address_info_submitted: 'Filled shipping address',
      checkout_shipping_info_submitted: 'Selected shipping method',
      payment_info_submitted: 'Entered payment',
      checkout_completed: 'Order completed ✓',
    };
    timeline.push({
      source: 'checkout',
      eventType: ev.eventType,
      occurredAt: ev.occurredAt,
      label: labels[ev.eventType] ?? ev.eventType,
      detail: null,
      isPositive: ev.eventType === 'checkout_completed' ? true : null,
    });
  }

  return timeline.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

// ── Coupon Intelligence ───────────────────────────────────────────────────────

export async function getCouponStats(shopId: string): Promise<CouponStat[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days

  const events = await prisma.cartEvent.findMany({
    where: {
      shopId,
      occurredAt: { gte: since },
      couponCode: { not: null },
      eventType: { in: ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'] },
    },
    select: {
      couponCode: true,
      couponSuccess: true,
      couponRecovered: true,
      cartValue: true,
      occurredAt: true,
    },
  });

  const statsMap = new Map<string, {
    attempts: number;
    successes: number;
    recoveries: number;
    cartValues: number[];
    lastSeen: Date;
  }>();

  for (const ev of events) {
    const code = ev.couponCode!;
    if (!statsMap.has(code)) {
      statsMap.set(code, { attempts: 0, successes: 0, recoveries: 0, cartValues: [], lastSeen: ev.occurredAt });
    }
    const s = statsMap.get(code)!;
    s.attempts++;
    if (ev.couponSuccess) s.successes++;
    if (ev.couponRecovered) s.recoveries++;
    if (ev.cartValue != null) s.cartValues.push(ev.cartValue);
    if (ev.occurredAt > s.lastSeen) s.lastSeen = ev.occurredAt;
  }

  return Array.from(statsMap.entries())
    .map(([code, s]) => ({
      code,
      attempts: s.attempts,
      successes: s.successes,
      recoveries: s.recoveries,
      avgCartValue: s.cartValues.length > 0
        ? Math.round(s.cartValues.reduce((a, b) => a + b, 0) / s.cartValues.length)
        : null,
      lastSeen: s.lastSeen,
    }))
    .sort((a, b) => b.attempts - a.attempts);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}
```

---

## STEP 6 — CART ACTIVITY PAGE

Create `app/(embedded)/dashboard/cart/page.tsx`.

This page has two tabs: **Sessions** (default) and **Coupon Intelligence**.

```tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  DataTable,
  Badge,
  Tabs,
  Banner,
  Spinner,
  BlockStack,
  InlineStack,
  Box,
  Modal,
  EmptyState,
} from '@shopify/polaris';

// ── Types (mirror lib/cart-metrics.ts) ───────────────────────────────────────

type CouponAttempt = {
  code: string;
  success: boolean;
  recovered: boolean;
  discountAmount: number | null;
};

type CartSession = {
  sessionId: string;
  cartToken: string;
  firstSeen: string;
  lastSeen: string;
  cartValue: number | null;
  cartItemCount: number | null;
  lineItems: any[];
  couponsAttempted: CouponAttempt[];
  checkedOut: boolean;
  orderCompleted: boolean;
  checkoutEvents: { eventType: string; occurredAt: string }[];
};

type TimelineEvent = {
  source: 'cart' | 'checkout';
  eventType: string;
  occurredAt: string;
  label: string;
  detail: string | null;
  isPositive: boolean | null;
};

type CouponStat = {
  code: string;
  attempts: number;
  successes: number;
  recoveries: number;
  avgCartValue: number | null;
  lastSeen: string;
};

type KPIs = {
  cartsOpened: number;
  cartsWithCoupon: number;
  cartsCheckedOut: number;
  recoveredCarts: number;
  recoveredRevenue: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCents(cents: number | null): string {
  if (cents == null) return '—';
  return '$' + (cents / 100).toFixed(2);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function successRate(successes: number, attempts: number): string {
  if (attempts === 0) return '—';
  return Math.round((successes / attempts) * 100) + '%';
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text variant="bodySm" as="p" tone="subdued">{label}</Text>
        <Text variant="headingLg" as="p">{value}</Text>
        {sub && <Text variant="bodySm" as="p" tone="subdued">{sub}</Text>}
      </BlockStack>
    </Card>
  );
}

// ── Coupon Pills ──────────────────────────────────────────────────────────────

function CouponPills({ coupons }: { coupons: CouponAttempt[] }) {
  if (coupons.length === 0) return <Text as="span" tone="subdued">—</Text>;
  return (
    <InlineStack gap="100" wrap>
      {coupons.map((c) => (
        <Badge
          key={c.code}
          tone={c.success ? 'success' : 'critical'}
        >
          {c.recovered ? '↑ ' : ''}{c.code}
          {c.success && c.discountAmount ? ` −${formatCents(c.discountAmount)}` : ''}
        </Badge>
      ))}
    </InlineStack>
  );
}

// ── Timeline Modal ────────────────────────────────────────────────────────────

function TimelineModal({
  session,
  open,
  onClose,
}: {
  session: CartSession | null;
  open: boolean;
  onClose: () => void;
}) {
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !session) return;
    setLoading(true);
    fetch(`/api/cart/session?sessionId=${session.sessionId}`)
      .then((r) => r.json())
      .then((data) => setTimeline(data.timeline ?? []))
      .finally(() => setLoading(false));
  }, [open, session?.sessionId]);

  if (!session) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Session — ${formatTime(session.firstSeen)}`}
      size="large"
    >
      <Modal.Section>
        {/* Cart summary */}
        <BlockStack gap="200">
          <InlineStack gap="400">
            <Text as="p" variant="bodyMd">
              <strong>Cart value:</strong> {formatCents(session.cartValue)}
            </Text>
            <Text as="p" variant="bodyMd">
              <strong>Items:</strong> {session.cartItemCount ?? '—'}
            </Text>
            <Text as="p" variant="bodyMd">
              <strong>Outcome:</strong>{' '}
              {session.orderCompleted
                ? '✅ Order completed'
                : session.checkedOut
                ? '🛒 Reached checkout'
                : '❌ Abandoned'}
            </Text>
          </InlineStack>

          {/* Products */}
          {session.lineItems.length > 0 && (
            <Box paddingBlockStart="300">
              <Text variant="headingSm" as="p">Products in cart</Text>
              <BlockStack gap="100">
                {session.lineItems.map((item: any, i: number) => (
                  <Text key={i} as="p" variant="bodySm">
                    {item.productTitle} × {item.quantity} — {formatCents(item.price)}
                  </Text>
                ))}
              </BlockStack>
            </Box>
          )}
        </BlockStack>
      </Modal.Section>

      <Modal.Section>
        <Text variant="headingSm" as="p">Full journey</Text>
        <Box paddingBlockStart="200">
          {loading ? (
            <Spinner size="small" />
          ) : timeline.length === 0 ? (
            <Text as="p" tone="subdued">No events found</Text>
          ) : (
            <BlockStack gap="200">
              {timeline.map((ev, i) => (
                <InlineStack key={i} gap="300" align="start" blockAlign="start">
                  {/* Time */}
                  <Box minWidth="50px">
                    <Text variant="bodySm" as="p" tone="subdued">
                      {formatTime(ev.occurredAt)}
                    </Text>
                  </Box>

                  {/* Source badge */}
                  <Badge tone={ev.source === 'checkout' ? 'info' : undefined}>
                    {ev.source === 'checkout' ? 'Checkout' : 'Cart'}
                  </Badge>

                  {/* Label + detail */}
                  <BlockStack gap="050">
                    <Text
                      as="p"
                      variant="bodySm"
                      tone={
                        ev.isPositive === true
                          ? 'success'
                          : ev.isPositive === false
                          ? 'critical'
                          : undefined
                      }
                    >
                      {ev.label}
                    </Text>
                    {ev.detail && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {ev.detail}
                      </Text>
                    )}
                  </BlockStack>
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </Box>
      </Modal.Section>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CartActivityPage() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [sessions, setSessions] = useState<CartSession[]>([]);
  const [couponStats, setCouponStats] = useState<CouponStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<CartSession | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/cart/kpis').then((r) => r.json()),
      fetch('/api/cart/sessions').then((r) => r.json()),
      fetch('/api/cart/coupons').then((r) => r.json()),
    ]).then(([kpiData, sessionData, couponData]) => {
      setKpis(kpiData.kpis);
      setSessions(sessionData.sessions ?? []);
      setCouponStats(couponData.stats ?? []);
      setLoading(false);
    });
  }, []);

  const tabs = [
    { id: 'sessions', content: 'Cart Sessions' },
    { id: 'coupons', content: 'Coupon Intelligence' },
  ];

  // ── Sessions tab ─────────────────────────────────────────────────────────

  const sessionRows = sessions.map((s) => [
    // Time
    <Text as="span" variant="bodySm">{formatTime(s.firstSeen)}</Text>,

    // Products
    <Text as="span" variant="bodySm">
      {s.lineItems.length > 0
        ? s.lineItems.map((i: any) => `${i.productTitle} ×${i.quantity}`).join(', ')
        : s.cartItemCount != null
        ? `${s.cartItemCount} item${s.cartItemCount !== 1 ? 's' : ''}`
        : '—'}
    </Text>,

    // Cart value
    <Text as="span" variant="bodySm">{formatCents(s.cartValue)}</Text>,

    // Coupons
    <CouponPills coupons={s.couponsAttempted} />,

    // Outcome
    s.orderCompleted ? (
      <Badge tone="success">Ordered</Badge>
    ) : s.checkedOut ? (
      <Badge tone="attention">Checkout</Badge>
    ) : (
      <Badge tone="critical">Abandoned</Badge>
    ),

    // View link
    <Text
      as="span"
      variant="bodySm"
      tone="magic"
    >
      <span
        style={{ cursor: 'pointer', textDecoration: 'underline' }}
        onClick={() => {
          setSelectedSession(s);
          setModalOpen(true);
        }}
      >
        View
      </span>
    </Text>,
  ]);

  // ── Coupons tab ──────────────────────────────────────────────────────────

  const couponRows = couponStats.map((c) => [
    <Text as="span" variant="bodySm" fontWeight="semibold">{c.code}</Text>,
    <Text as="span" variant="bodySm">{c.attempts}</Text>,
    <Text as="span" variant="bodySm">
      <Badge tone={c.successes / c.attempts >= 0.5 ? 'success' : 'critical'}>
        {successRate(c.successes, c.attempts)}
      </Badge>
    </Text>,
    <Text as="span" variant="bodySm">{formatCents(c.avgCartValue)}</Text>,
    c.recoveries > 0 ? (
      <Badge tone="attention">{c.recoveries} unlocked after adding items</Badge>
    ) : (
      <Text as="span" variant="bodySm" tone="subdued">—</Text>
    ),
    <Text as="span" variant="bodySm" tone="subdued">
      {new Date(c.lastSeen).toLocaleDateString()}
    </Text>,
  ]);

  if (loading) {
    return (
      <Page title="Cart Activity">
        <Layout>
          <Layout.Section>
            <Card><Box padding="800"><Spinner /></Box></Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="Cart Activity" subtitle="Today's cart sessions — live">
      <Layout>

        {/* KPI Cards */}
        <Layout.Section>
          <InlineStack gap="400" wrap>
            <KPICard
              label="Carts opened"
              value={kpis?.cartsOpened ?? 0}
            />
            <KPICard
              label="Coupon attempted"
              value={kpis?.cartsWithCoupon ?? 0}
              sub={kpis && kpis.cartsOpened > 0
                ? `${Math.round((kpis.cartsWithCoupon / kpis.cartsOpened) * 100)}% of carts`
                : undefined}
            />
            <KPICard
              label="Reached checkout"
              value={kpis?.cartsCheckedOut ?? 0}
              sub={kpis && kpis.cartsOpened > 0
                ? `${Math.round((kpis.cartsCheckedOut / kpis.cartsOpened) * 100)}% conversion`
                : undefined}
            />
          </InlineStack>
        </Layout.Section>

        {/* Recovered revenue banner — only show if > 0 */}
        {kpis && kpis.recoveredCarts > 0 && (
          <Layout.Section>
            <Banner tone="success">
              <Text as="p" variant="bodyMd">
                💡 <strong>{kpis.recoveredCarts} customer{kpis.recoveredCarts !== 1 ? 's' : ''}</strong> unlocked
                a discount by adding items after a failed coupon — {formatCents(kpis.recoveredRevenue)} in
                recovered cart value today.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Tabs */}
        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box padding="400">

                {/* Sessions tab */}
                {selectedTab === 0 && (
                  sessions.length === 0 ? (
                    <EmptyState
                      heading="No cart sessions today yet"
                      image=""
                    >
                      <Text as="p">Sessions will appear here as customers interact with their carts.</Text>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text']}
                      headings={['Time', 'Products', 'Cart value', 'Coupons', 'Outcome', '']}
                      rows={sessionRows}
                    />
                  )
                )}

                {/* Coupon Intelligence tab */}
                {selectedTab === 1 && (
                  couponStats.length === 0 ? (
                    <EmptyState
                      heading="No coupon data yet"
                      image=""
                    >
                      <Text as="p">Coupon attempts will appear here once customers try discount codes.</Text>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'numeric', 'text', 'text', 'text', 'text']}
                      headings={['Code', 'Attempts', 'Success rate', 'Avg cart value', 'Unlocked after fail', 'Last used']}
                      rows={couponRows}
                    />
                  )
                )}

              </Box>
            </Tabs>
          </Card>
        </Layout.Section>

      </Layout>

      {/* Session detail modal */}
      <TimelineModal
        session={selectedSession}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </Page>
  );
}
```

---

## STEP 7 — API ROUTES FOR THE UI

Create these three lightweight API routes. Each reads from the DB and
returns JSON. All are protected by the existing Shopify session auth pattern
used by the other dashboard routes — follow the exact same auth pattern
already in `app/(embedded)/dashboard/`.

**`app/api/cart/kpis/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCartKPIs } from '@/lib/cart-metrics';
import { getShopId } from '@/lib/auth'; // use existing auth helper

export async function GET(req: NextRequest) {
  const shopId = await getShopId(req);
  if (!shopId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const kpis = await getCartKPIs(shopId);
  return NextResponse.json({ kpis });
}
```

**`app/api/cart/sessions/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCartSessions } from '@/lib/cart-metrics';
import { getShopId } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const shopId = await getShopId(req);
  if (!shopId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sessions = await getCartSessions(shopId);
  return NextResponse.json({ sessions });
}
```

**`app/api/cart/coupons/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCouponStats } from '@/lib/cart-metrics';
import { getShopId } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const shopId = await getShopId(req);
  if (!shopId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const stats = await getCouponStats(shopId);
  return NextResponse.json({ stats });
}
```

**`app/api/cart/session/route.ts`** (for the timeline modal)
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTimeline } from '@/lib/cart-metrics';
import { getShopId } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const shopId = await getShopId(req);
  if (!shopId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  const timeline = await getSessionTimeline(shopId, sessionId);
  return NextResponse.json({ timeline });
}
```

**Important:** Read the existing auth pattern from `app/(embedded)/dashboard/`
before writing these routes. Match it exactly — do not invent a new auth approach.

---

## STEP 8 — ADD CART ACTIVITY TO NAV

Open the nav component used by the embedded app layout. It will be in
`app/(embedded)/` — find it by looking for where the existing 4 nav items
are defined (Converted Carts, Abandoned Carts, Notifications, Settings).

Add Cart Activity as the 5th item:
```
label: 'Cart Activity'
destination: '/dashboard/cart'
icon: CartIcon  (or whichever Polaris icon fits — CartFilledIcon, AnalyticsIcon)
```

Place it between Abandoned Carts and Notifications.

---

## STEP 9 — DEPLOY AND VERIFY

```bash
npx prisma migrate dev --name add_cart_events
npx shopify app deploy
git push
```

### Verification checklist

- [ ] `/api/cart/ingest` returns 200 immediately for a test beacon
- [ ] After entering a discount code on drwater, a `CartEvent` row appears in DB
- [ ] `cart_coupon_applied` event has correct `discountAmount` in cents
- [ ] `cart_coupon_failed` event has `couponSuccess: false`
- [ ] `cart_coupon_recovered` event has `couponRecovered: true`
- [ ] Cart Activity tab appears in embedded app nav
- [ ] KPI cards show correct counts for today
- [ ] Sessions table shows today's sessions
- [ ] Clicking View opens the timeline modal
- [ ] Timeline shows both Cart events and Checkout events in order
- [ ] Recovered revenue banner appears when `recoveredCarts > 0`
- [ ] Coupon Intelligence tab shows codes with success rates
- [ ] `npm run build` passes clean

---

## ABSOLUTE HARD RULES

1. Do not modify any existing file except:
   - `prisma/schema.prisma` (add CartEvent model + relation to Shop)
   - `extensions/cart-monitor/blocks/cart-monitor.liquid` (update endpoint URL)
   - `extensions/cart-monitor/assets/cart-monitor.js` (update CONFIG key + debug:false)
   - The nav component (add 5th item)
   - `.gitignore` (remove Phase 1 entries)

2. Do not touch `pixel/checkout-monitor.js` or `app/api/pixel/ingest/`.

3. Do not modify existing Prisma models (Shop, CheckoutEvent, AlertLog, Baseline)
   except adding `cartEvents CartEvent[]` to Shop.

4. Ingest endpoint responds immediately. DB write is always fire-and-forget.
   Never await the DB write before responding.

5. No PII in CartEvent. PageUrl is stored as pathname only (strip query params).
   LineItems contain productTitle, price, quantity only — no customer fields.

6. The auth pattern in the 4 new API routes must match exactly what the existing
   dashboard routes use. Read them first before writing the auth code.

7. `npm run build` must pass clean.