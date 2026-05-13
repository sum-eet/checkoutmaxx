/**
 * PRD-5 Dashboard aggregator.
 * Pulls KPIs, funnel, failed-discounts, drop-off heatmap, and recovered revenue
 * from existing PRD-1 query primitives plus new drop-off and sparkline queries.
 * Single Promise.all batch — every widget in one server call.
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { checkoutFunnel, type FunnelStep } from "./checkoutFunnel";
import { failedDiscounts, type FailedDiscountRow } from "./failedDiscounts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SparkPoint = { key: number; value: number };

export type DashboardKpis = {
  // Session count
  sessions: number;
  sessionsDelta: number | null;
  sessionsSpark: number[];

  // Conversion rate 0..1
  convRate: number;
  convDelta: number | null;
  convSpark: number[];

  // Average order value (cents or raw float from DB)
  aov: number;
  aovDelta: number | null;
  aovSpark: number[];

  // Recovered revenue (PRD-2 feature — 0 if not shipped yet)
  recoveredRevenue: number;
  recoveredDelta: number | null;
  recoveredSpark: number[];

  // Currency code from last completed checkout
  currency: string;
};

export type DropOffCell = number | null; // null = sparse (<10 sessions)

export type DropOffHeatmap = {
  [step: string]: {
    mobile: DropOffCell;
    tablet: DropOffCell;
    desktop: DropOffCell;
  };
};

export type DashboardPayload = {
  kpis: DashboardKpis;
  funnel: Array<{ key: string; sessions: number }>;
  failed: Array<Pick<FailedDiscountRow, "code" | "attempts" | "uniqueSessions" | "lastSeen">>;
  dropOff: DropOffHeatmap;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toNum(v: string | number | bigint | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Compute delta = (current - prev) / prev.
 * Returns null when both are 0.
 * Caps at +Infinity → represented as +1 (100%+) for UI.
 */
function computeDelta(current: number, prev: number): number | null {
  if (prev === 0 && current === 0) return null;
  if (prev === 0 && current > 0) return 1; // +100%+ (capped)
  if (prev > 0 && current === 0) return -1; // -100%
  return (current - prev) / prev;
}

// ---------------------------------------------------------------------------
// Sparkline query
// Returns daily buckets for the given period, filling gaps with 0.
// ---------------------------------------------------------------------------

type RawSparkRow = {
  bucket: string; // YYYY-MM-DD
  sessions: string | bigint;
  completions: string | bigint;
  total_price: string | number | null;
};

async function querySparklines(
  shopId: string,
  start: Date,
  end: Date,
  timezone: string
): Promise<RawSparkRow[]> {
  console.log("[PRD-5:dashboardAggregator] querySparklines start=%s end=%s tz=%s", start.toISOString(), end.toISOString(), timezone);

  const rows = await prisma.$queryRaw<RawSparkRow[]>`
    SELECT
      TO_CHAR(
        DATE_TRUNC('day', "occurredAt" AT TIME ZONE ${timezone}),
        'YYYY-MM-DD'
      ) AS bucket,
      COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_started' THEN "sessionId" END)  AS sessions,
      COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_completed' THEN "sessionId" END) AS completions,
      AVG("totalPrice") FILTER (WHERE "eventType" = 'checkout_completed')               AS total_price
    FROM "CheckoutEvent"
    WHERE "shopId" = ${shopId}
      AND "occurredAt" BETWEEN ${start} AND ${end}
    GROUP BY 1
    ORDER BY 1 ASC;
  `;

  console.log("[PRD-5:dashboardAggregator] querySparklines rows=%d", rows.length);
  return rows;
}

function buildSparkArrays(rows: RawSparkRow[]): {
  sessionsSpark: number[];
  convSpark: number[];
  aovSpark: number[];
} {
  const sessionsSpark = rows.map((r) => toNum(r.sessions));
  const convSpark = rows.map((r) => {
    const s = toNum(r.sessions);
    const c = toNum(r.completions);
    return s > 0 ? c / s : 0;
  });
  const aovSpark = rows.map((r) => toNum(r.total_price));
  return { sessionsSpark, convSpark, aovSpark };
}

// ---------------------------------------------------------------------------
// KPI totals query (current + previous period, no sparklines)
// ---------------------------------------------------------------------------

type RawKpiTotals = {
  sessions: string | bigint;
  completions: string | bigint;
  aov: string | number | null;
  currency: string | null;
};

