import { unstable_cache } from "next/cache";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type FunnelInput = {
  shopId: string;
  start: Date;
  end: Date;
  country?: string;
  device?: "mobile" | "tablet" | "desktop";
  discountUsage?: "used" | "failed" | "none";
};

export type FunnelStep = {
  key: "started" | "contact" | "shipping" | "payment" | "completed";
  label: string;
  sessions: number;
  conversionFromPrev: number; // 0..1
  conversionFromStart: number; // 0..1
};

type RawFunnelRow = {
  s1: string | number | bigint;
  s2: string | number | bigint;
  s3: string | number | bigint;
  s4: string | number | bigint;
  s5: string | number | bigint;
};

function toNum(v: string | number | bigint | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

export async function checkoutFunnel(input: FunnelInput): Promise<FunnelStep[]> {
  console.log("[PRD-1:lib/checkoutFunnel] start", input);

  const { shopId, start, end, country, device, discountUsage } = input;

  // Dynamic filter clauses appended to the CTE WHERE
  const whereParts: Prisma.Sql[] = [
    Prisma.sql`"shopId" = ${shopId}`,
    Prisma.sql`"occurredAt" BETWEEN ${start} AND ${end}`,
  ];

  if (country) {
    whereParts.push(Prisma.sql`"country" = ${country}`);
  }
  if (device) {
    whereParts.push(Prisma.sql`"deviceType" = ${device}`);
  }

  // discountUsage filter uses CartEvent sub-select
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

  const rows = await prisma.$queryRaw<RawFunnelRow[]>`
    WITH ranked AS (
      SELECT
        "sessionId",
        MAX(CASE
          WHEN "eventType" = 'checkout_completed'              THEN 5
          WHEN "eventType" = 'payment_info_submitted'          THEN 4
          WHEN "eventType" = 'checkout_shipping_info_submitted' THEN 3
          WHEN "eventType" = 'checkout_contact_info_submitted'  THEN 2
          WHEN "eventType" = 'checkout_started'                THEN 1
          ELSE 0
        END) AS deepest
      FROM "CheckoutEvent"
      WHERE ${whereClause}
      GROUP BY "sessionId"
    )
    SELECT
      COUNT(*) FILTER (WHERE deepest >= 1) AS s1,
      COUNT(*) FILTER (WHERE deepest >= 2) AS s2,
      COUNT(*) FILTER (WHERE deepest >= 3) AS s3,
      COUNT(*) FILTER (WHERE deepest >= 4) AS s4,
      COUNT(*) FILTER (WHERE deepest >= 5) AS s5
    FROM ranked;
  `;

  const row = rows[0];
  const s1 = toNum(row?.s1);
  const s2 = toNum(row?.s2);
  const s3 = toNum(row?.s3);
  const s4 = toNum(row?.s4);
  const s5 = toNum(row?.s5);

  const steps: FunnelStep[] = [
    {
      key: "started",
      label: "Checkout started",
      sessions: s1,
      conversionFromPrev: 1,
      conversionFromStart: 1,
    },
    {
      key: "contact",
      label: "Contact submitted",
      sessions: s2,
      conversionFromPrev: s1 > 0 ? s2 / s1 : 0,
      conversionFromStart: s1 > 0 ? s2 / s1 : 0,
    },
    {
      key: "shipping",
      label: "Shipping submitted",
      sessions: s3,
      conversionFromPrev: s2 > 0 ? s3 / s2 : 0,
      conversionFromStart: s1 > 0 ? s3 / s1 : 0,
    },
    {
      key: "payment",
      label: "Payment submitted",
      sessions: s4,
      conversionFromPrev: s3 > 0 ? s4 / s3 : 0,
      conversionFromStart: s1 > 0 ? s4 / s1 : 0,
    },
    {
      key: "completed",
      label: "Completed",
      sessions: s5,
      conversionFromPrev: s4 > 0 ? s5 / s4 : 0,
      conversionFromStart: s1 > 0 ? s5 / s1 : 0,
    },
  ];

  console.log("[PRD-1:lib/checkoutFunnel] done", steps.map((s) => `${s.key}=${s.sessions}`).join(" "));
  return steps;
}

export const getCheckoutFunnel = unstable_cache(
  checkoutFunnel,
  ["checkoutFunnel"],
  {
    revalidate: 3600,
    tags: ["analytics"],
  }
);
