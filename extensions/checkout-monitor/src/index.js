// CheckoutMaxx Web Pixel Extension
// Runs in Shopify's sandboxed Web Worker environment.
// - No DOM access
// - No fetch() — use browser.sendBeacon ONLY
// - No localStorage or sessionStorage
// - No external scripts

import { register } from "@shopify/web-pixels-extension";

register(({ analytics, browser, init }) => {
  const INGEST_URL = "https://couponmaxx.vercel.app/api/pixel/ingest";
  const CART_INGEST_URL = "https://couponmaxx.vercel.app/api/cart/ingest";

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

  // Mirror checkout discount events to /api/cart/ingest so sessions UI picks them up.
  // Required because the checkout UI extension cannot fetch() (no network_access
  // allowed during Shopify review). Pixel has sendBeacon access.
  function sendToCartIngest(eventType, code, extra) {
    try {
      if (!currentSessionId) {
        console.warn("[CMX Pixel] sendToCartIngest SKIPPED — no currentSessionId", { eventType, code });
        return;
      }
      const body = JSON.stringify({
        shopDomain,
        sessionId: currentSessionId,
        eventType,
        occurredAt: new Date().toISOString(),
        device: getDeviceType(),
        payload: {
          code: code || null,
          ...(extra || {}),
        },
      });
      console.log("[CMX Pixel] → /api/cart/ingest", { eventType, code, sessionId: currentSessionId });
      const ok = browser.sendBeacon(CART_INGEST_URL, body);
      console.log("[CMX Pixel] sendBeacon result", { eventType, ok });
    } catch (e) {
      console.error("[CMX Pixel] sendToCartIngest threw", e);
    }
  }

  // Storefront events — homepage/cart analytics
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

  // Checkout events
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
    const target = event.data?.alert?.target;
    const value = event.data?.alert?.value;
    const message = event.data?.alert?.message;
    console.log("[CMX Pixel] alert_displayed", { target, value, message, sessionId: currentSessionId });
    send("alert_displayed", event.data);
  });

  analytics.subscribe("ui_extension_errored", (event) => {
    send("ui_extension_errored", event.data);
  });

  // Discount code events — fire on BOTH Claim-button applies AND native Shopify
  // discount input. Captures the "WRONGCODE" case the checkout extension can't see.
  analytics.subscribe("checkout_discount_code_applied", (event) => {
    if (!currentSessionId) {
      currentSessionId = extractSessionId(event.data?.checkout);
    }
    console.log("[CMX Pixel] checkout_discount_code_applied", {
      raw: event.data,
      sessionId: currentSessionId,
    });
    send("checkout_discount_code_applied", event.data);

    const codes =
      event.data?.checkout?.discountApplications
        ?.filter((d) => d.type === "DISCOUNT_CODE")
        ?.map((d) => d.title) || [];
    const code = codes[codes.length - 1] || null;
    sendToCartIngest("checkout_coupon_applied", code, {});
  });

  analytics.subscribe("checkout_discount_code_rejected", (event) => {
    if (!currentSessionId) {
      currentSessionId = extractSessionId(event.data?.checkout);
    }
    console.log("[CMX Pixel] checkout_discount_code_rejected", {
      raw: event.data,
      sessionId: currentSessionId,
    });
    send("checkout_discount_code_rejected", event.data);

    const code =
      event.data?.discountCode ||
      event.data?.code ||
      event.data?.checkout?.discountCode ||
      null;
    const reason =
      event.data?.errorMessage ||
      event.data?.reason ||
      "rejected";
    sendToCartIngest("checkout_coupon_failed", code, { failureReason: reason });
  });
});
