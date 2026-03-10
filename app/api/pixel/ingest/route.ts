import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sanitizePayload } from "@/lib/sanitize";

// CORS headers — required for sendBeacon cross-origin requests
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const start = Date.now();

  // sendBeacon sends as text/plain — must parse manually
  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ error: "Failed to read body" }, { status: 400, headers: CORS });
  }

  let body: {
    shopDomain: string;
    eventType: string;
    sessionId: string | null;
    occurredAt: string;
    deviceType: string | null;
    country: string | null;
    data: Record<string, unknown>;
  };

  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const { shopDomain, eventType, sessionId, occurredAt, deviceType, country, data } = body;

  if (!shopDomain || !eventType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400, headers: CORS });
  }

  // Look up shop — must exist and be active
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop || !shop.isActive) {
    return NextResponse.json({ ok: false }, { status: 404, headers: CORS });
  }

  // Extract enrichment fields based on event type
  let discountCode: string | null = null;
  let totalPrice: number | null = null;
  let gatewayName: string | null = null;
  let errorMessage: string | null = null;
  let extensionId: string | null = null;

  if (eventType === "checkout_completed") {
    const codes = data.discountCodes as string[] | undefined;
    discountCode = codes?.[0] ?? null;
    const price = data.totalPrice as string | number | undefined;
    totalPrice = price != null ? parseFloat(String(price)) || null : null;
    gatewayName = (data.gateway as string | undefined) ?? null;
  }

  if (eventType === "alert_displayed") {
    const msg = (data as any)?.message || (data as any)?.alert?.message || null;
    errorMessage = msg;
    if (
      typeof msg === "string" &&
      (msg.toLowerCase().includes("discount") ||
        msg.toLowerCase().includes("coupon") ||
        msg.toLowerCase().includes("promo"))
    ) {
      discountCode = (data as any)?.checkout?.discountCode ?? null;
    }
  }

  if (eventType === "ui_extension_errored") {
    errorMessage = (data as any)?.error?.message ?? null;
    extensionId = (data as any)?.extensionId ?? null;
  }

  // Sanitize PII from raw payload before storage (Guardrail #3)
  const safePayload = sanitizePayload(data);

  // Write to DB — single insert, stays well under 200ms
  // Alert evaluation happens in background cron jobs, never here
  try {
    await prisma.checkoutEvent.create({
      data: {
        shopId: shop.id,
        sessionId: sessionId || "unknown",
        eventType,
        deviceType: deviceType ?? null,
        country: country ?? null,
        discountCode,
        totalPrice,
        currency: (data.currency as string | undefined) ?? null,
        gatewayName,
        errorMessage,
        extensionId,
        rawPayload: safePayload,
        occurredAt: new Date(occurredAt),
      },
    });
  } catch (err) {
    console.error("[ingest] DB write failed:", err);
    // Still return 200 — don't block the pixel
    return NextResponse.json({ ok: false, error: "db" }, { status: 200, headers: CORS });
  }

  const elapsed = Date.now() - start;
  if (elapsed > 180) {
    console.warn(`[ingest] Slow response: ${elapsed}ms`);
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
}
