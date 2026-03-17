-- CouponMaxx analytics SQL functions
-- Run this in Supabase SQL editor before using the analytics/sessions API.
-- All functions aggregate in Postgres and return small result sets —
-- never expose raw CartEvent rows that would hit the PostgREST 1000-row cap.

-- ============================================================
-- 1. DAILY CART METRICS
--    One row per UTC day. All cart-event aggregations in one query.
--    p_session_ids: optional allow-list for UTM/product filtering.
-- ============================================================
CREATE OR REPLACE FUNCTION couponmaxx_daily_cart_metrics(
  p_shop_id     text,
  p_start       timestamptz,
  p_end         timestamptz,
  p_device      text    DEFAULT NULL,
  p_session_ids text[]  DEFAULT NULL
)
RETURNS TABLE (
  day                       date,
  total_sessions            bigint,
  sessions_with_products    bigint,
  sessions_with_coupon      bigint,
  sessions_coupon_applied   bigint,
  sessions_coupon_attempted bigint,
  sessions_coupon_failed    bigint,
  checkout_clicked_sessions bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    "occurredAt"::date AS day,
    COUNT(DISTINCT "sessionId")                                                    AS total_sessions,
    COUNT(DISTINCT CASE WHEN ("cartItemCount" > 0 OR "cartValue" > 0)
                        THEN "sessionId" END)                                      AS sessions_with_products,
    COUNT(DISTINCT CASE WHEN "eventType" IN (
                          'cart_coupon_applied','cart_coupon_failed','cart_coupon_recovered')
                        THEN "sessionId" END)                                      AS sessions_with_coupon,
    COUNT(DISTINCT CASE WHEN "eventType" = 'cart_coupon_applied'
                          OR "couponRecovered" = true
                        THEN "sessionId" END)                                      AS sessions_coupon_applied,
    COUNT(DISTINCT CASE WHEN "eventType" IN (
                          'cart_coupon_applied','cart_coupon_failed','cart_coupon_recovered')
                        THEN "sessionId" END)                                      AS sessions_coupon_attempted,
    COUNT(DISTINCT CASE WHEN "eventType" = 'cart_coupon_failed'
                          AND NOT COALESCE("couponRecovered", false)
                        THEN "sessionId" END)                                      AS sessions_coupon_failed,
    COUNT(DISTINCT CASE WHEN "eventType" = 'cart_checkout_clicked'
                        THEN "sessionId" END)                                      AS checkout_clicked_sessions
  FROM "CartEvent"
  WHERE "shopId"     = p_shop_id
    AND "occurredAt" >= p_start
    AND "occurredAt" <= p_end
    AND (p_device      IS NULL OR p_device      = '' OR "device"    = p_device)
    AND (p_session_ids IS NULL                       OR "sessionId" = ANY(p_session_ids))
  GROUP BY "occurredAt"::date
  ORDER BY day ASC;
$$;

-- ============================================================
-- 2. DAILY CHECKOUT SESSIONS (from CheckoutEvent table)
-- ============================================================
CREATE OR REPLACE FUNCTION couponmaxx_daily_checkout_sessions(
  p_shop_id text,
  p_start   timestamptz,
  p_end     timestamptz
)
RETURNS TABLE (
  day               date,
  checkout_sessions bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    "occurredAt"::date           AS day,
    COUNT(DISTINCT "sessionId")  AS checkout_sessions
  FROM "CheckoutEvent"
  WHERE "shopId"     = p_shop_id
    AND "occurredAt" >= p_start
    AND "occurredAt" <= p_end
    AND "eventType" IN ('checkout_started','checkout_completed')
  GROUP BY "occurredAt"::date
  ORDER BY day ASC;
$$;

-- ============================================================
-- 3. ATTRIBUTED SALES — daily
--    Sessions with a coupon that completed checkout within the attribution window.
--    p_price_type: 'pre' = last cart value (cents→dollars), 'post' = totalPrice
-- ============================================================
CREATE OR REPLACE FUNCTION couponmaxx_attributed_sales_daily(
  p_shop_id          text,
  p_start            timestamptz,
  p_end              timestamptz,
  p_attr_window_days int     DEFAULT 14,
  p_price_type       text    DEFAULT 'pre',
  p_session_ids      text[]  DEFAULT NULL
)
RETURNS TABLE (
  day              date,
  attributed_value numeric,
  attributed_total numeric  -- cumulative (same as SUM over all days, repeated for convenience)
)
LANGUAGE sql STABLE AS $$
  WITH coupon_sessions AS (
    SELECT DISTINCT "sessionId"
    FROM "CartEvent"
    WHERE "shopId"     = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND ("eventType" = 'cart_coupon_applied' OR "couponRecovered" = true)
      AND (p_session_ids IS NULL OR "sessionId" = ANY(p_session_ids))
  ),
  first_cart AS (
    SELECT "sessionId", MIN("occurredAt") AS first_time
    FROM "CartEvent"
    WHERE "shopId"     = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
    GROUP BY "sessionId"
  ),
  last_value AS (
    SELECT DISTINCT ON ("sessionId") "sessionId", "cartValue"
    FROM "CartEvent"
    WHERE "shopId"     = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND "cartValue"  > 0
    ORDER BY "sessionId", "occurredAt" DESC
  ),
  completed AS (
    SELECT
      ce."sessionId",
      ce."occurredAt",
      ce."totalPrice",
      lv."cartValue"
    FROM "CheckoutEvent" ce
    JOIN coupon_sessions cs ON ce."sessionId" = cs."sessionId"
    JOIN first_cart       fc ON ce."sessionId" = fc."sessionId"
    LEFT JOIN last_value  lv ON ce."sessionId" = lv."sessionId"
    WHERE ce."shopId"    = p_shop_id
      AND ce."eventType" = 'checkout_completed'
      AND EXTRACT(EPOCH FROM (ce."occurredAt" - fc.first_time)) / 86400.0 <= p_attr_window_days
  ),
  daily AS (
    SELECT
      "occurredAt"::date AS day,
      SUM(CASE WHEN p_price_type = 'post'
               THEN COALESCE("totalPrice", 0)
               ELSE COALESCE("cartValue", 0) / 100.0 END) AS attributed_value
    FROM completed
    GROUP BY "occurredAt"::date
  )
  SELECT
    day,
    attributed_value,
    SUM(attributed_value) OVER () AS attributed_total
  FROM daily
  ORDER BY day ASC;
$$;

-- ============================================================
-- 4. FUNNEL TOTALS — single aggregate row
-- ============================================================
CREATE OR REPLACE FUNCTION couponmaxx_funnel_totals(
  p_shop_id     text,
  p_start       timestamptz,
  p_end         timestamptz,
  p_device      text   DEFAULT NULL,
  p_session_ids text[] DEFAULT NULL
)
RETURNS TABLE (
  total_sessions         bigint,
  sessions_with_products bigint,
  sessions_with_coupon   bigint,
  coupon_applied         bigint,
  coupon_failed          bigint,
  reached_checkout       bigint
)
LANGUAGE sql STABLE AS $$
  WITH cart_agg AS (
    SELECT
      COUNT(DISTINCT "sessionId")                                               AS total_sessions,
      COUNT(DISTINCT CASE WHEN ("cartItemCount" > 0 OR "cartValue" > 0)
                          THEN "sessionId" END)                                 AS sessions_with_products,
      COUNT(DISTINCT CASE WHEN "eventType" IN (
                            'cart_coupon_applied','cart_coupon_failed','cart_coupon_recovered')
                          THEN "sessionId" END)                                 AS sessions_with_coupon,
      COUNT(DISTINCT CASE WHEN "eventType" = 'cart_coupon_applied'
                            OR "couponRecovered" = true
                          THEN "sessionId" END)                                 AS coupon_applied,
      COUNT(DISTINCT CASE WHEN "eventType" = 'cart_coupon_failed'
                            AND NOT COALESCE("couponRecovered", false)
                          THEN "sessionId" END)                                 AS coupon_failed,
      COUNT(DISTINCT CASE WHEN "eventType" = 'cart_checkout_clicked'
                          THEN "sessionId" END)                                 AS cart_clicked
    FROM "CartEvent"
    WHERE "shopId"     = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND (p_device      IS NULL OR p_device      = '' OR "device"    = p_device)
      AND (p_session_ids IS NULL                       OR "sessionId" = ANY(p_session_ids))
  ),
  checkout_agg AS (
    SELECT COUNT(DISTINCT "sessionId") AS checkout_sessions
    FROM "CheckoutEvent"
    WHERE "shopId"     = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND "eventType" IN ('checkout_started','checkout_completed')
  )
  SELECT
    ca.total_sessions,
    ca.sessions_with_products,
    ca.sessions_with_coupon,
    ca.coupon_applied,
    ca.coupon_failed,
    GREATEST(ca.cart_clicked, ck.checkout_sessions) AS reached_checkout
  FROM cart_agg ca, checkout_agg ck;
$$;

-- ============================================================
-- 5. UTM SESSION FILTER — returns session IDs matching a UTM source
--    Uses SessionPing table (which has shopDomain, not shopId)
-- ============================================================
CREATE OR REPLACE FUNCTION couponmaxx_utm_sessions(
  p_shop_domain text,
  p_start       timestamptz,
  p_end         timestamptz,
  p_utm_source  text
)
RETURNS TABLE (session_id text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT "sessionId"
  FROM "SessionPing"
  WHERE "shopDomain" = p_shop_domain
    AND "occurredAt" >= p_start
    AND "occurredAt" <= p_end
    AND CASE p_utm_source
          WHEN 'Direct'      THEN ("utmSource" IS NULL OR "utmSource" = '')
          WHEN 'Paid search' THEN "utmSource" IN ('google','bing')
          WHEN 'Social'      THEN "utmSource" IN ('instagram','facebook','fb','tiktok','tiktok_ads')
          WHEN 'Email'       THEN "utmSource" IN ('klaviyo','mailchimp','email')
          ELSE "utmSource" = p_utm_source
        END;
$$;

-- ============================================================
-- 6. SESSION KPI BOXES — aggregate counts for the sessions page header
-- ============================================================
CREATE OR REPLACE FUNCTION couponmaxx_session_kpis(
  p_shop_id text,
  p_start   timestamptz,
  p_end     timestamptz
)
RETURNS TABLE (
  carts_opened       bigint,
  with_products      bigint,
  with_coupon        bigint,
  reached_checkout   bigint,
  checkout_with_coupon   bigint,
  checkout_without_coupon bigint
)
LANGUAGE sql STABLE AS $$
  WITH cart_sess AS (
    SELECT
      "sessionId",
      BOOL_OR("cartItemCount" > 0 OR "cartValue" > 0)                           AS has_products,
      BOOL_OR("eventType" IN (
        'cart_coupon_applied','cart_coupon_failed','cart_coupon_recovered'))     AS has_coupon,
      BOOL_OR("eventType" = 'cart_checkout_clicked')                            AS cart_clicked
    FROM "CartEvent"
    WHERE "shopId"     = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
    GROUP BY "sessionId"
  ),
  checkout_sess AS (
    SELECT DISTINCT "sessionId"
    FROM "CheckoutEvent"
    WHERE "shopId"     = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND "eventType" IN ('checkout_started','checkout_completed')
  ),
  joined AS (
    SELECT
      cs."sessionId",
      cs.has_products,
      cs.has_coupon,
      (cs.cart_clicked OR ck."sessionId" IS NOT NULL) AS reached_checkout
    FROM cart_sess cs
    LEFT JOIN checkout_sess ck ON cs."sessionId" = ck."sessionId"
  )
  SELECT
    COUNT(*)                                                   AS carts_opened,
    COUNT(*) FILTER (WHERE has_products)                       AS with_products,
    COUNT(*) FILTER (WHERE has_coupon)                         AS with_coupon,
    COUNT(*) FILTER (WHERE reached_checkout)                   AS reached_checkout,
    COUNT(*) FILTER (WHERE reached_checkout AND has_coupon)    AS checkout_with_coupon,
    COUNT(*) FILTER (WHERE reached_checkout AND NOT has_coupon) AS checkout_without_coupon
  FROM joined;
$$;

-- ============================================================
-- 7. SESSION SUMMARIES — one row per session, all display/filter fields
--    Returns session-level aggregates so JS never needs to loop events.
--    Via RPC this is not subject to the PostgREST 1000-row cap.
-- ============================================================
CREATE OR REPLACE FUNCTION couponmaxx_session_summaries(
  p_shop_id text,
  p_start   timestamptz,
  p_end     timestamptz,
  p_device  text DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS TABLE (
  session_id              text,
  first_event             timestamptz,
  duration_ms             bigint,
  country                 text,
  device                  text,
  utm_source              text,
  utm_medium              text,
  utm_campaign            text,
  cart_value_start_cents  int,
  cart_value_end_cents    int,
  cart_item_count         int,
  has_products            bool,
  product_titles          text[],
  line_items              jsonb,
  coupon_events           jsonb,   -- [{code, eventType, recovered, discountAmount}]
  has_coupon              bool,
  has_applied             bool,
  has_failed              bool,
  has_recovered           bool,
  has_checkout_clicked    bool,
  has_ordered             bool,
  has_checkout_started    bool
)
LANGUAGE sql STABLE AS $$
  WITH cart_agg AS (
    SELECT
      "sessionId",
      MIN("occurredAt")                                                          AS first_event,
      EXTRACT(EPOCH FROM (MAX("occurredAt") - MIN("occurredAt"))) * 1000        AS duration_ms,
      (ARRAY_AGG("country"     ORDER BY "occurredAt" ASC)
         FILTER (WHERE "country"     IS NOT NULL))[1]                           AS country,
      (ARRAY_AGG("device"      ORDER BY "occurredAt" ASC)
         FILTER (WHERE "device"      IS NOT NULL))[1]                           AS device,
      (ARRAY_AGG("utmSource"   ORDER BY "occurredAt" ASC)
         FILTER (WHERE "utmSource"   IS NOT NULL))[1]                           AS utm_source,
      (ARRAY_AGG("utmMedium"   ORDER BY "occurredAt" ASC)
         FILTER (WHERE "utmMedium"   IS NOT NULL))[1]                           AS utm_medium,
      (ARRAY_AGG("utmCampaign" ORDER BY "occurredAt" ASC)
         FILTER (WHERE "utmCampaign" IS NOT NULL))[1]                           AS utm_campaign,
      (ARRAY_AGG("cartValue" ORDER BY "occurredAt" ASC)
         FILTER (WHERE "cartValue" > 0))[1]                                     AS cart_value_start,
      (ARRAY_AGG("cartValue" ORDER BY "occurredAt" DESC)
         FILTER (WHERE "cartValue" > 0))[1]                                     AS cart_value_end,
      MAX("cartItemCount")                                                       AS cart_item_count,
      BOOL_OR("cartItemCount" > 0 OR "cartValue" > 0)                          AS has_products,
      -- Last non-empty lineItems for product list
      (ARRAY_AGG("lineItems"::jsonb ORDER BY "occurredAt" DESC)
         FILTER (WHERE "lineItems" IS NOT NULL
                   AND jsonb_typeof("lineItems"::jsonb) = 'array'
                   AND jsonb_array_length("lineItems"::jsonb) > 0))[1]         AS line_items,
      -- Coupon events as JSON array for JS processing
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'code',           "couponCode",
            'eventType',      "eventType",
            'recovered',      COALESCE("couponRecovered", false),
            'discountAmount', "discountAmount"
          )
        ) FILTER (WHERE "couponCode" IS NOT NULL
                    AND "eventType" IN (
                      'cart_coupon_applied','cart_coupon_failed','cart_coupon_recovered')),
        '[]'::jsonb
      )                                                                          AS coupon_events,
      BOOL_OR("eventType" IN (
        'cart_coupon_applied','cart_coupon_failed','cart_coupon_recovered'))    AS has_coupon,
      BOOL_OR("eventType" = 'cart_coupon_applied' OR "couponRecovered" = true) AS has_applied,
      BOOL_OR("eventType" = 'cart_coupon_failed'
              AND NOT COALESCE("couponRecovered", false))                       AS has_failed,
      BOOL_OR("couponRecovered" = true)                                         AS has_recovered,
      BOOL_OR("eventType" = 'cart_checkout_clicked')                           AS has_checkout_clicked
    FROM "CartEvent"
    WHERE "shopId"     = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND (p_device  IS NULL OR p_device  = '' OR "device"            = p_device)
      AND (p_country IS NULL OR p_country = '' OR lower("country") LIKE lower('%' || p_country || '%'))
    GROUP BY "sessionId"
  ),
  checkout_agg AS (
    SELECT
      "sessionId",
      BOOL_OR("eventType" = 'checkout_completed') AS has_ordered,
      BOOL_OR("eventType" = 'checkout_started')   AS has_checkout_started
    FROM "CheckoutEvent"
    WHERE "shopId"     = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
    GROUP BY "sessionId"
  )
  SELECT
    ca."sessionId"                                                         AS session_id,
    ca.first_event,
    ca.duration_ms::bigint,
    ca.country,
    ca.device,
    ca.utm_source,
    ca.utm_medium,
    ca.utm_campaign,
    ca.cart_value_start                                                    AS cart_value_start_cents,
    ca.cart_value_end                                                      AS cart_value_end_cents,
    ca.cart_item_count,
    ca.has_products,
    -- Extract product titles from lineItems JSON
    ARRAY(
      SELECT DISTINCT item->>'productTitle'
      FROM jsonb_array_elements(COALESCE(ca.line_items, '[]'::jsonb)) AS item
      WHERE item->>'productTitle' IS NOT NULL
    )                                                                      AS product_titles,
    ca.line_items,
    ca.coupon_events,
    ca.has_coupon,
    ca.has_applied,
    ca.has_failed,
    ca.has_recovered,
    ca.has_checkout_clicked,
    COALESCE(ck.has_ordered,           false)                             AS has_ordered,
    COALESCE(ck.has_checkout_started,  false)                             AS has_checkout_started
  FROM cart_agg ca
  LEFT JOIN checkout_agg ck ON ca."sessionId" = ck."sessionId"
  ORDER BY ca.first_event DESC;
$$;
