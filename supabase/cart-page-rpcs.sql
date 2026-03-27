-- Cart Page RPCs — CouponMaxx
-- Run these in the Supabase SQL Editor in order.
-- Test each one with Dr.Water's shop ID before deploying the frontend.
--
-- Verification queries (run first to confirm which events exist where):
--   SELECT "eventType", COUNT(*) FROM "CartEvent"     WHERE "shopId" = '<shop_id>' GROUP BY 1 ORDER BY 2 DESC;
--   SELECT "eventType", COUNT(*) FROM "CheckoutEvent" WHERE "shopId" = '<shop_id>' GROUP BY 1 ORDER BY 2 DESC;


-- ─────────────────────────────────────────────────────────────
-- 1. cart_funnel_with_prior
--    Section 1: funnel for selected range vs prior period of
--    equal length. Date picker controls both periods.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cart_funnel_with_prior(
  p_shop_id text,
  p_start   timestamptz,
  p_end     timestamptz
)
RETURNS TABLE(
  period             text,
  sessions           bigint,
  added_to_cart      bigint,
  started_checkout   bigint,
  completed_checkout bigint
)
LANGUAGE sql STABLE AS $$
  WITH
  prior_start AS (
    SELECT p_start - (p_end - p_start) AS ts
  ),
  current_combined AS (
    SELECT "sessionId", "eventType"
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id AND "occurredAt" >= p_start AND "occurredAt" <= p_end
    UNION ALL
    SELECT "sessionId", "eventType"
    FROM "CheckoutEvent"
    WHERE "shopId" = p_shop_id AND "occurredAt" >= p_start AND "occurredAt" <= p_end
  ),
  prior_combined AS (
    SELECT "sessionId", "eventType"
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= (SELECT ts FROM prior_start)
      AND "occurredAt" <  p_start
    UNION ALL
    SELECT "sessionId", "eventType"
    FROM "CheckoutEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= (SELECT ts FROM prior_start)
      AND "occurredAt" <  p_start
  )
  SELECT 'current'::text,
    COUNT(DISTINCT CASE WHEN "eventType" IN ('page_viewed','product_viewed') THEN "sessionId" END),
    COUNT(DISTINCT CASE WHEN "eventType" = 'cart_item_added'       THEN "sessionId" END),
    COUNT(DISTINCT CASE WHEN "eventType" = 'cart_checkout_clicked' THEN "sessionId" END),
    COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_completed'    THEN "sessionId" END)
  FROM current_combined
  UNION ALL
  SELECT 'prior'::text,
    COUNT(DISTINCT CASE WHEN "eventType" IN ('page_viewed','product_viewed') THEN "sessionId" END),
    COUNT(DISTINCT CASE WHEN "eventType" = 'cart_item_added'       THEN "sessionId" END),
    COUNT(DISTINCT CASE WHEN "eventType" = 'cart_checkout_clicked' THEN "sessionId" END),
    COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_completed'    THEN "sessionId" END)
  FROM prior_combined;
$$;


