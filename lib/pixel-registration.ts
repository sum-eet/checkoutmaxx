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

const GET_EXISTING_PIXEL = `
  query {
    webPixel {
      id
    }
  }
`;

const WEB_PIXEL_UPDATE = `
  mutation webPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
    webPixelUpdate(id: $id, webPixel: $webPixel) {
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
): Promise<string | null> {
  const session = makeSession(shop, accessToken);
  const client = new shopify.clients.Graphql({ session });
  const settings = JSON.stringify({ shopDomain: shop });

  // Check if pixel already exists (persists across reinstalls).
  // Shopify throws a GraphQL error (not userErrors) when no pixel exists — treat as none.
  let existingPixelId: string | undefined;
  try {
    const checkResponse = await client.request(GET_EXISTING_PIXEL, {});
    existingPixelId = (checkResponse.data as any)?.webPixel?.id as string | undefined;
  } catch (e: any) {
    console.log(`[registerAppPixel] webPixel query: ${e?.message} — no existing pixel`);
    existingPixelId = undefined;
  }
  console.log(`[registerAppPixel] existing pixelId=${existingPixelId ?? "none"}`);

  if (existingPixelId) {
    // Update existing pixel
    const updateResponse = await client.request(WEB_PIXEL_UPDATE, {
      variables: { id: existingPixelId, webPixel: { settings } },
    });
    const updateErrors = (updateResponse.data as any)?.webPixelUpdate
      ?.userErrors as { field: string; message: string }[] | undefined;
    if (updateErrors && updateErrors.length > 0) {
      throw new Error(
        `Pixel update failed: ${updateErrors.map((e) => e.message).join(", ")}`
      );
    }
    const updatedId = (updateResponse.data as any)?.webPixelUpdate?.webPixel
      ?.id as string | undefined;
    if (!updatedId) {
      throw new Error("Pixel update failed: no pixel ID returned");
    }
    console.log(`[registerAppPixel] Pixel updated: ${updatedId}`);
    return updatedId;
  }

  // Create new pixel
  const createResponse = await client.request(WEB_PIXEL_CREATE, {
    variables: { webPixel: { settings } },
  });

  const createErrors = (createResponse.data as any)?.webPixelCreate
    ?.userErrors as { field: string; message: string }[] | undefined;

  // Belt-and-suspenders: "already been set" means pixel exists — re-query and update
  if (createErrors && createErrors.length > 0) {
    const alreadySet = createErrors.some((e) =>
      e.message.includes("already been set")
    );
    if (alreadySet) {
      // Shopify sometimes includes the existing pixel in the create response even when
      // userErrors fires — check there first before a redundant re-query.
      const pixelFromCreate = (createResponse.data as any)?.webPixelCreate?.webPixel?.id as string | undefined;
      if (pixelFromCreate) {
        console.log(`[registerAppPixel] got pixelId from create response: ${pixelFromCreate}`);
        return pixelFromCreate;
      }

      console.log("[registerAppPixel] create rejected 'already set' — re-querying for ID");
      try {
        const retryCheck = await client.request(GET_EXISTING_PIXEL, {});
        const retryId = (retryCheck.data as any)?.webPixel?.id as string | undefined;
        if (retryId) {
          const retryUpdate = await client.request(WEB_PIXEL_UPDATE, {
            variables: { id: retryId, webPixel: { settings } },
          });
          const retryPixelId = (retryUpdate.data as any)?.webPixelUpdate?.webPixel?.id as string | undefined;
          if (retryPixelId) {
            console.log(`[registerAppPixel] Pixel updated (retry): ${retryPixelId}`);
            return retryPixelId;
          }
        }
      } catch (e: any) {
        console.warn(`[registerAppPixel] re-query failed: ${e?.message}`);
      }

      // Pixel is live on Shopify (create rejected = it exists) but we cannot retrieve
      // its ID — likely a scope or API consistency issue. Pixel continues to fire events.
      console.warn("[registerAppPixel] pixel 'already set' but ID unretievable — returning null; pixel is live");
      return null;
    }
    throw new Error(
      `Pixel registration failed: ${createErrors.map((e) => e.message).join(", ")}`
    );
  }

  const pixelId = (createResponse.data as any)?.webPixelCreate?.webPixel?.id as
    | string
    | undefined;

  if (!pixelId) {
    throw new Error("Pixel registration failed: no pixel ID returned");
  }

  console.log(`[registerAppPixel] Pixel created: ${pixelId}`);
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