async function queryKpiTotals(shopId: string, start: Date, end: Date): Promise<RawKpiTotals> {
  const rows = await prisma.$queryRaw<RawKpiTotals[]>`
    SELECT
      COUNT(DISTINCT "sessionId") FILTER (WHERE "eventType" = 'checkout_started')  AS sessions,
      COUNT(DISTINCT "sessionId") FILTER (WHERE "eventType" = 'checkout_completed') AS completions,
      AVG("totalPrice")           FILTER (WHERE "eventType" = 'checkout_completed') AS aov,
      (ARRAY_AGG("currency" ORDER BY "occurredAt" DESC) FILTER (WHERE "eventType" = 'checkout_completed'))[1] AS currency
    FROM "CheckoutEvent"
    WHERE "shopId" = ${shopId}
      AND "occurredAt" BETWEEN ${start} AND ${end};
  `;
  return rows[0] ?? { sessions: 0, completions: 0, aov: null, currency: null };
}

// ---------------------------------------------------------------------------
// Drop-off heatmap query
// ---------------------------------------------------------------------------

type RawHeatmapRow = {
  step: string;
  device: string;
  session_count: string | bigint;
  drop_count: string | bigint;
};

const FUNNEL_STEPS_MAP: Record<string, number> = {
  checkout_started: 1,
  checkout_contact_info_submitted: 2,
  checkout_shipping_info_submitted: 3,
  payment_info_submitted: 4,
  checkout_completed: 5,
};

const STEP_KEYS = [
  "checkout_started",
  "checkout_contact_info_submitted",
  "checkout_shipping_info_submitted",
  "payment_info_submitted",
  "checkout_completed",
];

async function queryDropOffHeatmap(
  shopId: string,
  start: Date,
  end: Date
): Promise<RawHeatmapRow[]> {
  console.log("[PRD-5:dashboardAggregator] queryDropOffHeatmap start=%s end=%s", start.toISOString(), end.toISOString());

  // For each (step, device) pair:
  // session_count = sessions that reached this step
  // drop_count = sessions that reached this step but NOT the next step
  const rows = await prisma.$queryRaw<RawHeatmapRow[]>`
    WITH session_depths AS (
      SELECT
        "sessionId",
        LOWER(COALESCE("deviceType", 'unknown')) AS device,
        MAX(
          CASE "eventType"
            WHEN 'checkout_completed'               THEN 5
            WHEN 'payment_info_submitted'           THEN 4
            WHEN 'checkout_shipping_info_submitted' THEN 3
            WHEN 'checkout_contact_info_submitted'  THEN 2
            WHEN 'checkout_started'                 THEN 1
            ELSE 0
          END
        ) AS deepest
      FROM "CheckoutEvent"
      WHERE "shopId" = ${shopId}
        AND "occurredAt" BETWEEN ${start} AND ${end}
      GROUP BY "sessionId", device
    ),
    step_series(step_name, step_num) AS (
      VALUES
        ('checkout_started',                1),
        ('checkout_contact_info_submitted', 2),
        ('checkout_shipping_info_submitted',3),
        ('payment_info_submitted',          4),
        ('checkout_completed',              5)
    ),
    device_list(device) AS (
      VALUES ('mobile'), ('tablet'), ('desktop')
    )
    SELECT
      s.step_name                                                        AS step,
      d.device                                                           AS device,
      COUNT(sd."sessionId") FILTER (WHERE sd.deepest >= s.step_num
        AND sd.device = d.device)                                        AS session_count,
      COUNT(sd."sessionId") FILTER (WHERE sd.deepest = s.step_num
        AND sd.device = d.device)                                        AS drop_count
    FROM step_series s
    CROSS JOIN device_list d
    LEFT JOIN session_depths sd ON TRUE
    GROUP BY s.step_name, s.step_num, d.device
    ORDER BY s.step_num, d.device;
  `;

  console.log("[PRD-5:dashboardAggregator] queryDropOffHeatmap rows=%d", rows.length);
  return rows;
}

const SPARSE_THRESHOLD = 10;

function buildDropOffHeatmap(rows: RawHeatmapRow[]): DropOffHeatmap {
  const heatmap: DropOffHeatmap = {};
  for (const key of STEP_KEYS) {
    heatmap[key] = { mobile: null, tablet: null, desktop: null };
  }

  for (const row of rows) {
    const stepKey = row.step;
    if (!heatmap[stepKey]) continue;
    const device = row.device as "mobile" | "tablet" | "desktop";
    if (!["mobile", "tablet", "desktop"].includes(device)) continue;

    const sessionCount = toNum(row.session_count);
    const dropCount = toNum(row.drop_count);

    if (sessionCount < SPARSE_THRESHOLD) {
      heatmap[stepKey][device] = null; // sparse → show "—"
    } else {
      heatmap[stepKey][device] = sessionCount > 0 ? dropCount / sessionCount : 0;
    }
  }

  return heatmap;
}

// ---------------------------------------------------------------------------
// Recovered revenue query
// TODO(PRD-2-merge): unconditional read once RecoveryIssue ships
// ---------------------------------------------------------------------------

