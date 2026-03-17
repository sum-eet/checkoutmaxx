// CheckoutMaxx Web Pixel Extension
// Runs in Shopify's sandboxed Web Worker environment.
// - No DOM access
// - No fetch() — use browser.sendBeacon ONLY
// - No localStorage or sessionStorage
// - No external scripts

import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, init }) => {
  const INGEST_URL = "https://couponmaxx.vercel.app/api/pixel/ingest";

  const shopDomain =
    init.data?.shop?.myshopifyDomain ||
    init.data?.shop?.domain ||
    null;

  // Track session ID — prefer _cmx_sid from cart attributes (set by cart-monitor.js)
  // so cart sessions and checkout sessions share the same ID. Fall back to checkout token.
  let currentSessionId = null;

  function getDeviceType() {
    const ua = init.context?.navigator?.userAgent || "";
    if (/Mobi|Android/i.test(ua)) return "mobile";
    if (/Tablet|iPad/i.test(ua)) return "tablet";
    return "desktop";
  }

  function extractSessionId(checkout) {
    if (!checkout) return null;
    // Cart attributes are in customAttributes: [{key, value}]
    const attrs = checkout.customAttributes || checkout.attributes || [];
    const cmxAttr = Array.isArray(attrs)
      ? attrs.find((a) => a.key === "_cmx_sid")
      : null;
    if (cmxAttr?.value) return cmxAttr.value;
    // Fall back to checkout token
    return checkout.token || checkout.id || null;
  }

  function send(eventType, payload) {
    const body = JSON.stringify({
      shopDomain,
      eventType,
      sessionId: currentSessionId,
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

  analytics.subscribe("checkout_started", (event) => {
    currentSessionId = extractSessionId(event.data?.checkout);
    send("checkout_started", event.data);

    // Session init ping — fires once on checkout_started
    // Confirms: pixel loaded → sendBeacon working → ingest endpoint reachable → DB alive
    try {
      const pingPayload = JSON.stringify({
        sessionId: currentSessionId,
        source: 'checkout',
        shopDomain,
        country: event.data?.checkout?.shippingAddress?.countryCode ?? null,
        device: getDeviceType(),
        pageUrl: '/checkout',
        occurredAt: new Date().toISOString(),
      });
      browser.sendBeacon(
        'https://couponmaxx.vercel.app/api/session/ping',
        pingPayload
      );
      console.log('[CheckoutMaxx] Checkout active — session:', currentSessionId);
    } catch (e) {
      // Never let the ping crash the pixel
    }
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
