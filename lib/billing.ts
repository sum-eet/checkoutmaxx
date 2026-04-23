import { shopify } from "./shopify";
import { Session } from "@shopify/shopify-api";

export const PRO_PLAN = {
  name: "Pro",
  price: 49,
  currencyCode: "USD",
  interval: "EVERY_30_DAYS",
  trialDays: 7,
} as const;

function makeSession(shop: string, accessToken: string): Session {
  return new Session({
    id: `offline_${shop}`,
    shop,
    state: "",
    isOnline: false,
    accessToken,
  });
}

export async function createSubscription(
  shop: string,
  accessToken: string,
  returnUrl: string
): Promise<string> {
  const session = makeSession(shop, accessToken);
  const client = new shopify.clients.Graphql({ session });

  const response = await client.request(
    `mutation appSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
      appSubscriptionCreate(name: $name, lineItems: $lineItems, returnUrl: $returnUrl, test: $test) {
        appSubscription { id }
        confirmationUrl
        userErrors { field message }
      }
    }`,
    {
      variables: {
        name: PRO_PLAN.name,
        returnUrl,
        test: process.env.NODE_ENV !== "production",
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: {
                  amount: PRO_PLAN.price,
                  currencyCode: PRO_PLAN.currencyCode,
                },
                interval: PRO_PLAN.interval,
              },
            },
          },
        ],
      },
    }
  );

  const data = (response.data as any)?.appSubscriptionCreate;
  if (!data) throw new Error("No response from appSubscriptionCreate");
  if (data.userErrors?.length) throw new Error(data.userErrors[0].message);
  return data.confirmationUrl;
}

export async function cancelSubscription(
  shop: string,
  accessToken: string,
  subscriptionId: string
): Promise<{ id: string; status: string }> {
  const session = makeSession(shop, accessToken);
  const client = new shopify.clients.Graphql({ session });

  const response = await client.request(
    `mutation appSubscriptionCancel($id: ID!) {
      appSubscriptionCancel(id: $id) {
        appSubscription { id status }
        userErrors { field message }
      }
    }`,
    { variables: { id: subscriptionId } }
  );

  const data = (response.data as any)?.appSubscriptionCancel;
  if (!data) throw new Error('No response from appSubscriptionCancel');
  if (data.userErrors?.length) throw new Error(data.userErrors[0].message);
  return data.appSubscription;
}

export async function getActiveSubscription(
  shop: string,
  accessToken: string
): Promise<{ id: string; status: string } | null> {
  const session = makeSession(shop, accessToken);
  const client = new shopify.clients.Graphql({ session });

  const response = await client.request(
    `{ currentAppInstallation { activeSubscriptions { id status } } }`
  );

  const subs = (response.data as any)?.currentAppInstallation?.activeSubscriptions ?? [];
  return subs[0] ?? null;
}
