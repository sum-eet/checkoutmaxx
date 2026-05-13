export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { sanitizePayload } from "@/lib/sanitize";
import { supabase } from "@/lib/supabase";
import { getShop } from "@/lib/shop";
import prisma from "@/lib/prisma";
import { recomputeOnboarding } from "@/lib/onboarding/recompute";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 500;
const WINDOW_MS = 60_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ error: "Failed to read body" }, { status: 400, headers: CORS });
  }

  // PRD-1 §4.1 body shape: eventType, sessionId, deviceType, discountCode?,
  // totalPrice?, currency?, shippingPrice?, occurredAt, rawPayload, shopDomain
  // Legacy shape used `data` instead of `rawPayload` — handle both.
  let body: {
    shopDomain: string;
    eventType: string;
    sessionId: string | null;
    occurredAt: string;
    deviceType: string | null;
    discountCode?: string | null;
    totalPrice?: number | null;
    currency?: string | null;
    shippingPrice?: number | null;
    // PRD-1 new field
    rawPayload?: Record<string, unknown>;
    // legacy field name kept for old pixel versions
    data?: Record<string, unknown>;
    // legacy country field (old pixel resolved country client-side)
    country?: string | null;
  };

  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const {
    shopDomain,
    eventType,
    sessionId,
    occurredAt,
    deviceType,
    discountCode: bodyDiscountCode,
    totalPrice: bodyTotalPrice,
    currency: bodyCurrency,
    shippingPrice: bodyShippingPrice,
  } = body;

  // Support both new `rawPayload` and legacy `data` field names
  const rawPayloadIn: Record<string, unknown> = (body.rawPayload ?? body.data ?? {}) as Record<string, unknown>;

  if (!shopDomain || !eventType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400, headers: CORS });
  }

  const key = shopDomain || req.headers.get("x-forwarded-for") || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_LIMIT) {
      return NextResponse.json({ ok: false }, { status: 429, headers: CORS });
    }
    entry.count++;
  } else {
    rateLimitMap.set(key, { count: 1, resetAt: now + WINDOW_MS });
  }

  // PRD-1 §4.1 country priority: shippingAddress > billingAddress > x-vercel-ip-country
  // Must capture header BEFORE waitUntil (request headers unavailable in background)
  const headerCountry = req.headers.get("x-vercel-ip-country");

  waitUntil(
    processEvent({
      shopDomain,
      eventType,
      sessionId,
      occurredAt,
      deviceType,
      bodyDiscountCode: bodyDiscountCode ?? null,
      bodyTotalPrice: bodyTotalPrice ?? null,
      bodyCurrency: bodyCurrency ?? null,
      bodyShippingPrice: bodyShippingPrice ?? null,
      rawPayloadIn,
      headerCountry,
      // legacy: old pixel sent resolved country
      legacyCountry: body.country ?? null,
    })
  );
  return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
}

