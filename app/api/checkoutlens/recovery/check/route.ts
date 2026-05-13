export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getShop } from "@/lib/shop";
import { requirePlus } from "@/lib/billing/plusGate";
import { prisma } from "@/lib/prisma";
import { Session } from "@shopify/shopify-api";
import { shopify } from "@/lib/shopify";

function randomAlphanum(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const VERIFY_CODE_QUERY = `
  query codeDiscountNodeByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        ... on DiscountCodeBasic {
          status
        }
      }
    }
  }
`;

const CREATE_DISCOUNT_MUTATION = `
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            codes(first: 1) {
              nodes { code }
            }
          }
        }
      }
      userErrors { field code message }
    }
  }
`;

async function createDiscount(
  client: ReturnType<typeof shopify.clients.Graphql.prototype.constructor extends new (...a: any[]) => infer R ? new (...a: any[]) => R : never>,
  shopDomain: string,
  sessionId: string,
  rule: { generatedPercent: number | null; expiryMinutes: number; allowStacking: boolean },
  code: string
): Promise<{ nodeId: string; code: string } | { error: "collision" } | { error: "failed"; message: string }> {
  const now = new Date();
  const endsAt = new Date(now.getTime() + rule.expiryMinutes * 60_000);

  const input = {
    title: `Recovery ${shopDomain} ${sessionId.slice(0, 8)}`,
    code,
    customerSelection: { all: true },
    customerGets: {
      value: { percentage: (rule.generatedPercent ?? 10) / 100 },
      items: { all: true },
    },
    startsAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    usageLimit: 1,
    appliesOncePerCustomer: true,
    combinesWith: {
      orderDiscounts: rule.allowStacking,
      productDiscounts: rule.allowStacking,
      shippingDiscounts: rule.allowStacking,
    },
  };

  const res = await (client as any).request(CREATE_DISCOUNT_MUTATION, {
    variables: { basicCodeDiscount: input },
  });

  const data = (res.data as any)?.discountCodeBasicCreate;
  const userErrors: Array<{ code: string; message: string }> = data?.userErrors ?? [];

  if (userErrors.length > 0) {
    const isCollision = userErrors.some(
      (e) =>
        e.code === "TAKEN" ||
        e.message?.toLowerCase().includes("already been taken") ||
        e.message?.toLowerCase().includes("code has been used")
    );
    if (isCollision) return { error: "collision" };
    return { error: "failed", message: userErrors[0].message };
  }

  const nodeId: string = data?.codeDiscountNode?.id ?? "";
  const returnedCode: string =
    data?.codeDiscountNode?.codeDiscount?.codes?.nodes?.[0]?.code ?? code;

  return { nodeId, code: returnedCode };
}

export async function POST(req: NextRequest) {
  console.log("[PRD-2:recovery/check] POST entry");

  let body: { shopDomain?: string; sessionId?: string; cartToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { shopDomain, sessionId, cartToken } = body;
  if (!shopDomain || !sessionId) {
    console.warn("[PRD-2:recovery/check] missing shopDomain or sessionId");
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  console.log("[PRD-2:recovery/check] shopDomain=%s sessionId=%s", shopDomain, sessionId);

  const shopRow = await getShop(shopDomain);
  if (!shopRow) {
    console.warn("[PRD-2:recovery/check] shop not found domain=%s", shopDomain);
    return NextResponse.json({ status: "shop_not_found" }, { status: 404 });
  }
  const shopId = shopRow.id;

  // TODO(PRD-3): requireFeature(shopId, "recovery")
  const gate = await requirePlus(shopId);
  if (!gate.ok) {
    console.log("[PRD-2:recovery/check] not_plus shopId=%s reason=%s", shopId, gate.reason);
    return NextResponse.json({ status: "not_plus" });
  }

  const rule = await prisma.recoveryRule.findUnique({ where: { shopId } });
  if (!rule || !rule.enabled) {
    console.log("[PRD-2:recovery/check] disabled shopId=%s", shopId);
    return NextResponse.json({ status: "disabled" });
  }

  // Count failures in last hour
  const since = new Date(Date.now() - 60 * 60_000);
  const failureCount = await prisma.cartEvent.count({
    where: {
      shopId,
      sessionId,
      eventType: "cart_coupon_failed",
      occurredAt: { gte: since },
    },
  });

  console.log("[PRD-2:recovery/check] failureCount=%d threshold=%d shopId=%s sessionId=%s", failureCount, rule.threshold, shopId, sessionId);

  if (failureCount < rule.threshold) {
    return NextResponse.json({ status: "below_threshold", current: failureCount, threshold: rule.threshold });
  }

  // Race-safe issuance
  const expiresAt = new Date(Date.now() + rule.expiryMinutes * 60_000);

  if (rule.codeStrategy === "static") {
    const staticCode = rule.staticCode ?? "";
    // Verify code exists and is active in Shopify
    try {
      const session = new Session({
        id: `offline_${shopDomain}`,
        shop: shopDomain,
        state: "installed",
        isOnline: false,
        accessToken: shopRow.accessToken,
      });
      const client = new shopify.clients.Graphql({ session });
      const res = await (client as any).request(VERIFY_CODE_QUERY, { variables: { code: staticCode } });
      const status = (res.data as any)?.codeDiscountNodeByCode?.codeDiscount?.status;
      if (!status || status !== "ACTIVE") {
        console.warn("[PRD-2:recovery/check] static code invalid or not active code=%s shopId=%s", staticCode, shopId);
        return NextResponse.json({ status: "static_code_invalid" });
      }
    } catch (err: any) {
      console.error("[PRD-2:recovery/check] static code verify error shopId=%s", shopId, err?.message);
      return NextResponse.json({ status: "static_code_invalid" });
    }

    try {
      const issue = await prisma.recoveryIssue.create({
        data: { shopId, sessionId, cartToken: cartToken ?? null, code: staticCode, source: "static", expiresAt },
      });
      console.log("[PRD-2:recovery/check] static issued issueId=%s shopId=%s", issue.id, shopId);
      return NextResponse.json({ status: "issued", code: issue.code, expiresAt: issue.expiresAt });
    } catch (err: any) {
      if (err?.code === "P2002") {
        // Race: fetch existing
        const existing = await prisma.recoveryIssue.findUnique({ where: { shopId_sessionId: { shopId, sessionId } } });
        if (!existing) return NextResponse.json({ status: "error" }, { status: 500 });
        if (existing.expiresAt < new Date()) {
          console.log("[PRD-2:recovery/check] existing issue expired sessionId=%s", sessionId);
          return NextResponse.json({ status: "expired" });
        }
        console.log("[PRD-2:recovery/check] returning existing issue issueId=%s", existing.id);
        return NextResponse.json({ status: "issued", code: existing.code, expiresAt: existing.expiresAt });
      }
      throw err;
    }
  }

  // codeStrategy === "generated"
  const session = new Session({
    id: `offline_${shopDomain}`,
    shop: shopDomain,
    state: "installed",
    isOnline: false,
    accessToken: shopRow.accessToken,
  });
  const client = new shopify.clients.Graphql({ session });

  const firstCode = `RECOVER-${randomAlphanum(8)}`;
  let discountResult = await createDiscount(client as any, shopDomain, sessionId, {
    generatedPercent: rule.generatedPercent,
    expiryMinutes: rule.expiryMinutes,
    allowStacking: rule.allowStacking,
  }, firstCode);

  if ("error" in discountResult && discountResult.error === "collision") {
    console.log("[PRD-2:recovery/check] code collision on first try, retrying shopId=%s", shopId);
    const retryCode = `RECOVER-${randomAlphanum(8)}`;
    discountResult = await createDiscount(client as any, shopDomain, sessionId, {
      generatedPercent: rule.generatedPercent,
      expiryMinutes: rule.expiryMinutes,
      allowStacking: rule.allowStacking,
    }, retryCode);

    if ("error" in discountResult) {
      console.error("[PRD-2:recovery/check] code collision after retry shopId=%s", shopId);
      return NextResponse.json({ status: "code_generation_failed" });
    }
  }

  if ("error" in discountResult) {
    console.error("[PRD-2:recovery/check] discount creation failed shopId=%s msg=%s", shopId, discountResult.message);
    return NextResponse.json({ status: "code_generation_failed" });
  }

  const { nodeId, code: issuedCode } = discountResult;

  try {
    const issue = await prisma.recoveryIssue.create({
      data: { shopId, sessionId, cartToken: cartToken ?? null, code: issuedCode, source: "generated", discountNodeId: nodeId, expiresAt },
    });
    console.log("[PRD-2:recovery/check] generated issued issueId=%s code=%s shopId=%s", issue.id, issuedCode, shopId);
    return NextResponse.json({ status: "issued", code: issue.code, expiresAt: issue.expiresAt });
  } catch (err: any) {
    if (err?.code === "P2002") {
      const existing = await prisma.recoveryIssue.findUnique({ where: { shopId_sessionId: { shopId, sessionId } } });
      if (!existing) return NextResponse.json({ status: "error" }, { status: 500 });
      if (existing.expiresAt < new Date()) {
        console.log("[PRD-2:recovery/check] existing issue expired sessionId=%s", sessionId);
        return NextResponse.json({ status: "expired" });
      }
      console.log("[PRD-2:recovery/check] returning existing (race) issueId=%s", existing.id);
      return NextResponse.json({ status: "issued", code: existing.code, expiresAt: existing.expiresAt });
    }
    throw err;
  }
}
