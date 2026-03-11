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

  const response = await client.query({
    data: {
      query: `mutation appSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
        appSubscriptionCreate(name: $name, lineItems: $lineItems, returnUrl: $returnUrl, test: $test) {
          appSubscription { id }
          confirmationUrl
          userErrors { field message }
        }
      }`,
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
    },
  });

  type CreateResponse = { data: { appSubscriptionCreate: { appSubscription: { id: string }; confirmationUrl: string; userErrors: { field: string; message: string }[] } } };
  const body = response.body as unknown as CreateResponse;
  const data = body.data.appSubscriptionCreate;
  if (data.userErrors?.length) throw new Error(data.userErrors[0].message);
  return data.confirmationUrl;
}

export async function getActiveSubscription(
  shop: string,
  accessToken: string
): Promise<{ id: string; status: string } | null> {
  const session = makeSession(shop, accessToken);
  const client = new shopify.clients.Graphql({ session });

  const response = await client.query({
    data: {
      query: `{ currentAppInstallation { activeSubscriptions { id status } } }`,
    },
  });

  type SubsResponse = { data: { currentAppInstallation: { activeSubscriptions: { id: string; status: string }[] } } };
  const body = response.body as unknown as SubsResponse;
  const subs = body.data.currentAppInstallation.activeSubscriptions;
  return subs?.[0] ?? null;
}
