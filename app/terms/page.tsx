export default function TermsPage() {
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
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Terms of Service</h1>
      <p style={{ color: "#6b7280", marginBottom: 32 }}>
        Last updated: April 2026
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>1. Acceptance of Terms</h2>
        <p>
          By installing or using CouponMaxx ("the App"), you agree to be bound by these
          Terms of Service. If you do not agree, please uninstall the App immediately.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>2. Service Description</h2>
        <p>
          CouponMaxx is a Shopify app that helps merchants track coupon and discount code
          performance, monitor cart activity, detect conversion drops, and receive alerts
          about checkout issues. The App integrates with your Shopify store via a theme
          extension and a web pixel extension.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>3. Account and Access</h2>
        <p>
          You must have a valid Shopify store to use CouponMaxx. By installing the App,
          you authorise us to access your store data as described in our{" "}
          <a href="/privacy" style={{ color: "#2563eb" }}>Privacy Policy</a>.
          You are responsible for maintaining the security of your Shopify account.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>4. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>Use the App for any unlawful purpose or in violation of Shopify's Terms of Service.</li>
          <li>Attempt to reverse-engineer, decompile, or tamper with the App.</li>
          <li>Transmit malicious code or interfere with the App's operation.</li>
          <li>Resell or redistribute access to the App without our written consent.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>5. Data Ownership</h2>
        <p>
          You retain full ownership of your store data. CouponMaxx processes your data
          solely to provide the service. We do not sell, share, or use your data for
          advertising. Upon uninstallation, all data associated with your store is
          deleted within 48 hours.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>6. Service Availability</h2>
        <p>
          We strive to keep CouponMaxx available at all times but do not guarantee
          uninterrupted service. We may perform maintenance, updates, or modifications
          that temporarily affect availability. We will make reasonable efforts to
          notify you of planned downtime.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>7. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by law, CouponMaxx and its developers shall
          not be liable for any indirect, incidental, special, or consequential damages
          arising from your use of the App, including but not limited to lost profits,
          lost sales, or data loss. Our total liability shall not exceed the fees you
          paid for the App in the twelve months preceding the claim.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>8. Termination</h2>
        <p>
          You may stop using CouponMaxx at any time by uninstalling the App from your
          Shopify store. We reserve the right to suspend or terminate your access if
          you violate these terms. Upon termination, your stored data will be deleted
          in accordance with our Privacy Policy.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>9. Changes to Terms</h2>
        <p>
          We may update these Terms of Service from time to time. Continued use of the
          App after changes constitutes acceptance of the updated terms. We will notify
          merchants of material changes through the App dashboard or email.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>10. Contact</h2>
        <p>
          For questions about these terms, contact us at:{" "}
          <a href="mailto:sk200435@gmail.com" style={{ color: "#2563eb" }}>
            sk200435@gmail.com
          </a>
        </p>
      </section>
    </main>
  );
}
