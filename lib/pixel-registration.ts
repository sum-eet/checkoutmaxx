import { Session } from "@shopify/shopify-api";
import { shopify } from "./shopify";

const INGEST_URL =
  (process.env.SHOPIFY_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "") +
  "/api/pixel/ingest";

const WEB_PIXEL_CREATE = `
  mutation webPixelCreate($webPixel: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixel) {
      userErrors { field message }
      webPixel { id settings }
    }
  }
`;

const WEB_PIXEL_DELETE = `
  mutation webPixelDelete($id: ID!) {
    webPixelDelete(id: $id) {
      userErrors { field message }
      deletedWebPixelId
    }
  }
`;

function makeSession(shop: string, accessToken: string): Session {
  const session = new Session({
    id: `offline_${shop}`,
    shop,
    state: "offline",
    isOnline: false,
  });
  session.accessToken = accessToken;
  return session;
}

export async function registerAppPixel(
  shop: string,
  accessToken: string
): Promise<string> {
  const session = makeSession(shop, accessToken);
  const client = new shopify.clients.Graphql({ session });

  const response = await client.request(WEB_PIXEL_CREATE, {
    variables: {
      webPixel: {
        settings: JSON.stringify({
          shopDomain: shop,
          ingestUrl: INGEST_URL,
        }),
      },
    },
  });

  const errors = (response.data as any)?.webPixelCreate?.userErrors as
    | { field: string; message: string }[]
    | undefined;

  if (errors && errors.length > 0) {
    throw new Error(
      `Pixel registration failed: ${errors.map((e) => e.message).join(", ")}`
    );
  }

  const pixelId = (response.data as any)?.webPixelCreate?.webPixel?.id as
    | string
    | undefined;

  if (!pixelId) {
    throw new Error("Pixel registration failed: no pixel ID returned");
  }

  return pixelId;
}

export async function deregisterAppPixel(
  shop: string,
  accessToken: string,
  pixelId: string
): Promise<void> {
  const session = makeSession(shop, accessToken);
  const client = new shopify.clients.Graphql({ session });

  const response = await client.request(WEB_PIXEL_DELETE, {
    variables: { id: pixelId },
  });

  const errors = (response.data as any)?.webPixelDelete?.userErrors as
    | { field: string; message: string }[]
    | undefined;

  if (errors && errors.length > 0) {
    console.warn("[deregisterAppPixel] Errors:", errors);
  }
}