async function queryRecoveredRevenue(shopId: string, start: Date, end: Date): Promise<number> {
  try {
    // Feature-detect: prisma.recoveryIssue may not exist if PRD-2 hasn't merged
    const p = prisma as any;
    if (!p.recoveryIssue) {
      console.log("[PRD-5:dashboardAggregator] RecoveryIssue model not available — PRD-2 not merged yet");
      return 0;
    }

    const rows = await prisma.$queryRaw<Array<{ total: string | number | null }>>`
      SELECT SUM("redeemedTotal") AS total
      FROM "RecoveryIssue"
      WHERE "shopId" = ${shopId}
        AND "redeemedAt" BETWEEN ${start} AND ${end};
    `;
    return toNum(rows[0]?.total);
  } catch (err: any) {
    // Table doesn't exist yet — safe to swallow
    console.log("[PRD-5:dashboardAggregator] recoveredRevenue query skipped (table not ready):", err.message);
    return 0;
  }
}

async function queryRecoveredSpark(shopId: string, start: Date, end: Date, timezone: string): Promise<number[]> {
  try {
    const p = prisma as any;
    if (!p.recoveryIssue) return [];

    const rows = await prisma.$queryRaw<Array<{ total: string | number | null }>>`
      SELECT SUM("redeemedTotal") AS total
      FROM "RecoveryIssue"
      WHERE "shopId" = ${shopId}
        AND "redeemedAt" BETWEEN ${start} AND ${end}
      GROUP BY DATE_TRUNC('day', "redeemedAt" AT TIME ZONE ${timezone})
      ORDER BY 1 ASC;
    `;
    return rows.map((r) => toNum(r.total));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main aggregator
// ---------------------------------------------------------------------------

export async function dashboardAggregator(
  shopId: string,
  start: Date,
  end: Date,
  timezone: string = "UTC"
): Promise<DashboardPayload> {
  console.log("[PRD-5:dashboardAggregator] start shopId=%s start=%s end=%s tz=%s", shopId, start.toISOString(), end.toISOString(), timezone);

  // Previous period: same length immediately before start
  const rangeMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(start.getTime() - rangeMs - 1);

  // Run all queries in parallel
  const [
    currentTotals,
    previousTotals,
    currentSpark,
    previousSpark,
    funnelSteps,
    failedResult,
    dropOffRows,
    currentRecovered,
    previousRecovered,
    currentRecoveredSpark,
  ] = await Promise.all([
    queryKpiTotals(shopId, start, end),
    queryKpiTotals(shopId, prevStart, prevEnd),
    querySparklines(shopId, start, end, timezone),
    querySparklines(shopId, prevStart, prevEnd, timezone),
    checkoutFunnel({ shopId, start, end }),
    failedDiscounts({ shopId, start, end, limit: 10 }),
    queryDropOffHeatmap(shopId, start, end),
    queryRecoveredRevenue(shopId, start, end),
    queryRecoveredRevenue(shopId, prevStart, prevEnd),
    queryRecoveredSpark(shopId, start, end, timezone),
  ]);

  // KPI totals
  const curSessions = toNum(currentTotals.sessions);
  const curCompletions = toNum(currentTotals.completions);
  const curAov = toNum(currentTotals.aov);
  const curConvRate = curSessions > 0 ? curCompletions / curSessions : 0;

  const prevSessions = toNum(previousTotals.sessions);
  const prevCompletions = toNum(previousTotals.sessions); // sessions for conv calc
  const prevAov = toNum(previousTotals.aov);
  const prevConvRate =
    toNum(previousTotals.sessions) > 0
      ? toNum(previousTotals.completions) / toNum(previousTotals.sessions)
      : 0;

  // Sparklines
  const sparks = buildSparkArrays(currentSpark);

  // Heatmap
  const dropOff = buildDropOffHeatmap(dropOffRows);

  const kpis: DashboardKpis = {
    sessions: curSessions,
    sessionsDelta: computeDelta(curSessions, prevSessions),
    sessionsSpark: sparks.sessionsSpark,

    convRate: curConvRate,
    convDelta: computeDelta(curConvRate, prevConvRate),
    convSpark: sparks.convSpark,

    aov: curAov,
    aovDelta: computeDelta(curAov, prevAov),
    aovSpark: sparks.aovSpark,

    recoveredRevenue: currentRecovered,
    recoveredDelta: computeDelta(currentRecovered, previousRecovered),
    recoveredSpark: currentRecoveredSpark,

    currency: currentTotals.currency ?? "USD",
  };

  const funnel = funnelSteps.map((s: FunnelStep) => ({
    key: s.key,
    sessions: s.sessions,
  }));

  const failed = failedResult.rows.slice(0, 10).map((r) => ({
    code: r.code,
    attempts: r.attempts,
    uniqueSessions: r.uniqueSessions,
    lastSeen: r.lastSeen,
  }));

  console.log("[PRD-5:dashboardAggregator] done sessions=%d convRate=%.3f aov=%.2f recovered=%.2f", curSessions, curConvRate, curAov, currentRecovered);

  return { kpis, funnel, failed, dropOff };
}