-- ─────────────────────────────────────────────────────────────
-- 2. cart_funnel_by_source_with_prior
--    Section 1: UTM source breakdown for selected range vs prior
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cart_funnel_by_source_with_prior(
  p_shop_id text,
  p_start   timestamptz,
  p_end     timestamptz
)
RETURNS TABLE(
  source           text,
  medium           text,
  current_atc      bigint,
  current_checkout bigint,
  prior_atc        bigint,
  prior_checkout   bigint
)
LANGUAGE sql STABLE AS $$
  WITH
  prior_start AS (
    SELECT p_start - (p_end - p_start) AS ts
  ),
  current_sessions AS (
    SELECT
      "utmSource" AS src, "utmMedium" AS med, "sessionId",
      BOOL_OR("eventType" = 'cart_item_added')       AS had_atc,
      BOOL_OR("eventType" = 'cart_checkout_clicked') AS had_checkout
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start AND "occurredAt" <= p_end
      AND "utmSource" IS NOT NULL
    GROUP BY src, med, "sessionId"
  ),
  current_agg AS (
    SELECT src, med,
      COUNT(*) FILTER (WHERE had_atc)::bigint      AS current_atc,
      COUNT(*) FILTER (WHERE had_checkout)::bigint AS current_checkout
    FROM current_sessions GROUP BY src, med
  ),
  prior_sessions AS (
    SELECT
      "utmSource" AS src, "utmMedium" AS med, "sessionId",
      BOOL_OR("eventType" = 'cart_item_added')       AS had_atc,
      BOOL_OR("eventType" = 'cart_checkout_clicked') AS had_checkout
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= (SELECT ts FROM prior_start)
      AND "occurredAt" <  p_start
      AND "utmSource" IS NOT NULL
    GROUP BY src, med, "sessionId"
  ),
  prior_agg AS (
    SELECT src, med,
      COUNT(*) FILTER (WHERE had_atc)::bigint      AS prior_atc,
      COUNT(*) FILTER (WHERE had_checkout)::bigint AS prior_checkout
    FROM prior_sessions GROUP BY src, med
  )
  SELECT
    c.src                           AS source,
    c.med                           AS medium,
    c.current_atc,
    c.current_checkout,
    COALESCE(p.prior_atc, 0)        AS prior_atc,
    COALESCE(p.prior_checkout, 0)   AS prior_checkout
  FROM current_agg c
  LEFT JOIN prior_agg p ON c.src = p.src AND COALESCE(c.med,'') = COALESCE(p.med,'')
  ORDER BY c.current_atc DESC
  LIMIT 5;
$$;


