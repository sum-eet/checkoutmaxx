export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/verifyWebhookHmac";
import { getShop } from "@/lib/shop";
import { prisma } from "@/lib/prisma";
import { refreshShopPlan } from "@/lib/billing/plusGate";

export async function POST(req: NextRequest) {
  console.log("[PRD-2:webhooks/shop-update] POST entry");

  const verified = await verifyWebhookHmac(req);
  if (!verified) {
    console.warn("[PRD-2:webhooks/shop-update] HMAC verification failed");
    return new Response("Unauthorized", { status: 401 });
  }

  const shopDomain = req.headers.get("x-shopify-shop-domain") ?? "";
  console.log("[PRD-2:webhooks/shop-update] shop=%s", shopDomain);

  if (!shopDomain) {
    return new Response("Bad Request", { status: 400 });
  }

  const shopRow = await getShop(shopDomain);
  if (!shopRow) {
    console.warn("[PRD-2:webhooks/shop-update] shop not found domain=%s", shopDomain);
    return new Response("OK", { status: 200 });
  }

  // TODO(PRD-2-merge): planCheckedAt field not in schema yet — skip update, just refresh
  // await prisma.shop.update({ where: { id: shopRow.id }, data: { planCheckedAt: null } });
  await refreshShopPlan(shopRow.id);
  console.log("[PRD-2:webhooks/shop-update] plan refreshed shopId=%s", shopRow.id);

  return new Response("OK", { status: 200 });
}
