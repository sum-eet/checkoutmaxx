import { unstable_cache } from "next/cache";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type KpisInput = {
  shopId: string;
  start: Date;
  end: Date;
  country?: string;
  device?: "mobile" | "tablet" | "desktop";
  discountUsage?: "used" | "failed" | "none";
};

export type KpiPeriod = {
  convRate: number;
  aov: number;
  shippingRev: number;
  attempts: number;
};

export type KpisOutput = {
  current: KpiPeriod;
  previous: KpiPeriod;
};

type RawKpiRow = {
  conv_rate: string | number | null;
  aov: string | number | null;
  shipping_rev: string | number | null;
  attempts: string | bigint;
};

function toNum(v: string | number | bigint | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

async function kpisForPeriod(
  shopId: string,
  start: Date,
  end: Date,
  country: string | undefined,
  device: string | undefined,
  discountUsage: string | undefined
): Promise<KpiPeriod> {
  const whereParts: Prisma.Sql[] = [
    Prisma.sql`"shopId" = ${shopId}`,
    Prisma.sql`"occurredAt" BETWEEN ${start} AND ${end}`,
  ];
  if (country) whereParts.push(Prisma.sql`"country" = ${country}`);
  if (device) whereParts.push(Prisma.sql`"deviceType" = ${device}`);

  if (discountUsage === "used") {
    whereParts.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "CartEvent" ce
        WHERE ce."sessionId" = "CheckoutEvent"."sessionId"
          AND ce."shopId" = ${shopId}
          AND ce."eventType" = 'cart_coupon_applied'
          AND ce."couponSuccess" = true
      )`
    );
  } else if (discountUsage === "failed") {
    whereParts.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "CartEvent" ce
        WHERE ce."sessionId" = "CheckoutEvent"."sessionId"
          AND ce."shopId" = ${shopId}
          AND ce."eventType" = 'cart_coupon_failed'
      )`
    );
  } else if (discountUsage === "none") {
    whereParts.push(
      Prisma.sql`NOT EXISTS (
        SELECT 1 FROM "CartEvent" ce
        WHERE ce."sessionId" = "CheckoutEvent"."sessionId"
          AND ce."shopId" = ${shopId}
          AND ce."eventType" IN ('cart_coupon_applied', 'cart_coupon_failed')
      )`
    );
  }

  const whereClause = Prisma.join(whereParts, " AND ");

  const rows = await prisma.$queryRaw<RawKpiRow[]>`
    SELECT
      CASE
        WHEN COUNT(DISTINCT "sessionId") FILTER (WHERE "eventType" = 'checkout_started') > 0
        THEN COUNT(DISTINCT "sessionId") FILTER (WHERE "eventType" = 'checkout_completed')::float
             / COUNT(DISTINCT "sessionId") FILTER (WHERE "eventType" = 'checkout_started')
        ELSE 0
      END AS conv_rate,
      AVG("totalPrice")    FILTER (WHERE "eventType" = 'checkout_completed') AS aov,
      SUM("shippingPrice") FILTER (WHERE "eventType" = 'checkout_completed') AS shipping_rev,
      COUNT(DISTINCT "sessionId") FILTER (WHERE "eventType" = 'checkout_started') AS attempts
    FROM "CheckoutEvent"
    WHERE ${whereClause};
  `;

  const r = rows[0];
  return {
    convRate: toNum(r?.conv_rate),
    aov: toNum(r?.aov),
    shippingRev: toNum(r?.shipping_rev),
    attempts: toNum(r?.attempts),
  };
}

export async function kpis(input: KpisInput): Promise<KpisOutput> {
  console.log("[PRD-1:lib/kpis] start", input);

  const { shopId, start, end, country, device, discountUsage } = input;
  const rangeMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(start.getTime() - rangeMs - 1);

  const [current, previous] = await Promise.all([
    kpisForPeriod(shopId, start, end, country, device, discountUsage),
    kpisForPeriod(shopId, prevStart, prevEnd, country, device, discountUsage),
  ]);

  console.log("[PRD-1:lib/kpis] done", { current, previous });
  return { current, previous };
}

export const getKpis = unstable_cache(
  kpis,
  ["kpis"],
  {
    revalidate: 3600,
    tags: ["analytics"],
  }
);