-- ─────────────────────────────────────────────────────────────
-- 3. checkout_step_funnel
--    Section 2: checkout step drop-off (CheckoutEvent table)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION checkout_step_funnel(
  p_shop_id text,
  p_start   timestamptz,
  p_end     timestamptz
)
RETURNS TABLE(
  started  bigint,
  contact  bigint,
  address  bigint,
  shipping bigint,
  payment  bigint,
  completed bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_started'                   THEN "sessionId" END) AS started,
    COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_contact_info_submitted'    THEN "sessionId" END) AS contact,
    COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_address_info_submitted'    THEN "sessionId" END) AS address,
    COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_shipping_info_submitted'   THEN "sessionId" END) AS shipping,
    COUNT(DISTINCT CASE WHEN "eventType" = 'payment_info_submitted'             THEN "sessionId" END) AS payment,
    COUNT(DISTINCT CASE WHEN "eventType" = 'checkout_completed'                 THEN "sessionId" END) AS completed
  FROM "CheckoutEvent"
  WHERE "shopId" = p_shop_id
    AND "occurredAt" >= p_start AND "occurredAt" <= p_end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 4. cart_abandoned_last_event
--    Section 3: last ACTIVE event in abandoned sessions.
--    Passive events (cart_page_hidden, cart_viewed, cart_fetched)
--    are excluded — only meaningful cart actions are bucketed.
--    Sessions with no active events → 'browsed_cart_only'.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cart_abandoned_last_event(
  p_shop_id text,
  p_start   timestamptz,
  p_end     timestamptz
)
RETURNS TABLE(
  last_event    text,
  session_count bigint
)
LANGUAGE sql STABLE AS $$
  WITH abandoned AS (
    SELECT DISTINCT "sessionId"
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start AND "occurredAt" <= p_end
      AND "eventType" = 'cart_item_added'
    EXCEPT
    SELECT DISTINCT "sessionId"
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start AND "occurredAt" <= p_end
      AND "eventType" = 'cart_checkout_clicked'
  ),
  returned_from_checkout AS (
    SELECT DISTINCT ce1."sessionId"
    FROM "CartEvent" ce1
    WHERE ce1."shopId" = p_shop_id
      AND ce1."eventType" = 'cart_checkout_clicked'
      AND EXISTS (
        SELECT 1 FROM "CartEvent" ce2
        WHERE ce2."sessionId" = ce1."sessionId"
          AND ce2."occurredAt" > ce1."occurredAt"
          AND ce2."eventType" IN ('cart_item_added', 'cart_item_removed', 'cart_item_changed', 'cart_coupon_applied', 'cart_coupon_failed')
      )
      AND ce1."sessionId" NOT IN (
        SELECT "sessionId" FROM "CartEvent"
        WHERE "shopId" = p_shop_id AND "eventType" = 'checkout_completed'
        UNION
        SELECT "sessionId" FROM "CheckoutEvent"
        WHERE "shopId" = p_shop_id AND "eventType" = 'checkout_completed'
      )
  ),
  -- Only look at active (meaningful) cart events — exclude passive page events
  last_active_events AS (
    SELECT DISTINCT ON ("sessionId")
      "sessionId",
      "eventType"
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start AND "occurredAt" <= p_end
      AND "sessionId" IN (SELECT "sessionId" FROM abandoned)
      AND "eventType" IN (
        'cart_item_added', 'cart_item_removed', 'cart_item_changed',
        'cart_coupon_applied', 'cart_coupon_failed', 'cart_bulk_updated',
        'cart_atc_clicked', 'cart_checkout_clicked'
      )
    ORDER BY "sessionId", "occurredAt" DESC
  ),
  -- All abandoned sessions, with NULL for those that had no active events
  all_abandoned AS (
    SELECT
      a."sessionId",
      COALESCE(le."eventType", 'browsed_cart_only') AS "eventType"
    FROM (SELECT "sessionId" FROM abandoned) a
    LEFT JOIN last_active_events le ON a."sessionId" = le."sessionId"
  )
  SELECT
    CASE
      WHEN s."sessionId" IN (SELECT "sessionId" FROM returned_from_checkout) THEN 'returned_from_checkout'
      ELSE s."eventType"
    END AS last_event,
    COUNT(*) AS session_count
  FROM all_abandoned s
  GROUP BY 1
  ORDER BY session_count DESC;
$$;


-- ─────────────────────────────────────────────────────────────
-- 5. checkout_timing_distribution
--    Section 4: time buckets for completed vs abandoned checkout
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION checkout_timing_distribution(
  p_shop_id text,
  p_start   timestamptz,
  p_end     timestamptz
)
RETURNS TABLE(
  type   text,
  bucket text,
  count  bigint
)
LANGUAGE sql STABLE AS $$
  WITH combined AS (
    SELECT "sessionId", "eventType", "occurredAt"
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id AND "occurredAt" >= p_start AND "occurredAt" <= p_end
    UNION ALL
    SELECT "sessionId", "eventType", "occurredAt"
    FROM "CheckoutEvent"
    WHERE "shopId" = p_shop_id AND "occurredAt" >= p_start AND "occurredAt" <= p_end
  ),
  completed AS (
    SELECT
      "sessionId",
      MIN(CASE WHEN "eventType" IN ('cart_checkout_clicked', 'checkout_started') THEN "occurredAt" END) AS start_time,
      MIN(CASE WHEN "eventType" = 'checkout_completed'                           THEN "occurredAt" END) AS end_time
    FROM combined
    WHERE "eventType" IN ('cart_checkout_clicked', 'checkout_started', 'checkout_completed')
    GROUP BY "sessionId"
    HAVING MIN(CASE WHEN "eventType" = 'checkout_completed' THEN "occurredAt" END) IS NOT NULL
  ),
  abandoned AS (
    SELECT
      c."sessionId",
      MIN(CASE WHEN c."eventType" IN ('cart_checkout_clicked', 'checkout_started') THEN c."occurredAt" END) AS start_time,
      MAX(c."occurredAt") AS last_event_time
    FROM combined c
    WHERE c."sessionId" IN (
      SELECT DISTINCT "sessionId" FROM "CartEvent"
      WHERE "shopId" = p_shop_id AND "eventType" = 'cart_checkout_clicked'
      EXCEPT
      SELECT DISTINCT "sessionId" FROM "CheckoutEvent"
      WHERE "shopId" = p_shop_id AND "eventType" = 'checkout_completed'
    )
    GROUP BY c."sessionId"
  )
  SELECT 'completed'::text AS type,
    CASE
      WHEN EXTRACT(EPOCH FROM (end_time - start_time)) < 60   THEN 'under_1_min'
      WHEN EXTRACT(EPOCH FROM (end_time - start_time)) < 180  THEN '1_3_min'
      WHEN EXTRACT(EPOCH FROM (end_time - start_time)) < 300  THEN '3_5_min'
      WHEN EXTRACT(EPOCH FROM (end_time - start_time)) < 600  THEN '5_10_min'
      ELSE '10_plus_min'
    END AS bucket,
    COUNT(*) AS count
  FROM completed
  WHERE start_time IS NOT NULL AND end_time IS NOT NULL
  GROUP BY 1, 2

  UNION ALL

  SELECT 'abandoned'::text AS type,
    CASE
      WHEN EXTRACT(EPOCH FROM (last_event_time - start_time)) < 60   THEN 'under_1_min'
      WHEN EXTRACT(EPOCH FROM (last_event_time - start_time)) < 180  THEN '1_3_min'
      WHEN EXTRACT(EPOCH FROM (last_event_time - start_time)) < 300  THEN '3_5_min'
      WHEN EXTRACT(EPOCH FROM (last_event_time - start_time)) < 600  THEN '5_10_min'
      ELSE '10_plus_min'
    END AS bucket,
    COUNT(*) AS count
  FROM abandoned
  WHERE start_time IS NOT NULL
  GROUP BY 1, 2;
$$;


-- ─────────────────────────────────────────────────────────────
-- 6. cart_converter_comparison
--    Section 5: converters vs non-converters.
--    Uses MEDIAN (not avg) for time in cart.
--    Session duration capped at 30 minutes to suppress outliers.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cart_converter_comparison(
  p_shop_id text,
  p_start   timestamptz,
  p_end     timestamptz
)
RETURNS TABLE(
  converted              boolean,
  session_count          bigint,
  avg_time_seconds       numeric,   -- actually median; name kept for API compatibility
  avg_items              numeric,
  avg_cart_value_dollars numeric,
  coupon_usage_pct       numeric,
  coupon_failed_pct      numeric,
  removal_pct            numeric,
  paid_traffic_pct       numeric,
  mobile_pct             numeric
)
LANGUAGE sql STABLE AS $$
  WITH sessions AS (
    SELECT
      "sessionId",
      BOOL_OR("eventType" = 'cart_checkout_clicked')                                  AS converted,
      MAX("cartValue")                                                                 AS max_cart_value,
      COUNT(DISTINCT CASE WHEN "eventType" = 'cart_item_added' THEN "occurredAt" END) AS items_added,
      BOOL_OR("eventType" = 'cart_coupon_applied')                                    AS used_coupon,
      BOOL_OR("eventType" = 'cart_coupon_failed')                                     AS coupon_failed,
      BOOL_OR("eventType" = 'cart_item_removed')                                      AS had_removal,
      MAX("device")                                                                    AS device,
      MAX("utmSource")                                                                 AS utm_source,
      MIN("occurredAt")                                                                AS first_event,
      MAX("occurredAt")                                                                AS last_event,
      MAX(CASE WHEN "eventType" = 'cart_checkout_clicked' THEN "occurredAt" END)      AS checkout_time
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start AND "occurredAt" <= p_end
      AND "eventType" LIKE 'cart_%'
    GROUP BY "sessionId"
    HAVING BOOL_OR("eventType" = 'cart_item_added')
  )
  SELECT
    converted,
    COUNT(*)                                                                               AS session_count,
    -- Median time in cart, capped at 30 minutes per session
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY
      LEAST(
        EXTRACT(EPOCH FROM (COALESCE(checkout_time, last_event) - first_event)),
        1800
      )
    ))                                                                                     AS avg_time_seconds,
    ROUND(AVG(items_added), 1)                                                             AS avg_items,
    ROUND(AVG(max_cart_value) / 100.0, 2)                                                  AS avg_cart_value_dollars,
    ROUND(COUNT(*) FILTER (WHERE used_coupon)::numeric   / NULLIF(COUNT(*), 0) * 100, 1)  AS coupon_usage_pct,
    ROUND(COUNT(*) FILTER (WHERE coupon_failed)::numeric  / NULLIF(COUNT(*), 0) * 100, 1) AS coupon_failed_pct,
    ROUND(COUNT(*) FILTER (WHERE had_removal)::numeric    / NULLIF(COUNT(*), 0) * 100, 1) AS removal_pct,
    ROUND(COUNT(*) FILTER (WHERE utm_source IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS paid_traffic_pct,
    ROUND(COUNT(*) FILTER (WHERE device = 'mobile')::numeric      / NULLIF(COUNT(*), 0) * 100, 1) AS mobile_pct
  FROM sessions
  GROUP BY converted;
$$;
