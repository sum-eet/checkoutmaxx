-- Partial unique index: only one active shop row per domain at a time.
-- Prevents duplicate active rows from accumulating on reinstall if application-level
-- deactivation fails (e.g. concurrent requests, webhook delays).
-- On conflict (code 23505) the auth callback and ensureShop already handle gracefully.
--
-- Before running: clean up any existing duplicate active rows first:
--
--   WITH ranked AS (
--     SELECT id, "shopDomain",
--       ROW_NUMBER() OVER (PARTITION BY "shopDomain" ORDER BY "installedAt" DESC) AS rn
--     FROM "Shop"
--     WHERE "isActive" = true
--   )
--   UPDATE "Shop" SET "isActive" = false
--   WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopDomain_active_unique"
ON "Shop" ("shopDomain")
WHERE "isActive" = true;
