-- CouponMaxx Smart Recovery — database tables
-- Run in Supabase SQL editor

-- ── RecoveryEvent ────────────────────────────────────────────────────────────
-- Logs every recovery decision made for a coupon failure event.
-- recoveryUsed + revenueRecovered are backfilled when the generated code
-- is eventually used at checkout (via Web Pixel order_completed event).

CREATE TABLE IF NOT EXISTS "RecoveryEvent" (
  "id"                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "shopId"               TEXT        NOT NULL,
  "sessionId"            TEXT        NOT NULL,
  "failedCode"           TEXT        NOT NULL,
  "failureReason"        TEXT        NOT NULL,
  "recoveryAction"       TEXT        NOT NULL,  -- show_code | show_hint | show_upsell | show_nothing
  "recoveryCode"         TEXT,                  -- the generated code, if any
  "discountValue"        NUMERIC,
  "discountType"         TEXT,                  -- percentage | fixed
  "cartValueAtFailure"   INTEGER,               -- cents
  "recoveryUsed"         BOOLEAN     DEFAULT FALSE,
  "revenueRecovered"     INTEGER,               -- cents, filled when code is used at checkout
  "customerName"         TEXT,
  "attemptsThisSession"  INTEGER,
  "device"               TEXT,
  "createdAt"            TIMESTAMPTZ DEFAULT NOW(),
  "usedAt"               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_recovery_shop_date  ON "RecoveryEvent" ("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_recovery_session    ON "RecoveryEvent" ("sessionId");
CREATE INDEX IF NOT EXISTS idx_recovery_code       ON "RecoveryEvent" ("recoveryCode");

-- ── MerchantRecoverySettings ─────────────────────────────────────────────────
-- One row per shop. Created on first save or with defaults on first GET.

CREATE TABLE IF NOT EXISTS "MerchantRecoverySettings" (
  "shopId"              TEXT        PRIMARY KEY,
  "enabled"             BOOLEAN     DEFAULT TRUE,
  "rules"               JSONB       NOT NULL DEFAULT '{
    "expired":          { "enabled": false, "action": "offer_fallback_code", "discount": 10, "discountType": "percentage", "expiryMinutes": 15 },
    "min_not_met":      { "enabled": false, "action": "show_hint_and_suggest", "collections": "all" },
    "usage_limit":      { "enabled": false, "action": "explanation_only" },
    "wrong_collection": { "enabled": false, "action": "redirect_collection" },
    "invalid":          { "enabled": false, "action": "explanation_only" },
    "already_used":     { "enabled": false, "action": "explanation_only" }
  }'::jsonb,
  "hunterThreshold"     INTEGER     DEFAULT 3,
  "hunterAction"        TEXT        DEFAULT 'show_nothing',
  "highValueThreshold"  INTEGER     DEFAULT 20000,  -- cents ($200)
  "highValueBoost"      INTEGER     DEFAULT 5,       -- percentage points
  "useCustomerName"     BOOLEAN     DEFAULT TRUE,
  "useCartContents"     BOOLEAN     DEFAULT TRUE,
  "dailyCodeLimit"      INTEGER     DEFAULT 50,
  "updatedAt"           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Recovery analytics helper function ───────────────────────────────────────
-- Returns aggregated recovery stats for a shop over a date range.
-- Used by the dashboard API.

CREATE OR REPLACE FUNCTION get_recovery_stats(
  p_shop_id   TEXT,
  p_from      TIMESTAMPTZ,
  p_to        TIMESTAMPTZ
)
RETURNS TABLE (
  codes_offered      BIGINT,
  codes_used         BIGINT,
  revenue_recovered  BIGINT,
  top_trigger        TEXT,
  avg_revenue_per_use NUMERIC
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)                                                          AS codes_offered,
    COUNT(*) FILTER (WHERE "recoveryUsed" = TRUE)                    AS codes_used,
    COALESCE(SUM("revenueRecovered") FILTER (WHERE "recoveryUsed"),0)::BIGINT
                                                                      AS revenue_recovered,
    (
      SELECT "failureReason"
      FROM "RecoveryEvent"
      WHERE "shopId" = p_shop_id
        AND "createdAt" BETWEEN p_from AND p_to
      GROUP BY "failureReason"
      ORDER BY COUNT(*) DESC
      LIMIT 1
    )                                                                  AS top_trigger,
    CASE
      WHEN COUNT(*) FILTER (WHERE "recoveryUsed") = 0 THEN 0
      ELSE ROUND(
        COALESCE(SUM("revenueRecovered") FILTER (WHERE "recoveryUsed"), 0)::NUMERIC
        / COUNT(*) FILTER (WHERE "recoveryUsed"), 0
      )
    END                                                                AS avg_revenue_per_use
  FROM "RecoveryEvent"
  WHERE "shopId" = p_shop_id
    AND "createdAt" BETWEEN p_from AND p_to
    AND "recoveryAction" = 'show_code';
END;
$$;
