export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#1a1a1a",
        lineHeight: 1.7,
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: "#6b7280", marginBottom: 32 }}>
        Last updated: March 2025
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>1. Who We Are</h2>
        <p>
          CouponMaxx ("we", "us", "our") is a Shopify app that helps merchants monitor
          their checkout funnel, detect conversion drops, and receive alerts about
          checkout errors.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>2. Data We Collect</h2>
        <p>
          CouponMaxx collects the following data from your Shopify store:
        </p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>
            <strong>Checkout funnel events</strong> — anonymised session-level events
            (checkout started, contact info submitted, payment submitted, checkout
            completed, etc.). These contain session IDs, device type, country, and
            step timestamps but no personally identifiable information.
          </li>
          <li>
            <strong>Discount code errors</strong> — when a shopper enters an invalid
            discount code, we record the code string and the error message to help
            merchants identify broken codes.
          </li>
          <li>
            <strong>Order totals and currency</strong> — aggregated for conversion
            rate calculations. Individual order details are not stored.
          </li>
          <li>
            <strong>Shop domain and OAuth token</strong> — required to authenticate
            API calls on behalf of your store.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>3. How We Use Data</h2>
        <p>Data is used solely to:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>Power the CouponMaxx dashboard and funnel analytics for your store.</li>
          <li>Send you alerts when checkout conversion drops significantly.</li>
          <li>Compute baseline conversion rates for anomaly detection.</li>
        </ul>
        <p style={{ marginTop: 8 }}>
          We do not sell, share, or use your data for advertising or any purpose
          beyond providing the CouponMaxx service to you.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>4. Data Retention</h2>
        <p>
          Checkout event data is retained for as long as your store has CouponMaxx
          installed. When you uninstall the app, all data associated with your shop is
          deleted within 48 hours in compliance with Shopify's GDPR requirements.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>5. Third-Party Services</h2>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>
            <strong>Supabase</strong> — database hosting (EU/US regions). Data is
            encrypted at rest and in transit.
          </li>
          <li>
            <strong>Vercel</strong> — application hosting and edge functions.
          </li>
          <li>
            <strong>Resend</strong> — transactional email delivery for alert
            notifications.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
          6. Your Rights (GDPR / CCPA)
        </h2>
        <p>
          As a merchant, you may request access to, correction of, or deletion of
          your store's data at any time by contacting us. Shopify's GDPR webhooks
          are implemented: customer data erasure requests are honoured within 30 days,
          and full shop data is deleted within 48 hours of uninstallation.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>7. Contact</h2>
        <p>
          For privacy questions or data requests, contact us at:{" "}
          <a href="mailto:privacy@checkoutmaxx.app" style={{ color: "#2563eb" }}>
            privacy@checkoutmaxx.app
          </a>
        </p>
      </section>
    </main>
  );
}
