// pixel/checkout-monitor.js
// IMPORTANT: This runs in Shopify's sandboxed Web Worker environment.
// - No DOM access
// - No fetch() — use browser.sendBeacon ONLY
// - No localStorage or sessionStorage
// - No external scripts

import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, init }) => {
  const INGEST_URL = "__INGEST_URL__"; // Replaced at build time or hardcoded to your Vercel URL

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

    // sendBeacon is the ONLY reliable method in the pixel sandbox.
    // fetch() and XHR are not available here.
    browser.sendBeacon(INGEST_URL, body);
  }

  // Event 1: Customer enters checkout
  analytics.subscribe("checkout_started", (event) => {
    send("checkout_started", event.data);
  });

  // Event 2: Customer submits contact info
  analytics.subscribe("checkout_contact_info_submitted", (event) => {
    send("checkout_contact_info_submitted", event.data);
  });

  // Event 3: Customer submits address
  analytics.subscribe("checkout_address_info_submitted", (event) => {
    send("checkout_address_info_submitted", event.data);
  });

  // Event 4: Customer selects shipping
  analytics.subscribe("checkout_shipping_info_submitted", (event) => {
    send("checkout_shipping_info_submitted", event.data);
  });

  // Event 5: Customer submits payment
  analytics.subscribe("payment_info_submitted", (event) => {
    send("payment_info_submitted", event.data);
  });

  // Event 6: Order completes — extract discount codes and gateway
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

  // Event 7: Checkout validation error (includes failed discount codes)
  // Shopify emits type: 'DISCOUNT_ERROR' for discount failures
  analytics.subscribe("alert_displayed", (event) => {
    send("alert_displayed", event.data);
  });

  // Event 8: Checkout UI extension threw an error
  analytics.subscribe("ui_extension_errored", (event) => {
    send("ui_extension_errored", event.data);
  });
});
