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

const WEB_PIXEL_DELETE = `
  mutation webPixelDelete($id: ID!) {
    webPixelDelete(id: $id) {
      userErrors { field message }
      deletedWebPixelId
    }
  }
`;

function makeSession(shop: string, accessToken: string): Session {
  const s = new Session({ id: `offline_${shop}`, shop, state: "offline", isOnline: false });
  s.accessToken = accessToken;
  return s;
}

export async function registerAppPixel(shop: string, accessToken: string): Promise<string | null> {
  console.log("[pixel] registerAppPixel shop=%s", shop);
  try {
    const client = new shopify.clients.Graphql({ session: makeSession(shop, accessToken) });
    const resp = await client.request(WEB_PIXEL_CREATE, {
      variables: { webPixel: { settings: JSON.stringify({ shopDomain: shop }) } },
    });
    const userErrors = (resp.data as any)?.webPixelCreate?.userErrors ?? [];
    const id = (resp.data as any)?.webPixelCreate?.webPixel?.id as string | undefined;

    if (id) {
      console.log("[pixel] registerAppPixel created id=%s", id);
      return id;
    }
    if (userErrors.some((e: any) => e.message?.includes("already been set"))) {
      console.warn("[pixel] registerAppPixel: pixel already set; returning null (live on storefront)");
      return null;
    }
    console.error("[pixel] registerAppPixel errors", userErrors);
    return null;
  } catch (err: any) {
    console.error("[pixel] registerAppPixel threw", err?.message);
    return null;
  }
}

export async function deregisterAppPixel(shop: string, accessToken: string, pixelId: string): Promise<void> {
  console.log("[pixel] deregisterAppPixel pixelId=%s", pixelId);
  try {
    const client = new shopify.clients.Graphql({ session: makeSession(shop, accessToken) });
    const resp = await client.request(WEB_PIXEL_DELETE, { variables: { id: pixelId } });
    const userErrors = (resp.data as any)?.webPixelDelete?.userErrors ?? [];
    if (userErrors.length) console.warn("[pixel] deregisterAppPixel userErrors", userErrors);
    else console.log("[pixel] deregisterAppPixel deleted %s", pixelId);
  } catch (err: any) {
    console.warn("[pixel] deregisterAppPixel non-fatal", err?.message);
  }
}
