import "@shopify/shopify-api/adapters/web-api";
import { shopifyApi, ApiVersion, LogSeverity, Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "./session-storage";

export const shopify = shopifyApi({
  // Fallback strings prevent build-time throw when env vars aren't present.
  // At runtime on Vercel these will always be set.
  apiKey: process.env.SHOPIFY_API_KEY || "build-placeholder",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "build-placeholder",
  scopes: ["read_orders", "read_checkouts", "write_pixels", "read_analytics"],
  hostName: (process.env.SHOPIFY_APP_URL || "localhost:3000").replace(/^https?:\/\//, ""),
  apiVersion: ApiVersion.January25,
  isEmbeddedApp: true,
  logger: {
    level: process.env.NODE_ENV === "development" ? LogSeverity.Debug : LogSeverity.Error,
  },
});

export const sessionStorage = new PrismaSessionStorage();

/**
 * Register the APP_UNINSTALLED webhook.
 * Called after OAuth completes — fire and forget.
 */
export async function registerWebhooks(session: Session) {
  const client = new shopify.clients.Rest({ session });
  const base = process.env.SHOPIFY_APP_URL;

  // GDPR topics (customers/data_request, customers/redact, shop/redact) cannot be
  // registered via the REST API — they must be set in the Shopify Partner Dashboard.
  const topics = [
    { topic: "app/uninstalled", address: `${base}/api/webhooks/app-uninstalled` },
  ];

  for (const { topic, address } of topics) {
    try {
      await client.post({
        path: "webhooks",
        data: { webhook: { topic, address, format: "json" } },
      });
    } catch (err: any) {
      const msg = JSON.stringify(err?.response?.body || err?.message || "");
      if (!msg.includes("already been taken")) {
        console.error(`[registerWebhooks] Failed ${topic}:`, msg);
      }
    }
  }
}
