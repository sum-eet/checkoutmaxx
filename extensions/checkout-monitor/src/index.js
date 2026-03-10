// CheckoutMaxx Web Pixel Extension
// Runs in Shopify's sandboxed Web Worker environment.
// - No DOM access
// - No fetch() — use browser.sendBeacon ONLY
// - No localStorage or sessionStorage
// - No external scripts

register(({ analytics, browser, init }) => {
  const INGEST_URL = "https://checkoutmaxx-rt55.vercel.app/api/pixel/ingest";

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
