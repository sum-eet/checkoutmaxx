export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/verifyWebhookHmac";
import { getShop } from "@/lib/shop";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  console.log("[PRD-2:webhooks/orders-create] POST entry");

  const verified = await verifyWebhookHmac(req);
  if (!verified) {
    console.warn("[PRD-2:webhooks/orders-create] HMAC verification failed");
    return new Response("Unauthorized", { status: 401 });
  }

  const shopDomain = req.headers.get("x-shopify-shop-domain") ?? "";
  const order = verified.body as any;

  console.log("[PRD-2:webhooks/orders-create] shop=%s orderId=%s", shopDomain, order?.id);

  if (!shopDomain || !order?.id) {
    console.warn("[PRD-2:webhooks/orders-create] missing shop domain or order id");
    return new Response("Bad Request", { status: 400 });
  }

  const shopRow = await getShop(shopDomain);
  if (!shopRow) {
    console.warn("[PRD-2:webhooks/orders-create] shop not found domain=%s", shopDomain);
    return new Response("OK", { status: 200 });
  }
  const shopId = shopRow.id;

  const discountApplications: Array<{ code?: string; type?: string }> =
    order.discount_applications ?? [];

  const cartToken: string | null = order.cart_token ?? null;
  const orderIdStr = String(order.id);
  // Shopify total_price is a string like "123.45"
  const totalCents = Math.round(parseFloat(order.total_price ?? "0") * 100);

  console.log("[PRD-2:webhooks/orders-create] discountApplications=%d cartToken=%s total=%d", discountApplications.length, cartToken, totalCents);

  // TODO(PRD-2-merge): remove cast once RecoveryIssue model is in schema
  const p = prisma as any;

  for (const discount of discountApplications) {
    if (discount.type !== "discount_code" || !discount.code) continue;
    const code = String(discount.code).toUpperCase();

    console.log("[PRD-2:webhooks/orders-create] checking code=%s shopId=%s", code, shopId);

    // Try cart_token match first, fall back to code-only match
    let issue = cartToken
      ? await p.recoveryIssue.findFirst({
          where: { shopId, cartToken, code, redeemedAt: null },
        })
      : null;

    if (!issue) {
      issue = await p.recoveryIssue.findFirst({
        where: { shopId, code, redeemedAt: null },
      });
    }

    if (!issue) {
      console.log("[PRD-2:webhooks/orders-create] no matching unredeemed issue code=%s shopId=%s", code, shopId);
      continue;
    }

    await p.recoveryIssue.update({
      where: { id: issue.id },
      data: {
        redeemedAt: new Date(),
        redeemedOrderId: orderIdStr,
        redeemedTotal: totalCents,
      },
    });

    console.log("[PRD-2:webhooks/orders-create] attributed issueId=%s code=%s orderId=%s total=%d", issue.id, code, orderIdStr, totalCents);
  }

  return new Response("OK", { status: 200 });
}