async function processEvent({
  shopDomain,
  eventType,
  sessionId,
  occurredAt,
  deviceType,
  bodyDiscountCode,
  bodyTotalPrice,
  bodyCurrency,
  bodyShippingPrice,
  rawPayloadIn,
  headerCountry,
  legacyCountry,
}: {
  shopDomain: string;
  eventType: string;
  sessionId: string | null;
  occurredAt: string;
  deviceType: string | null;
  bodyDiscountCode: string | null;
  bodyTotalPrice: number | null;
  bodyCurrency: string | null;
  bodyShippingPrice: number | null;
  rawPayloadIn: Record<string, unknown>;
  headerCountry: string | null;
  legacyCountry: string | null;
}) {
  const start = Date.now();
  console.log("[PRD-1:pixel/ingest] hit", { shopDomain, eventType, sessionId });

  const shop = await getShop(shopDomain);
  console.log("[PRD-1:pixel/ingest] shop_lookup", { shopDomain, found: !!shop, shopId: shop?.id ?? null });

  if (!shop) return;

  // PRD-1 §4.1 country resolution: shippingAddress → billingAddress → x-vercel-ip-country
  const checkout = (rawPayloadIn as any)?.checkout;
  const addrCountry =
    checkout?.shippingAddress?.countryCode ??
    checkout?.billingAddress?.countryCode ??
    null;
  const country = addrCountry ?? legacyCountry ?? headerCountry ?? null;
  const countrySource = addrCountry
    ? "address"
    : legacyCountry
    ? "legacy"
    : headerCountry
    ? "header"
    : "null";
  console.log("[PRD-1:pixel/ingest] country source=%s value=%s", countrySource, country);

  // Prefer explicit body fields; fall back to extracting from rawPayload for legacy pixels
  let discountCode: string | null = bodyDiscountCode;
  let totalPrice: number | null = bodyTotalPrice;
  let currency: string | null = bodyCurrency;
  let shippingPrice: number | null = bodyShippingPrice;
  let gatewayName: string | null = null;
  let errorMessage: string | null = null;
  let extensionId: string | null = null;

  if (eventType === "checkout_completed") {
    if (!discountCode) {
      const codes = (rawPayloadIn as any)?.discountCodes as string[] | undefined;
      discountCode = codes?.[0] ?? checkout?.discountApplications?.filter((d: any) => d.type === "DISCOUNT_CODE")?.[0]?.title ?? null;
    }
    if (totalPrice == null) {
      const price = (rawPayloadIn as any)?.totalPrice ?? checkout?.totalPrice?.amount;
      totalPrice = price != null ? parseFloat(String(price)) || null : null;
    }
    if (!currency) {
      currency = (rawPayloadIn as any)?.currency ?? checkout?.currencyCode ?? null;
    }
    if (shippingPrice == null) {
      const sp = checkout?.shippingLine?.price?.amount;
      shippingPrice = sp != null ? parseFloat(String(sp)) || null : null;
    }
    gatewayName = (rawPayloadIn as any)?.gateway ?? checkout?.transactions?.[0]?.gateway ?? null;
  }

  if (eventType === "alert_displayed") {
    const alert = (rawPayloadIn as any)?.alert;
    console.log("[PRD-1:pixel/ingest] alert_displayed", { target: alert?.target, value: alert?.value, message: alert?.message, sessionId });
    errorMessage = alert?.message || null;
    if (alert?.target === "cart.discountCode" && alert?.value) {
      discountCode = alert.value as string;
    }
  }

  if (eventType === "ui_extension_errored") {
    errorMessage = (rawPayloadIn as any)?.error?.message ?? null;
    extensionId = (rawPayloadIn as any)?.extensionId ?? null;
  }

  const safePayload = sanitizePayload(rawPayloadIn);
  const effectiveSessionId = sessionId || `anon_${crypto.randomUUID()}`;

  const { error: insertError } = await supabase.from("CheckoutEvent").insert({
    id: crypto.randomUUID(),
    shopId: shop.id,
    sessionId: effectiveSessionId,
    eventType,
    deviceType: deviceType ?? null,
    country,
    discountCode,
    totalPrice,
    shippingPrice,
    currency,
    gatewayName,
    errorMessage,
    extensionId,
    rawPayload: safePayload,
    occurredAt: new Date(occurredAt).toISOString(),
  });

  if (insertError) {
    console.error("[PRD-1:pixel/ingest] insert_fail", {
      code: (insertError as any).code,
      message: insertError.message,
      shopId: shop.id,
      eventType,
    });
  } else {
    console.log("[PRD-1:pixel/ingest] inserted", { shopId: shop.id, eventType, sessionId: effectiveSessionId });
  }

  // PRD-1 §4.3.1 — synthesize checkout_started for accelerated checkouts
  // (Shop Pay / Apple Pay / Google Pay can skip the checkout_started event)
  if (eventType !== "checkout_started" && sessionId) {
    try {
      await prisma.checkoutEvent.upsert({
        where: {
          shopId_sessionId_eventType: {
            shopId: shop.id,
            sessionId: effectiveSessionId,
            eventType: "checkout_started",
          },
        },
        update: {},
        create: {
          shopId: shop.id,
          sessionId: effectiveSessionId,
          eventType: "checkout_started",
          deviceType: deviceType ?? null,
          country,
          occurredAt: new Date(occurredAt),
          rawPayload: { synthesized: true },
        },
      });
      console.log("[PRD-1:pixel/ingest] synthesized checkout_started upsert ok", { sessionId: effectiveSessionId, shopId: shop.id });
    } catch (e: any) {
      console.error("[PRD-1:pixel/ingest] synthesized checkout_started upsert failed", e.message);
    }
  }

  // Mirror alert_displayed cart discount errors to CartEvent for sessions UI
  if (
    eventType === "alert_displayed" &&
    (rawPayloadIn as any)?.alert?.target === "cart.discountCode" &&
    (rawPayloadIn as any)?.alert?.value
  ) {
    const alert = (rawPayloadIn as any).alert;
    const { error: mirrorErr } = await supabase.from("CartEvent").insert({
      id: crypto.randomUUID(),
      shopId: shop.id,
      sessionId: effectiveSessionId,
      cartToken: "",
      eventType: "cart_coupon_failed",
      couponCode: alert.value as string,
      couponSuccess: false,
      couponFailReason: (alert.message as string) || "rejected",
      device: deviceType ?? null,
      country,
      occurredAt: new Date(occurredAt).toISOString(),
    });
    if (mirrorErr) {
      console.error("[PRD-1:pixel/ingest] alert mirror failed", mirrorErr);
    } else {
      console.log("[PRD-1:pixel/ingest] alert mirrored to CartEvent", { code: alert.value, sessionId: effectiveSessionId });
    }
  }

  // Mirror checkout_completed to CartEvent for session builder correlation
  if (eventType === "checkout_completed") {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recentCart } = await supabase
      .from("CartEvent")
      .select("sessionId, cartToken, country, device, utmSource, utmMedium, utmCampaign")
      .eq("shopId", shop.id)
      .eq("eventType", "cart_checkout_clicked")
      .gte("occurredAt", thirtyMinAgo)
      .order("occurredAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentCart) {
      const { error: cartInsertError } = await supabase.from("CartEvent").insert({
        id: crypto.randomUUID(),
        shopId: shop.id,
        sessionId: recentCart.sessionId,
        cartToken: recentCart.cartToken ?? "",
        eventType: "checkout_completed",
        cartValue: totalPrice != null ? Math.round(totalPrice * 100) : null,
        couponCode: discountCode ?? null,
        country: country ?? recentCart.country ?? null,
        device: deviceType ?? recentCart.device ?? null,
        utmSource: recentCart.utmSource ?? null,
        utmMedium: recentCart.utmMedium ?? null,
        utmCampaign: recentCart.utmCampaign ?? null,
        occurredAt: new Date(occurredAt).toISOString(),
      });
      if (cartInsertError) {
        console.error("[PRD-1:pixel/ingest] CartEvent checkout_completed mirror failed", cartInsertError);
      } else {
        console.log("[PRD-1:pixel/ingest] checkout_completed mirrored to CartEvent", { cartSessionId: recentCart.sessionId });
      }
    } else {
      console.warn("[PRD-1:pixel/ingest] checkout_completed — no recent cart_checkout_clicked for shop", shopDomain);
    }
  }

  // PRD-4: trigger onboarding recompute when a CartEvent was (or may have been) written,
  // but only if step1 was previously null — avoids a DB round-trip on every ingest.
  // alert_displayed mirrors to CartEvent; checkout_completed also mirrors. Check both.
  const cartEventWritten =
    eventType === "alert_displayed" ||
    eventType === "checkout_completed" ||
    // The main CartEvent write path for the cart-monitor events is via supabase above.
    // Any event type can produce a CartEvent via cart-monitor; we check step1 lazily.
    true;

  if (cartEventWritten) {
    try {
      // Cheap read: check if step1 is already completed to skip unnecessary upsert
      const existingState = await prisma.onboardingState.findUnique({
        where: { shopId: shop.id },
        select: { step1Completed: true },
      });
      if (!existingState?.step1Completed) {
        console.log("[PRD-4:pixel/ingest] step1 null — triggering onboarding recompute shopId=%s", shop.id);
        await recomputeOnboarding(shop.id);
      } else {
        console.log("[PRD-4:pixel/ingest] step1 already completed — skip recompute shopId=%s", shop.id);
      }
    } catch (err: any) {
      // Non-fatal: onboarding recompute failure must not break pixel ingest
      console.error("[PRD-4:pixel/ingest] recompute error (non-fatal)", err.message);
    }
  }

  console.log("[PRD-1:pixel/ingest] done", { shopId: shop.id, eventType, ms: Date.now() - start });
}
