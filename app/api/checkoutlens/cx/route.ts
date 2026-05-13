export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getShop } from "@/lib/shop";
import { requirePlus } from "@/lib/billing/plusGate";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  console.log("[PRD-2:cx] POST entry");

  let body: { shopDomain?: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { shopDomain, sessionId } = body;
  if (!shopDomain || !sessionId) {
    console.warn("[PRD-2:cx] missing shopDomain or sessionId");
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  console.log("[PRD-2:cx] shopDomain=%s sessionId=%s", shopDomain, sessionId);

  const shopRow = await getShop(shopDomain);
  if (!shopRow) {
    console.warn("[PRD-2:cx] shop not found domain=%s", shopDomain);
    return NextResponse.json({ status: "none" });
  }
  const shopId = shopRow.id;

  // TODO(PRD-3): requireFeature(shopId, "recovery")
  const gate = await requirePlus(shopId);
  if (!gate.ok) {
    console.log("[PRD-2:cx] not_plus shopId=%s", shopId);
    return NextResponse.json({ status: "none" });
  }

  // TODO(PRD-2-merge): remove (prisma as any) cast once RecoveryIssue model is in schema
  const p = prisma as any;
  const issue = await p.recoveryIssue.findUnique({
    where: { shopId_sessionId: { shopId, sessionId } },
  });

  if (!issue) {
    console.log("[PRD-2:cx] no issue found shopId=%s sessionId=%s", shopId, sessionId);
    return NextResponse.json({ status: "none" });
  }

  if (issue.expiresAt < new Date()) {
    console.log("[PRD-2:cx] issue expired issueId=%s", issue.id);
    return NextResponse.json({ status: "none" });
  }

  // Set claimedAt if not already set
  if (!issue.claimedAt) {
    await p.recoveryIssue.update({
      where: { id: issue.id },
      data: { claimedAt: new Date() },
    });
    console.log("[PRD-2:cx] claimedAt set issueId=%s", issue.id);
  } else {
    console.log("[PRD-2:cx] already claimed issueId=%s claimedAt=%s", issue.id, issue.claimedAt);
  }

  console.log("[PRD-2:cx] returning code=%s issueId=%s", issue.code, issue.id);
  return NextResponse.json({ code: issue.code, expiresAt: issue.expiresAt });
}
