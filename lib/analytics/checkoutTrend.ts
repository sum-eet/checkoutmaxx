import { unstable_cache } from "next/cache";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type TrendInput = {
  shopId: string;
  start: Date;
  end: Date;
  timezone: string;
  country?: string;
  device?: "mobile" | "tablet" | "desktop";
};

export type TrendBucket = {
  t: string;
  aov: number;
  shippingRev: number;
  convRate: number;
};

export type TrendOutput = {
  buckets: TrendBucket[];
};

type RawTrendRow = {
  t: string;
  aov: string | number | null;
  shipping_rev: string | number | null;
  completed: string | number | bigint;
  started: string | number | bigint;
};

function toNum(v: string | number | bigint | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

function bucketTrunc(diffDays: number): string {
  if (diffDays <= 2) return "hour";
  if (diffDays <= 90) return "day";
  return "week";
}

export async function checkoutTrend(input: TrendInput): Promise<TrendOutput> {
  console.log("[PRD-1:lib/checkoutTrend] start", input);

  const { shopId, start, end, timezone, country, device } = input;
  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  const trunc = bucketTrunc(diffDays);

  const whereParts: Prisma.Sql[] = [
    Prisma.sql`"shopId" = ${shopId}`,
    Prisma.sql`"occurredAt" BETWEEN ${start} AND ${end}`,
  ];
  if (country) whereParts.push(Prisma.sql`"country" = ${country}`);
  if (device) whereParts.push(Prisma.sql`"deviceType" = ${device}`);

  const whereClause = Prisma.join(whereParts, " AND ");
  const tz = timezone || "UTC";

  // Using a raw literal for the trunc value is safe — it comes from our own bucketTrunc(), not user input
  const truncSql =
    trunc === "hour"
      ? Prisma.sql`date_trunc('hour', "occurredAt" AT TIME ZONE ${tz})`
      : trunc === "day"
      ? Prisma.sql`date_trunc('day',  "occurredAt" AT TIME ZONE ${tz})`
      : Prisma.sql`date_trunc('week', "occurredAt" AT TIME ZONE ${tz})`;

  const rows = await prisma.$queryRaw<RawTrendRow[]>`
    SELECT
      ${truncSql}::text AS t,
      AVG("totalPrice")   FILTER (WHERE "eventType" = 'checkout_completed') AS aov,
      SUM("shippingPrice") FILTER (WHERE "eventType" = 'checkout_completed') AS shipping_rev,
      COUNT(DISTINCT "sessionId") FILTER (WHERE "eventType" = 'checkout_completed') AS completed,
      COUNT(DISTINCT "sessionId") FILTER (WHERE "eventType" = 'checkout_started')   AS started
    FROM "CheckoutEvent"
    WHERE ${whereClause}
    GROUP BY 1
    ORDER BY 1 ASC;
  `;

  const buckets: TrendBucket[] = rows.map((r) => ({
    t: r.t,
    aov: toNum(r.aov),
    shippingRev: toNum(r.shipping_rev),
    convRate: toNum(r.started) > 0 ? toNum(r.completed) / toNum(r.started) : 0,
  }));

  console.log("[PRD-1:lib/checkoutTrend] done buckets=%d trunc=%s", buckets.length, trunc);
  return { buckets };
}

export const getCheckoutTrend = unstable_cache(
  checkoutTrend,
  ["checkoutTrend"],
  {
    revalidate: 3600,
    tags: ["analytics"],
  }
);
