import { shopifyApp } from "@shopify/shopify-app-next";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { DeliveryMethod } from "@shopify/shopify-api";
import prisma from "./prisma";
import { registerAppPixel, deregisterAppPixel } from "./pixel-registration";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  scopes: ["read_orders", "read_checkouts", "write_pixels", "read_analytics"],
  appUrl: process.env.SHOPIFY_APP_URL!,
  authPathPrefix: "/api/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  webhooks: {
    APP_UNINSTALLED: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/api/webhooks/app-uninstalled",
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      // Register webhooks
      shopify.registerWebhooks({ session });

      // Upsert shop record
      const existingShop = await prisma.shop.findUnique({
        where: { shopDomain: session.shop },
      });

      // Deregister old pixel before registering new one (one pixel per shop rule)
      if (existingShop?.pixelId) {
        try {
          await deregisterAppPixel(session.shop, session.accessToken, existingShop.pixelId);
        } catch (err) {
          console.error("[afterAuth] Failed to deregister old pixel:", err);
        }
      }

      // Register new pixel
      let pixelId: string | undefined;
      try {
        pixelId = await registerAppPixel(session.shop, session.accessToken);
      } catch (err) {
        console.error("[afterAuth] Pixel registration failed:", err);
      }

      // Upsert Shop
      await prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: {
          accessToken: session.accessToken,
          isActive: true,
          ...(pixelId ? { pixelId } : {}),
        },
        create: {
          shopDomain: session.shop,
          accessToken: session.accessToken,
          isActive: true,
          alertEmail: null,
          ...(pixelId ? { pixelId } : {}),
        },
      });
    },
  },
});

export default shopify;
export const { authenticate, unauthenticated, login, sessionToken, redirect } = shopify;
