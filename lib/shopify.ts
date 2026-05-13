import "@shopify/shopify-api/adapters/web-api";
import { shopifyApi, ApiVersion, LogSeverity, Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "./session-storage";
import { envCheck } from "./env-check";

// Validate required env vars at module load — loud failure beats silent 401s later.
// Skipped during build (build-placeholder values are acceptable at compile time).
if (process.env.SHOPIFY_API_KEY !== "build-placeholder") {
  envCheck();
}

export const shopify = shopifyApi({
  // Fallback strings prevent build-time throw when env vars aren't present.
  // At runtime on Vercel these will always be set.
  apiKey: process.env.SHOPIFY_API_KEY || "build-placeholder",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "build-placeholder",
  scopes: ["read_orders", "read_checkouts", "write_pixels", "read_customer_events", "read_analytics", "write_discounts"],
  hostName: (process.env.SHOPIFY_APP_URL || "localhost:3000").replace(/^https?:\/\//, ""),
  apiVersion: ApiVersion.April25,
  isEmbeddedApp: true,
  logger: {
    level: process.env.NODE_ENV === "development" ? LogSeverity.Debug : LogSeverity.Error,
  },
});

export const sessionStorage = new PrismaSessionStorage();

const WEBHOOK_SUBSCRIPTION_CREATE = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

/**
 * Register app webhooks via GraphQL Admin API.
 * Called after OAuth completes — fire and forget.
 * GDPR topics (customers/data_request, customers/redact, shop/redact) cannot be
 * registered programmatically — they must be set in shopify.app.toml.
 */
export async function registerWebhooks(session: Session) {
  const client = new shopify.clients.Graphql({ session });
  const base = process.env.SHOPIFY_APP_URL;

  const webhooks = [
    { topic: "APP_UNINSTALLED", address: `${base}/api/webhooks/app-uninstalled` },
    { topic: "APP_SUBSCRIPTIONS_UPDATE", address: `${base}/api/webhooks/app-subscriptions-update` },
    { topic: "ORDERS_CREATE", address: `${base}/api/webhooks/orders-create` },
    { topic: "SHOP_UPDATE", address: `${base}/api/webhooks/shop-update` },
  ];

  for (const { topic, address } of webhooks) {
    try {
      const response = await client.request(WEBHOOK_SUBSCRIPTION_CREATE, {
        variables: {
          topic,
          webhookSubscription: { callbackUrl: address, format: "JSON" },
        },
      });
      const errors = (response.data as any)?.webhookSubscriptionCreate?.userErrors ?? [];
      const alreadyExists = errors.some((e: any) =>
        e.message?.toLowerCase().includes("already been taken")
      );
      if (errors.length && !alreadyExists) {
        console.error(`[registerWebhooks] Failed ${topic}:`, errors);
      }
    } catch (err: any) {
      console.error(`[registerWebhooks] Error registering ${topic}:`, err?.message);
    }
  }
}
