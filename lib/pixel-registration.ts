import { GraphqlClient, Session } from "@shopify/shopify-api";

const INGEST_URL =
  (process.env.SHOPIFY_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "") +
  "/api/pixel/ingest";

const WEB_PIXEL_CREATE = `
  mutation webPixelCreate($webPixel: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixel) {
      userErrors {
        field
        message
      }
      webPixel {
        id
        settings
      }
    }
  }
`;

const WEB_PIXEL_DELETE = `
  mutation webPixelDelete($id: ID!) {
    webPixelDelete(id: $id) {
      userErrors {
        field
        message
      }
      deletedWebPixelId
    }
  }
`;

export async function registerAppPixel(
  shop: string,
  accessToken: string
): Promise<string> {
  const session = new Session({
    id: `${shop}_offline`,
    shop,
    state: "",
    isOnline: false,
    accessToken,
  });

  const client = new GraphqlClient({ session });

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

  const errors = response.data?.webPixelCreate?.userErrors;
  if (errors?.length > 0) {
    throw new Error(`Pixel registration failed: ${errors.map((e: any) => e.message).join(", ")}`);
  }

  const pixelId = response.data?.webPixelCreate?.webPixel?.id;
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
  const session = new Session({
    id: `${shop}_offline`,
    shop,
    state: "",
    isOnline: false,
    accessToken,
  });

  const client = new GraphqlClient({ session });

  const response = await client.request(WEB_PIXEL_DELETE, {
    variables: { id: pixelId },
  });

  const errors = response.data?.webPixelDelete?.userErrors;
  if (errors?.length > 0) {
    console.warn(`[deregisterAppPixel] Errors:`, errors);
  }
}
