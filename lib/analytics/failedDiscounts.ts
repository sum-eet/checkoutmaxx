import { unstable_cache } from "next/cache";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type FailedDiscountsInput = {
  shopId: string;
  start: Date;
  end: Date;
  limit?: number;
  offset?: number;
};

export type FailedDiscountRow = {
  code: string;
  attempts: number;
  uniqueSessions: number;
  lastSeen: string;
  sampleReason: string | null;
};

export type FailedDiscountsOutput = {
  rows: FailedDiscountRow[];
  total: number;
};

type RawRow = {
  code: string;
  attempts: string | bigint;
  unique_sessions: string | bigint;
  last_seen: string;
  sample_reason: string | null;
  total_count: string | bigint;
};

function toNum(v: string | bigint | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

export async function failedDiscounts(input: FailedDiscountsInput): Promise<FailedDiscountsOutput> {
  console.log("[PRD-1:lib/failedDiscounts] start", input);

  const { shopId, start, end, limit = 25, offset = 0 } = input;

  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      "couponCode"                                                          AS code,
      COUNT(*)                                                              AS attempts,
      COUNT(DISTINCT "sessionId")                                           AS unique_sessions,
      MAX("occurredAt")::text                                               AS last_seen,
      (ARRAY_AGG("couponFailReason" ORDER BY "occurredAt" DESC))[1]         AS sample_reason,
      COUNT(*) OVER ()                                                      AS total_count
    FROM "CartEvent"
    WHERE "shopId" = ${shopId}
      AND "eventType" = 'cart_coupon_failed'
      AND "occurredAt" BETWEEN ${start} AND ${end}
    GROUP BY "couponCode"
    ORDER BY attempts DESC
    LIMIT ${limit} OFFSET ${offset};
  `;

  const total = rows.length > 0 ? toNum(rows[0].total_count) : 0;

  const result: FailedDiscountRow[] = rows.map((r) => ({
    code: r.code,
    attempts: toNum(r.attempts),
    uniqueSessions: toNum(r.unique_sessions),
    lastSeen: r.last_seen,
    sampleReason: r.sample_reason ?? null,
  }));

  console.log("[PRD-1:lib/failedDiscounts] done rows=%d total=%d", result.length, total);
  return { rows: result, total };
}

export const getFailedDiscounts = unstable_cache(
  failedDiscounts,
  ["failedDiscounts"],
  {
    revalidate: 3600,
    tags: ["analytics"],
  }
);
