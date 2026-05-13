/**
 * PRD-3 — Test mode detection for Shopify billing subscriptions.
 * Dev stores and partner sandbox stores must use test:true or
 * the subscription flow will fail.
 */

export interface ShopForTestMode {
  partnerDevelopment: boolean;
  planDisplayName: string | null;
}

export function shouldUseTestMode(shop: ShopForTestMode): boolean {
  console.log(
    "[PRD-3:testMode] shouldUseTestMode partnerDevelopment=%s planDisplayName=%s NODE_ENV=%s",
    shop.partnerDevelopment,
    shop.planDisplayName,
    process.env.NODE_ENV,
  );
  return shop.partnerDevelopment === true || shop.planDisplayName === "Developer Preview";
}
