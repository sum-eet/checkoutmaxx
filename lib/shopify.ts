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
  const webhookUrl = `${process.env.SHOPIFY_APP_URL}/api/webhooks/app-uninstalled`;

  try {
    await client.post({
      path: "webhooks",
      data: {
        webhook: {
          topic: "app/uninstalled",
          address: webhookUrl,
          format: "json",
        },
      },
    });
  } catch (err: any) {
    const msg = JSON.stringify(err?.response?.body || err?.message || "");
    if (!msg.includes("already been taken")) {
      console.error("[registerWebhooks] Failed:", msg);
    }
  }
}
