-- Cart Analytics Functions — CouponMaxx
-- Run in Supabase SQL editor before testing /api/couponmaxx/cart/* routes.
-- All functions use LANGUAGE sql STABLE and accept p_shop_id text.

-- ─────────────────────────────────────────────────────────────
-- 1. product_cart_conversion
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION product_cart_conversion(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  product_title text,
  added_to_cart bigint,
  checked_out_with bigint,
  cart_to_checkout_rate numeric,
  removed_from_cart bigint,
  remove_rate numeric,
  avg_cart_value_when_added numeric
)
LANGUAGE sql STABLE AS $$
  WITH added AS (
    SELECT
      item->>'productTitle' as product_title,
      COUNT(DISTINCT "sessionId") as added_count,
      AVG("cartValue") as avg_cart_value
    FROM "CartEvent",
    jsonb_array_elements("lineItems") as item
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND "eventType" = 'cart_item_added'
      AND "lineItems" IS NOT NULL
    GROUP BY item->>'productTitle'
  ),
  removed AS (
    SELECT
      item->>'productTitle' as product_title,
      COUNT(*) as removed_count
    FROM "CartEvent",
    jsonb_array_elements("lineItems") as item
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND "eventType" = 'cart_item_removed'
      AND "lineItems" IS NOT NULL
    GROUP BY item->>'productTitle'
  ),
  checked_out AS (
    SELECT
      item->>'productTitle' as product_title,
      COUNT(DISTINCT ce."sessionId") as checkout_count
    FROM "CartEvent" ce,
    jsonb_array_elements(ce."lineItems") as item
    WHERE ce."shopId" = p_shop_id
      AND ce."occurredAt" >= p_start
      AND ce."occurredAt" <= p_end
      AND ce."eventType" = 'cart_checkout_clicked'
      AND ce."lineItems" IS NOT NULL
    GROUP BY item->>'productTitle'
  )
  SELECT
    a.product_title,
    a.added_count,
    COALESCE(c.checkout_count, 0),
    CASE WHEN a.added_count = 0 THEN 0
    ELSE ROUND(COALESCE(c.checkout_count, 0)::numeric / a.added_count * 100, 1)
    END,
    COALESCE(r.removed_count, 0),
    CASE WHEN a.added_count = 0 THEN 0
    ELSE ROUND(COALESCE(r.removed_count, 0)::numeric / a.added_count * 100, 1)
    END,
    ROUND(COALESCE(a.avg_cart_value, 0) / 100, 2)
  FROM added a
  LEFT JOIN checked_out c ON a.product_title = c.product_title
  LEFT JOIN removed r ON a.product_title = r.product_title
  WHERE a.added_count >= 3
  ORDER BY a.added_count DESC
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. median_time_to_checkout
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION median_time_to_checkout(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz,
  p_device text DEFAULT NULL
)
RETURNS TABLE(median_ms bigint)
LANGUAGE sql STABLE AS $$
  WITH session_times AS (
    SELECT
      ce."sessionId",
      MIN(ce."occurredAt") as first_add,
      MAX(CASE WHEN ce."eventType" = 'cart_checkout_clicked'
          THEN ce."occurredAt" END) as checkout_click
    FROM "CartEvent" ce
    WHERE ce."shopId" = p_shop_id
      AND ce."occurredAt" >= p_start
      AND ce."occurredAt" <= p_end
      AND (p_device IS NULL OR ce.device = p_device)
    GROUP BY ce."sessionId"
    HAVING MAX(CASE WHEN ce."eventType" = 'cart_checkout_clicked'
               THEN 1 END) = 1
  )
  SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (checkout_click - first_add)) * 1000
    )::bigint
  FROM session_times
  WHERE checkout_click IS NOT NULL
    AND first_add IS NOT NULL
    AND checkout_click > first_add
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. cart_time_distribution
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cart_time_distribution(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(bucket text, sessions bigint)
LANGUAGE sql STABLE AS $$
  WITH buckets(bucket, min_s, max_s) AS (
    VALUES
      ('Under 1 min', 0,    60),
      ('1-3 min',     60,   180),
      ('3-5 min',     180,  300),
      ('5-10 min',    300,  600),
      ('10-30 min',   600,  1800),
      ('30 min+',     1800, 999999)
  ),
  session_times AS (
    SELECT
      "sessionId",
      EXTRACT(EPOCH FROM (
        MAX(CASE WHEN "eventType" = 'cart_checkout_clicked'
            THEN "occurredAt" END) -
        MIN("occurredAt")
      )) as seconds
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
    GROUP BY "sessionId"
    HAVING MAX(CASE WHEN "eventType" = 'cart_checkout_clicked'
               THEN 1 END) = 1
  )
  SELECT
    b.bucket,
    COUNT(s."sessionId")
  FROM buckets b
  LEFT JOIN session_times s
    ON s.seconds >= b.min_s AND s.seconds < b.max_s
    AND s.seconds IS NOT NULL AND s.seconds > 0
  GROUP BY b.bucket, b.min_s
  ORDER BY b.min_s
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. source_cart_conversion
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION source_cart_conversion(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  source text,
  utm_source text,
  utm_medium text,
  cart_sessions bigint,
  checked_out bigint,
  cart_to_checkout_rate numeric,
  avg_cart_value numeric,
  coupon_used_pct numeric
)
LANGUAGE sql STABLE AS $$
  WITH cart_sessions AS (
    SELECT DISTINCT
      ce."sessionId",
      COALESCE(sp."utmSource", '') as raw_source,
      COALESCE(sp."utmMedium", '') as raw_medium,
      COALESCE(sp."utmCampaign", '') as raw_campaign,
      MAX(ce."cartValue") OVER (PARTITION BY ce."sessionId") as max_cart_value,
      MAX(CASE WHEN ce."eventType" = 'cart_checkout_clicked' THEN 1 ELSE 0 END)
        OVER (PARTITION BY ce."sessionId") as did_checkout,
      MAX(CASE WHEN ce."eventType" LIKE 'cart_coupon%' THEN 1 ELSE 0 END)
        OVER (PARTITION BY ce."sessionId") as used_coupon
    FROM "CartEvent" ce
    LEFT JOIN "SessionPing" sp ON sp."sessionId" = ce."sessionId"
    WHERE ce."shopId" = p_shop_id
      AND ce."occurredAt" >= p_start
      AND ce."occurredAt" <= p_end
      AND (ce."cartValue" > 0 OR ce."cartItemCount" > 0)
  ),
  with_display AS (
    SELECT
      "sessionId",
      raw_source,
      raw_medium,
      raw_campaign,
      max_cart_value,
      did_checkout,
      used_coupon,
      CASE
        WHEN raw_source = '' OR raw_source IS NULL THEN 'Direct'
        WHEN raw_source IN ('google', 'bing') THEN 'Paid search · ' || NULLIF(raw_medium, '')
        WHEN raw_source IN ('instagram', 'facebook', 'tiktok') THEN 'Social · ' || raw_source
        WHEN raw_source IN ('klaviyo', 'email') THEN
          CASE WHEN raw_campaign != '' THEN 'Email · ' || raw_campaign ELSE 'Email · ' || raw_source END
        ELSE raw_source
      END as display_source
    FROM cart_sessions
  )
  SELECT
    display_source as source,
    NULLIF(raw_source, '') as utm_source,
    NULLIF(raw_medium, '') as utm_medium,
    COUNT(DISTINCT "sessionId") as cart_sessions,
    COUNT(DISTINCT CASE WHEN did_checkout = 1 THEN "sessionId" END) as checked_out,
    CASE WHEN COUNT(DISTINCT "sessionId") = 0 THEN 0
    ELSE ROUND(
      COUNT(DISTINCT CASE WHEN did_checkout = 1 THEN "sessionId" END)::numeric
      / COUNT(DISTINCT "sessionId") * 100, 1)
    END as cart_to_checkout_rate,
    ROUND(AVG(max_cart_value) / 100, 2) as avg_cart_value,
    CASE WHEN COUNT(DISTINCT "sessionId") = 0 THEN 0
    ELSE ROUND(
      COUNT(DISTINCT CASE WHEN used_coupon = 1 THEN "sessionId" END)::numeric
      / COUNT(DISTINCT "sessionId") * 100, 1)
    END as coupon_used_pct
  FROM with_display
  GROUP BY display_source, raw_source, raw_medium
  ORDER BY cart_sessions DESC
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. device_cart_metrics
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION device_cart_metrics(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz,
  p_device text
)
RETURNS TABLE(
  cart_sessions bigint,
  cart_to_checkout_rate numeric,
  median_time_to_checkout_ms bigint,
  avg_cart_value_at_checkout numeric,
  avg_items_in_cart numeric,
  coupon_attempt_rate numeric
)
LANGUAGE sql STABLE AS $$
  WITH sessions AS (
    SELECT
      ce."sessionId",
      MAX(CASE WHEN ce."eventType" = 'cart_checkout_clicked' THEN 1 ELSE 0 END) as did_checkout,
      MAX(CASE WHEN ce."eventType" = 'cart_checkout_clicked' THEN ce."cartValue" END) as checkout_cart_value,
      MAX(CASE WHEN ce."eventType" = 'cart_checkout_clicked' THEN ce."cartItemCount" END) as checkout_item_count,
      MAX(CASE WHEN ce."eventType" LIKE 'cart_coupon%' THEN 1 ELSE 0 END) as used_coupon,
      MIN(ce."occurredAt") as first_event,
      MAX(CASE WHEN ce."eventType" = 'cart_checkout_clicked' THEN ce."occurredAt" END) as checkout_time
    FROM "CartEvent" ce
    WHERE ce."shopId" = p_shop_id
      AND ce."occurredAt" >= p_start
      AND ce."occurredAt" <= p_end
      AND ce.device = p_device
      AND (ce."cartValue" > 0 OR ce."cartItemCount" > 0)
    GROUP BY ce."sessionId"
  ),
  median_calc AS (
    SELECT
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (checkout_time - first_event)) * 1000
      )::bigint as median_ms
    FROM sessions
    WHERE did_checkout = 1
      AND checkout_time IS NOT NULL
      AND checkout_time > first_event
  )
  SELECT
    COUNT(DISTINCT s."sessionId") as cart_sessions,
    CASE WHEN COUNT(DISTINCT s."sessionId") = 0 THEN 0
    ELSE ROUND(
      COUNT(DISTINCT CASE WHEN s.did_checkout = 1 THEN s."sessionId" END)::numeric
      / COUNT(DISTINCT s."sessionId") * 100, 1)
    END as cart_to_checkout_rate,
    COALESCE((SELECT median_ms FROM median_calc), 0) as median_time_to_checkout_ms,
    ROUND(COALESCE(AVG(CASE WHEN s.did_checkout = 1 THEN s.checkout_cart_value END), 0) / 100, 2) as avg_cart_value_at_checkout,
    ROUND(COALESCE(AVG(CASE WHEN s.did_checkout = 1 THEN s.checkout_item_count END), 0), 1) as avg_items_in_cart,
    CASE WHEN COUNT(DISTINCT s."sessionId") = 0 THEN 0
    ELSE ROUND(
      COUNT(DISTINCT CASE WHEN s.used_coupon = 1 THEN s."sessionId" END)::numeric
      / COUNT(DISTINCT s."sessionId") * 100, 1)
    END as coupon_attempt_rate
  FROM sessions s
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. top_countries_conversion
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION top_countries_conversion(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  country text,
  cart_sessions bigint,
  cart_to_checkout_rate numeric,
  avg_cart_value numeric
)
LANGUAGE sql STABLE AS $$
  WITH session_country AS (
    SELECT
      ce."sessionId",
      COALESCE(NULLIF(ce.country, ''), 'Unknown') as country,
      MAX(CASE WHEN ce."eventType" = 'cart_checkout_clicked' THEN 1 ELSE 0 END) as did_checkout,
      MAX(ce."cartValue") as max_cart_value
    FROM "CartEvent" ce
    WHERE ce."shopId" = p_shop_id
      AND ce."occurredAt" >= p_start
      AND ce."occurredAt" <= p_end
      AND (ce."cartValue" > 0 OR ce."cartItemCount" > 0)
    GROUP BY ce."sessionId", COALESCE(NULLIF(ce.country, ''), 'Unknown')
  ),
  country_agg AS (
    SELECT
      country,
      COUNT(DISTINCT "sessionId") as sessions,
      ROUND(
        COUNT(DISTINCT CASE WHEN did_checkout = 1 THEN "sessionId" END)::numeric
        / NULLIF(COUNT(DISTINCT "sessionId"), 0) * 100, 1
      ) as ctr,
      ROUND(AVG(max_cart_value) / 100, 2) as avg_value
    FROM session_country
    GROUP BY country
    HAVING COUNT(DISTINCT "sessionId") >= 3
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY sessions DESC) as rn
    FROM country_agg
  )
  SELECT country, sessions, ctr, avg_value FROM ranked WHERE rn <= 5
  UNION ALL
  SELECT
    'Other' as country,
    SUM(sessions) as sessions,
    ROUND(SUM(sessions * ctr) / NULLIF(SUM(sessions), 0), 1) as ctr,
    ROUND(SUM(sessions * avg_value) / NULLIF(SUM(sessions), 0), 2) as avg_value
  FROM ranked WHERE rn > 5
  HAVING SUM(sessions) > 0
  ORDER BY sessions DESC
$$;

-- ─────────────────────────────────────────────────────────────
-- 7. cart_value_trend
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cart_value_trend(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  grew_pct numeric,
  grew_avg_increase_dollars numeric,
  shrank_pct numeric,
  shrank_avg_decrease_dollars numeric,
  unchanged_pct numeric
)
LANGUAGE sql STABLE AS $$
  WITH session_values AS (
    SELECT
      "sessionId",
      MIN(CASE WHEN "eventType" = 'cart_item_added' THEN "cartValue" END) as first_add_value,
      MAX(CASE WHEN "eventType" = 'cart_checkout_clicked' THEN "cartValue" END) as checkout_value
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
    GROUP BY "sessionId"
    HAVING MAX(CASE WHEN "eventType" = 'cart_checkout_clicked' THEN 1 END) = 1
      AND MIN(CASE WHEN "eventType" = 'cart_item_added' THEN "cartValue" END) IS NOT NULL
  ),
  classified AS (
    SELECT
      "sessionId",
      first_add_value,
      checkout_value,
      CASE
        WHEN checkout_value > first_add_value THEN 'grew'
        WHEN checkout_value < first_add_value THEN 'shrank'
        ELSE 'unchanged'
      END as direction
    FROM session_values
    WHERE first_add_value IS NOT NULL AND checkout_value IS NOT NULL
  ),
  totals AS (
    SELECT COUNT(*) as total FROM classified
  )
  SELECT
    ROUND(COUNT(CASE WHEN direction = 'grew' THEN 1 END)::numeric / NULLIF((SELECT total FROM totals), 0) * 100, 1) as grew_pct,
    ROUND(COALESCE(AVG(CASE WHEN direction = 'grew' THEN (checkout_value - first_add_value) END), 0) / 100, 2) as grew_avg_increase_dollars,
    ROUND(COUNT(CASE WHEN direction = 'shrank' THEN 1 END)::numeric / NULLIF((SELECT total FROM totals), 0) * 100, 1) as shrank_pct,
    ROUND(COALESCE(AVG(CASE WHEN direction = 'shrank' THEN (first_add_value - checkout_value) END), 0) / 100, 2) as shrank_avg_decrease_dollars,
    ROUND(COUNT(CASE WHEN direction = 'unchanged' THEN 1 END)::numeric / NULLIF((SELECT total FROM totals), 0) * 100, 1) as unchanged_pct
  FROM classified
$$;

-- ─────────────────────────────────────────────────────────────
-- 8. session_patterns
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION session_patterns(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  one_and_done bigint,
  one_and_done_pct numeric,
  deliberate bigint,
  deliberate_pct numeric,
  lost_after_adding bigint,
  lost_after_adding_pct bigint
)
LANGUAGE sql STABLE AS $$
  WITH session_events AS (
    SELECT
      "sessionId",
      COUNT(CASE WHEN "eventType" = 'cart_item_added' THEN 1 END) as adds,
      COUNT(CASE WHEN "eventType" = 'cart_item_removed' THEN 1 END) as removes,
      COUNT(CASE WHEN "eventType" = 'cart_item_changed' THEN 1 END) as changes,
      MAX(CASE WHEN "eventType" = 'cart_checkout_clicked' THEN 1 ELSE 0 END) as did_checkout,
      MIN("occurredAt") as first_event,
      MAX("occurredAt") as last_event
    FROM "CartEvent"
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
    GROUP BY "sessionId"
  ),
  product_sessions AS (
    SELECT * FROM session_events WHERE adds > 0
  ),
  checked_out_sessions AS (
    SELECT * FROM product_sessions WHERE did_checkout = 1
  )
  SELECT
    -- one_and_done: exactly 1 add, no removes/changes, checked out
    COUNT(CASE WHEN adds = 1 AND removes = 0 AND changes = 0 AND did_checkout = 1 THEN 1 END) as one_and_done,
    ROUND(
      COUNT(CASE WHEN adds = 1 AND removes = 0 AND changes = 0 AND did_checkout = 1 THEN 1 END)::numeric
      / NULLIF((SELECT COUNT(*) FROM checked_out_sessions), 0) * 100, 1
    ) as one_and_done_pct,
    -- deliberate: 3+ edit events (adds + removes + changes), checked out
    COUNT(CASE WHEN (adds + removes + changes) >= 3 AND did_checkout = 1 THEN 1 END) as deliberate,
    ROUND(
      COUNT(CASE WHEN (adds + removes + changes) >= 3 AND did_checkout = 1 THEN 1 END)::numeric
      / NULLIF((SELECT COUNT(*) FROM checked_out_sessions), 0) * 100, 1
    ) as deliberate_pct,
    -- lost_after_adding: added but no checkout AND last event >5 min after first
    COUNT(CASE
      WHEN did_checkout = 0
        AND EXTRACT(EPOCH FROM (last_event - first_event)) > 300
      THEN 1 END) as lost_after_adding,
    ROUND(
      COUNT(CASE
        WHEN did_checkout = 0
          AND EXTRACT(EPOCH FROM (last_event - first_event)) > 300
        THEN 1 END)::numeric
      / NULLIF((SELECT COUNT(*) FROM product_sessions), 0) * 100, 1
    )::bigint as lost_after_adding_pct
  FROM product_sessions
$$;

-- ─────────────────────────────────────────────────────────────
-- 9. product_removals
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION product_removals(
  p_shop_id text,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE(
  product_title text,
  times_removed bigint,
  remove_rate numeric,
  avg_cart_value_at_removal numeric,
  product_that_stayed text
)
LANGUAGE sql STABLE AS $$
  WITH removals AS (
    SELECT
      item->>'productTitle' as product_title,
      ce."sessionId",
      ce."cartValue",
      ce."lineItems"
    FROM "CartEvent" ce,
    jsonb_array_elements(ce."lineItems") as item
    WHERE ce."shopId" = p_shop_id
      AND ce."occurredAt" >= p_start
      AND ce."occurredAt" <= p_end
      AND ce."eventType" = 'cart_item_removed'
      AND ce."lineItems" IS NOT NULL
  ),
  adds AS (
    SELECT
      item->>'productTitle' as product_title,
      COUNT(DISTINCT "sessionId") as added_count
    FROM "CartEvent",
    jsonb_array_elements("lineItems") as item
    WHERE "shopId" = p_shop_id
      AND "occurredAt" >= p_start
      AND "occurredAt" <= p_end
      AND "eventType" = 'cart_item_added'
      AND "lineItems" IS NOT NULL
    GROUP BY item->>'productTitle'
  ),
  removal_agg AS (
    SELECT
      product_title,
      COUNT(*) as times_removed,
      AVG("cartValue") as avg_cart_value
    FROM removals
    GROUP BY product_title
    HAVING COUNT(*) >= 3
  ),
  -- Find the most common product that was still in the cart (lineItems) at removal time
  co_occurring AS (
    SELECT
      r.product_title as removed_product,
      stayed_item->>'productTitle' as stayed_product,
      COUNT(*) as co_count
    FROM removals r,
    jsonb_array_elements(r."lineItems") as stayed_item
    WHERE stayed_item->>'productTitle' != r.product_title
    GROUP BY r.product_title, stayed_item->>'productTitle'
  ),
  top_stayed AS (
    SELECT DISTINCT ON (removed_product)
      removed_product,
      stayed_product
    FROM co_occurring
    ORDER BY removed_product, co_count DESC
  )
  SELECT
    ra.product_title,
    ra.times_removed,
    ROUND(ra.times_removed::numeric / NULLIF(a.added_count, 0) * 100, 1) as remove_rate,
    ROUND(ra.avg_cart_value / 100, 2) as avg_cart_value_at_removal,
    ts.stayed_product as product_that_stayed
  FROM removal_agg ra
  LEFT JOIN adds a ON a.product_title = ra.product_title
  LEFT JOIN top_stayed ts ON ts.removed_product = ra.product_title
  ORDER BY ra.times_removed DESC
$$;
