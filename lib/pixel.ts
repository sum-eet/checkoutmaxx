import { Session } from "@shopify/shopify-api";
import { shopify } from "./shopify";

const WEB_PIXEL_CREATE = `
  mutation webPixelCreate($webPixel: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixel) {
      userErrors { field message }
      webPixel { id }
    }
  }
`;

const GET_EXISTING_PIXEL = `
  query {
    webPixel {
      id
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

export async function ensurePixel(
  shopDomain: string,
  accessToken: string
): Promise<string | null> {
  try {
    const session = makeSession(shopDomain, accessToken);
    const client = new shopify.clients.Graphql({ session });
    const settings = JSON.stringify({ shopDomain });

    let createResponse: any;
    try {
      createResponse = await client.request(WEB_PIXEL_CREATE, {
        variables: { webPixel: { settings } },
      });
    } catch (err: any) {
      console.error("[pixel] ensurePixel webPixelCreate threw:", err.message);
      return null;
    }

    const createErrors = (createResponse.data as any)?.webPixelCreate?.userErrors as
      | { message: string }[]
      | undefined;
    const createdId = (createResponse.data as any)?.webPixelCreate?.webPixel?.id as
      | string
      | undefined;

    if (!createErrors || createErrors.length === 0) {
      if (createdId) {
        console.log("[pixel] ensurePixel → %s (created)", createdId);
        return createdId;
      }
      console.warn("[pixel] ensurePixel: create returned no id — returning null");
      return null;
    }

    const alreadySet = createErrors.some((e) => e.message.includes("already been set"));
    if (alreadySet) {
      if (createdId) {
        console.log("[pixel] ensurePixel → %s (from create response)", createdId);
        return createdId;
      }
      // One query attempt — no further retries
      try {
        const queryResponse = await client.request(GET_EXISTING_PIXEL, {});
        const existingId = (queryResponse.data as any)?.webPixel?.id as string | undefined;
        if (existingId) {
          console.log("[pixel] ensurePixel → %s (queried after already_set)", existingId);
          return existingId;
        }
        console.warn("[pixel] ensurePixel: already_set but query returned no id — null; pixel is live on storefront");
        return null;
      } catch (err: any) {
        console.warn("[pixel] ensurePixel: already_set but query threw:", err.message, "— null; pixel is live on storefront");
        return null;
      }
    }

    console.error("[pixel] ensurePixel: create userErrors:", createErrors.map((e) => e.message).join(", "));
    return null;
  } catch (err: any) {
    console.error("[pixel] ensurePixel unexpected error:", err.message);
    return null;
  }
}

export async function deletePixel(
  shopDomain: string,
  accessToken: string,
  pixelId: string
): Promise<void> {
  try {
    const session = makeSession(shopDomain, accessToken);
    const client = new shopify.clients.Graphql({ session });
    const response = await client.request(WEB_PIXEL_DELETE, {
      variables: { id: pixelId },
    });
    const errors = (response.data as any)?.webPixelDelete?.userErrors as
      | { message: string }[]
      | undefined;
    if (errors && errors.length > 0) {
      console.warn("[pixel] deletePixel userErrors:", errors.map((e) => e.message).join(", "));
    } else {
      console.log("[pixel] deletePixel deleted pixelId=%s", pixelId);
    }
  } catch (err: any) {
    console.error("[pixel] deletePixel threw:", err.message);
  }
}
