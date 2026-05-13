export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShopAndToken } from "@/lib/verify-session-token";
import { ensureShop } from "@/lib/shop";
import { requirePlus } from "@/lib/billing/plusGate";
import { prisma } from "@/lib/prisma";
import { recomputeOnboarding } from "@/lib/onboarding/recompute";

const PLUS_ONLY_RESPONSE = NextResponse.json(
  { error: "plus_only", upgrade_url: "https://www.shopify.com/plus" },
  { status: 402 }
);

export async function GET(req: NextRequest) {
  console.log("[PRD-2:recovery/rule] GET entry");

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-2:recovery/rule] GET: no authenticated shop");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const shopRow = await ensureShop(authed.shopDomain, authed.token);
  if (!shopRow) {
    console.warn("[PRD-2:recovery/rule] GET: shop not found domain=%s", authed.shopDomain);
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }
  const shopId = shopRow.id;

  // TODO(PRD-3): requireFeature(shopId, "recovery")
  const gate = await requirePlus(shopId);
  if (!gate.ok) {
    console.log("[PRD-2:recovery/rule] GET: plus gate fail reason=%s shopId=%s", gate.reason, shopId);
    return PLUS_ONLY_RESPONSE;
  }

  // TODO(PRD-2-merge): remove (prisma as any) casts once RecoveryRule/isPlus are in schema
  const p = prisma as any;
  const [shop, rule] = await Promise.all([
    prisma.shop.findUnique({ where: { id: shopId }, select: { shopDomain: true } }),
    p.recoveryRule.findUnique({ where: { shopId } }),
  ]);

  console.log("[PRD-2:recovery/rule] GET: ok shopId=%s ruleId=%s", shopId, rule?.id ?? "none");
  return NextResponse.json({ isPlus: true, rule });
}

export async function PUT(req: NextRequest) {
  console.log("[PRD-2:recovery/rule] PUT entry");

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn("[PRD-2:recovery/rule] PUT: no authenticated shop");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const shopRow = await ensureShop(authed.shopDomain, authed.token);
  if (!shopRow) {
    console.warn("[PRD-2:recovery/rule] PUT: shop not found domain=%s", authed.shopDomain);
    return NextResponse.json({ error: "shop_not_found" }, { status: 404 });
  }
  const shopId = shopRow.id;

  // TODO(PRD-3): requireFeature(shopId, "recovery")
  const gate = await requirePlus(shopId);
  if (!gate.ok) {
    console.log("[PRD-2:recovery/rule] PUT: plus gate fail reason=%s shopId=%s", gate.reason, shopId);
    return PLUS_ONLY_RESPONSE;
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const {
    enabled,
    threshold,
    codeStrategy,
    staticCode,
    generatedPercent,
    expiryMinutes,
    allowStacking,
  } = body;

  // Basic validation
  if (!["static", "generated"].includes(codeStrategy)) {
    return NextResponse.json({ error: "invalid_codeStrategy" }, { status: 400 });
  }
  if (codeStrategy === "static" && !staticCode) {
    return NextResponse.json({ error: "staticCode_required" }, { status: 400 });
  }
  if (codeStrategy === "generated") {
    const pct = Number(generatedPercent);
    if (!pct || pct < 1 || pct > 50) {
      return NextResponse.json({ error: "generatedPercent_out_of_range" }, { status: 400 });
    }
  }
  const thr = Number(threshold);
  if (!thr || thr < 1 || thr > 5) {
    return NextResponse.json({ error: "threshold_out_of_range" }, { status: 400 });
  }
  const expiry = Number(expiryMinutes);
  if (![15, 60, 360, 1440].includes(expiry)) {
    return NextResponse.json({ error: "invalid_expiryMinutes" }, { status: 400 });
  }

  const data = {
    enabled: Boolean(enabled),
    threshold: thr,
    codeStrategy,
    staticCode: codeStrategy === "static" ? String(staticCode).trim().toUpperCase() : null,
    generatedPercent: codeStrategy === "generated" ? Number(generatedPercent) : null,
    expiryMinutes: expiry,
    allowStacking: Boolean(allowStacking),
  };

  // TODO(PRD-2-merge): remove cast once RecoveryRule model is in schema
  const rule = await (prisma as any).recoveryRule.upsert({
    where: { shopId },
    create: { shopId, ...data },
    update: data,
  });

  console.log("[PRD-2:recovery/rule] PUT: saved ruleId=%s shopId=%s enabled=%s", rule.id, shopId, rule.enabled);

  // PRD-4: recompute onboarding state when recovery rule is toggled (step4 check)
  try {
    await recomputeOnboarding(shopId);
    console.log("[PRD-4:recovery/rule] PUT: onboarding recomputed shopId=%s", shopId);
  } catch (err: any) {
    // Non-fatal: onboarding must not block rule saves
    console.error("[PRD-4:recovery/rule] PUT: recompute error (non-fatal)", err.message);
  }

  return NextResponse.json({ rule });
}
