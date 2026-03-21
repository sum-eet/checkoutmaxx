# CouponMaxx Data Pipeline Fix

## Root cause summary

There are 4 bugs, each independently blocking data flow. Fix all 4.

| # | File | Bug | Impact |
|---|------|-----|--------|
| 1 | `pixel/checkout-monitor.js` | INGEST_URL hardcoded to Dr. Water's Vercel URL | All checkout events go to wrong app |
| 2 | `pixel/checkout-monitor.js` | No storefront event subscriptions | Homepage/cart analytics = always empty |
| 3 | `app/api/pixel/ingest/route.ts` | Drops events when `isActive = false` | Events received but silently discarded |
| 4 | `app/api/webhooks/app-uninstalled/route.ts` | Uninstall webhook fires after reinstall, sets `isActive = false` | Shop never stays active |

---

## Why this won't break Dr. Water

`checkout-monitor.js` is bundled into a Shopify app extension and uploaded to Shopify via
`shopify app deploy`. Dr. Water's extension was deployed separately under the Dr. Water
custom app. Changing this file and redeploying only touches CouponMaxx's extension on
Shopify's servers — Dr. Water's copy is completely independent.

---

## Fix 1 — pixel/checkout-monitor.js: correct INGEST_URL + add storefront events

Replace the entire file:

```js
// pixel/checkout-monitor.js
// Runs in Shopify's sandboxed Web Worker environment.
// - No DOM access
// - No fetch() — use browser.sendBeacon ONLY
// - No localStorage or sessionStorage
// - No external scripts

register(({ analytics, browser, init }) => {
  // ✅ FIXED: was checkoutmaxx-rt55.vercel.app (Dr. Water's URL)
  const INGEST_URL = "https://couponmaxx.vercel.app/api/pixel/ingest";

  const shopDomain =
    init.context?.document?.location?.hostname ||
    init.data?.shop?.domain ||
    null;

  function getDeviceType() {
    const ua = init.context?.navigator?.userAgent || "";
    if (/Mobi|Android/i.test(ua)) return "mobile";
    if (/Tablet|iPad/i.test(ua)) return "tablet";
    return "desktop";
  }

  function send(eventType, payload) {
    const body = JSON.stringify({
      shopDomain,
      eventType,
      sessionId:
        payload?.checkout?.token ||
        payload?.checkout?.id ||
        payload?.cartId ||
        null,
      occurredAt: new Date().toISOString(),
      deviceType: getDeviceType(),
      country:
        payload?.checkout?.shippingAddress?.countryCode ||
        payload?.checkout?.shippingAddress?.country ||
        null,
      data: payload,
    });

    browser.sendBeacon(INGEST_URL, body);
  }

  // ✅ NEW: Storefront events (homepage + cart analytics)
  analytics.subscribe("page_viewed", (event) => {
    send("page_viewed", event.data);
  });

  analytics.subscribe("cart_viewed", (event) => {
    send("cart_viewed", event.data);
  });

  analytics.subscribe("product_viewed", (event) => {
    send("product_viewed", event.data);
  });

  analytics.subscribe("product_added_to_cart", (event) => {
    send("product_added_to_cart", event.data);
  });

  analytics.subscribe("product_removed_from_cart", (event) => {
    send("product_removed_from_cart", event.data);
  });

  // Checkout events (existing)
  analytics.subscribe("checkout_started", (event) => {
    send("checkout_started", event.data);
  });

  analytics.subscribe("checkout_contact_info_submitted", (event) => {
    send("checkout_contact_info_submitted", event.data);
  });

  analytics.subscribe("checkout_address_info_submitted", (event) => {
    send("checkout_address_info_submitted", event.data);
  });

  analytics.subscribe("checkout_shipping_info_submitted", (event) => {
    send("checkout_shipping_info_submitted", event.data);
  });

  analytics.subscribe("payment_info_submitted", (event) => {
    send("payment_info_submitted", event.data);
  });

  analytics.subscribe("checkout_completed", (event) => {
    const checkout = event.data?.checkout;
    send("checkout_completed", {
      ...event.data,
      discountCodes:
        checkout?.discountApplications
          ?.filter((d) => d.type === "DISCOUNT_CODE")
          ?.map((d) => d.title) || [],
      totalPrice: checkout?.totalPrice?.amount,
      currency: checkout?.currencyCode,
      gateway: checkout?.transactions?.[0]?.gateway,
    });
  });

  analytics.subscribe("alert_displayed", (event) => {
    send("alert_displayed", event.data);
  });

  analytics.subscribe("ui_extension_errored", (event) => {
    send("ui_extension_errored", event.data);
  });
});
```

