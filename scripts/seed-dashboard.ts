/**
 * PRD-5 performance test seed script.
 * Seeds 100K CheckoutEvents across 90 days for a target shop.
 *
 * Usage:
 *   SHOP_DOMAIN=<domain> npx tsx scripts/seed-dashboard.ts
 *   SHOP_DOMAIN=<domain> SHOP_ID=<id> npx tsx scripts/seed-dashboard.ts
 *
 * Options (env vars):
 *   SHOP_DOMAIN  — required; resolves shopId from DB via prisma
 *   SHOP_ID      — optional; skip DB lookup if you already know the shopId
 *   EVENT_COUNT  — number of events to seed (default 100000)
 *   DRY_RUN      — set to "1" to print plan without writing
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// Must come after dotenv so DATABASE_URL is set
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SHOP_DOMAIN = process.env.SHOP_DOMAIN;
const SHOP_ID_OVERRIDE = process.env.SHOP_ID;
const EVENT_COUNT = parseInt(process.env.EVENT_COUNT ?? "100000", 10);
const DRY_RUN = process.env.DRY_RUN === "1";

const DEVICES = ["mobile", "tablet", "desktop"] as const;
const COUNTRIES = ["US", "CA", "GB", "AU", "DE", "FR", "IN", null] as const;
const CURRENCIES = ["USD", "CAD", "GBP", "AUD", "EUR", "INR"] as const;

// Funnel steps in order (index = funnel depth, lower indices more likely)
const FUNNEL_STEPS = [
  "checkout_started",
  "checkout_contact_info_submitted",
  "checkout_shipping_info_submitted",
  "payment_info_submitted",
  "checkout_completed",
] as const;

// Drop-off probability at each funnel step (cumulative reach probability)
// 100% reach checkout_started, then drop off progressively
const STEP_REACH_PROBABILITY = [1.0, 0.78, 0.61, 0.48, 0.35];

// Failed discount codes to sprinkle
const FAILED_CODES = ["SAVE10", "SUMMER20", "NEWUSER", "FLASH50", "INVALID99"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysAgo: number): Date {
  const ms = Date.now() - randomInt(0, daysAgo * 86400 * 1000);
  return new Date(ms);
}

function generateSessionId(): string {
  return `seed-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

type EventRow = {
  id: string;
  shopId: string;
  sessionId: string;
  eventType: string;
  deviceType: string | null;
  country: string | null;
  discountCode: string | null;
  totalPrice: number | null;
  currency: string | null;
  rawPayload: object;
  occurredAt: Date;
};

function buildEventsForSession(shopId: string, sessionId: string, baseTime: Date): EventRow[] {
  const device = randomFrom(DEVICES);
  const country = randomFrom(COUNTRIES);
  const currency = randomFrom(CURRENCIES);
  const totalPrice = randomInt(1500, 35000) / 100; // $15–$350
  const events: EventRow[] = [];

  for (let stepIdx = 0; stepIdx < FUNNEL_STEPS.length; stepIdx++) {
    // Does this session reach this step?
    if (Math.random() > STEP_REACH_PROBABILITY[stepIdx]) break;

    const eventType = FUNNEL_STEPS[stepIdx];
    const offsetMs = stepIdx * randomInt(30000, 180000); // 30s–3m between steps
    const occurredAt = new Date(baseTime.getTime() + offsetMs);

    const row: EventRow = {
      id: `seed-evt-${Math.random().toString(36).slice(2)}`,
      shopId,
      sessionId,
      eventType,
      deviceType: device,
      country: country ?? null,
      discountCode: null,
      totalPrice: eventType === "checkout_completed" ? totalPrice : null,
      currency: eventType === "checkout_completed" ? currency : null,
      rawPayload: {},
      occurredAt,
    };
    events.push(row);
  }

  return events;
}

// ---------------------------------------------------------------------------
// Cart events for failed discounts
// ---------------------------------------------------------------------------

type CartEventRow = {
  id: string;
  shopId: string;
  sessionId: string;
  cartToken: string;
  eventType: string;
  couponCode: string | null;
  couponSuccess: boolean | null;
  couponFailReason: string | null;
  occurredAt: Date;
};

function buildFailedDiscountEvent(shopId: string, sessionId: string, occurredAt: Date): CartEventRow {
  return {
    id: `seed-cart-${Math.random().toString(36).slice(2)}`,
    shopId,
    sessionId,
    cartToken: `token-${Math.random().toString(36).slice(2)}`,
    eventType: "cart_coupon_failed",
    couponCode: randomFrom(FAILED_CODES),
    couponSuccess: false,
    couponFailReason: "COUPON_CODE_NOT_FOUND",
    occurredAt,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!SHOP_DOMAIN && !SHOP_ID_OVERRIDE) {
    console.error("[seed-dashboard] SHOP_DOMAIN or SHOP_ID env var required");
    process.exit(1);
  }

  let shopId: string;
  if (SHOP_ID_OVERRIDE) {
    shopId = SHOP_ID_OVERRIDE;
    console.log("[seed-dashboard] using SHOP_ID override:", shopId);
  } else {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: SHOP_DOMAIN! },
      select: { id: true },
    });
    if (!shop) {
      console.error("[seed-dashboard] shop not found for domain:", SHOP_DOMAIN);
      process.exit(1);
    }
    shopId = shop.id;
    console.log("[seed-dashboard] resolved shopId=%s for domain=%s", shopId, SHOP_DOMAIN);
  }

  // Calculate how many sessions we need to generate ~EVENT_COUNT events.
  // Average events per session ≈ sum of reach probabilities ≈ 3.22
  const avgEventsPerSession = STEP_REACH_PROBABILITY.reduce((a, b) => a + b, 0);
  const sessionCount = Math.ceil(EVENT_COUNT / avgEventsPerSession);

  console.log("[seed-dashboard] plan: ~%d sessions × %.2f avg steps ≈ %d events, dry=%s",
    sessionCount, avgEventsPerSession, EVENT_COUNT, DRY_RUN);

  if (DRY_RUN) {
    console.log("[seed-dashboard] DRY_RUN — exiting without writing");
    return;
  }

  // Batch insert in chunks to avoid memory pressure
  const CHECKOUT_BATCH = 500;
  const CART_FAILURE_RATE = 0.08; // 8% of sessions also get a failed discount event

  let totalCheckoutEvents = 0;
  let totalCartEvents = 0;

  for (let i = 0; i < sessionCount; i += CHECKOUT_BATCH) {
    const chunkSize = Math.min(CHECKOUT_BATCH, sessionCount - i);
    const checkoutRows: EventRow[] = [];
    const cartRows: CartEventRow[] = [];

    for (let j = 0; j < chunkSize; j++) {
      const sessionId = generateSessionId();
      const baseTime = randomDate(90);
      const events = buildEventsForSession(shopId, sessionId, baseTime);
      checkoutRows.push(...events);

      if (Math.random() < CART_FAILURE_RATE) {
        cartRows.push(buildFailedDiscountEvent(shopId, sessionId, baseTime));
      }
    }

    // Use upsert-like createMany with skipDuplicates to be idempotent
    const [ceResult, cartResult] = await Promise.all([
      prisma.checkoutEvent.createMany({
        data: checkoutRows,
        skipDuplicates: true,
      }),
      cartRows.length > 0
        ? prisma.cartEvent.createMany({
            data: cartRows,
            skipDuplicates: true,
          })
        : Promise.resolve({ count: 0 }),
    ]);

    totalCheckoutEvents += ceResult.count;
    totalCartEvents += cartResult.count;

    if (i % 5000 === 0 && i > 0) {
      console.log("[seed-dashboard] progress: %d/%d sessions, %d checkout events, %d cart events",
        i, sessionCount, totalCheckoutEvents, totalCartEvents);
    }
  }

  console.log("[seed-dashboard] DONE: %d checkout events, %d cart events inserted for shopId=%s",
    totalCheckoutEvents, totalCartEvents, shopId);
}

main()
  .catch((err) => {
    console.error("[seed-dashboard] fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