---

## Fix 2 — app/api/pixel/ingest/route.ts: don't drop events when isActive = false

The current code silently drops all events if `isActive = false`. Since the uninstall
webhook fires after every reinstall (Shopify behavior), `isActive` is almost never `true`
on a fresh install. Remove that gate — the shop existing in the DB is enough.

Find this block in `processEvent()`:

```ts
// BEFORE — delete this
if (shopError || !shop || !shop.isActive) {
  logIngest({ endpoint: "pixel", shopDomain, eventType, success: false, latencyMs: Date.now() - start, errorMessage: "shop not found" });
  return;
}
```

Replace with:

```ts
// AFTER — only gate on shop existing, not isActive
if (shopError || !shop) {
  logIngest({ endpoint: "pixel", shopDomain, eventType, success: false, latencyMs: Date.now() - start, errorMessage: "shop not found or db error" });
  return;
}
```

---

## Fix 3 — app/api/webhooks/app-uninstalled/route.ts

The uninstall webhook fires during Shopify's reinstall sequence (uninstall + reinstall
within seconds). This sets `isActive = false` and overwrites the fresh install's `true`.

Add a 60-second grace window: if the shop was installed in the last 60 seconds, skip
the deactivation.

```ts
// In your app-uninstalled webhook handler, replace the DB update with:

const shop = await prisma.shop.findUnique({ where: { shopDomain } });

if (shop) {
  const secondsSinceInstall = (Date.now() - new Date(shop.installedAt).getTime()) / 1000;
  
  // Skip deactivation if this is a reinstall (uninstall fired within 60s of install)
  if (secondsSinceInstall < 60) {
    console.log(`[app/uninstalled] skipping deactivation for ${shopDomain} — reinstall in progress (${secondsSinceInstall.toFixed(0)}s since install)`);
    return NextResponse.json({ ok: true });
  }

  await prisma.shop.update({
    where: { shopDomain },
    data: { isActive: false },
  });
}
```

---

## Fix 4 — DB: manually fix the existing test store row

The current DB row for testingstoresumeet.myshopify.com has `isActive = false`.
Fix it directly so you can test without reinstalling:

```sql
UPDATE "Shop"
SET "isActive" = true
WHERE "shopDomain" = 'testingstoresumeet.myshopify.com';
```

Run this in your Supabase SQL editor.

---

## Deployment order

1. Apply all 4 code fixes
2. Commit and push to main → Vercel auto-deploys `couponmaxx.vercel.app`
3. Run `shopify app deploy` pointing at the CouponMaxx app config to push the updated pixel extension to Shopify
4. Run the SQL fix on the DB
5. Go to the test store → browse homepage → add to cart → start checkout
6. Check Supabase `CheckoutEvent` table — events should appear within seconds

**Do NOT run `shopify app deploy` for the Dr. Water / checkoutmaxx-rt55 config.**
That would overwrite Dr. Water's pixel extension. Only deploy under the CouponMaxx
Partner Dashboard credentials.

---

## How to verify it's working

After deployment, open Vercel logs for `couponmaxx.vercel.app` and filter to
`/api/pixel/ingest`. You should see POST requests with 200 responses within seconds
of browsing the test store. If you see 200s, the pipeline is working — check
Supabase `CheckoutEvent` table for the rows.
