-- Run in Supabase SQL editor BEFORE deploying rebuild-minimal to production.
-- Check for duplicates first:
-- SELECT "shopDomain", count(*) FROM "Shop" GROUP BY 1 HAVING count(*) > 1;
-- If any exist: keep newest active row, delete older duplicates.

-- 1. Add uninstalledAt column
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "uninstalledAt" TIMESTAMPTZ NULL;

-- 2. Ensure shopDomain unique index exists
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- 3. Replace create_shop RPC with upsert-on-conflict
CREATE OR REPLACE FUNCTION create_shop(p_shop_domain TEXT, p_access_token TEXT)
RETURNS TABLE(id UUID, prev_pixel_id TEXT) AS $$
DECLARE out_id UUID; out_prev TEXT;
BEGIN
  SELECT "pixelId" INTO out_prev FROM "Shop" WHERE "shopDomain" = p_shop_domain;

  INSERT INTO "Shop" (id, "shopDomain", "accessToken", "isActive", "installedAt", "updatedAt", "uninstalledAt", "pixelId")
  VALUES (gen_random_uuid(), p_shop_domain, p_access_token, true, now(), now(), NULL, NULL)
  ON CONFLICT ("shopDomain") DO UPDATE SET
    "accessToken"   = EXCLUDED."accessToken",
    "isActive"      = true,
    "installedAt"   = now(),
    "updatedAt"     = now(),
    "uninstalledAt" = NULL,
    "pixelId"       = NULL
  RETURNING "Shop".id INTO out_id;

  RETURN QUERY SELECT out_id, out_prev;
END;
$$ LANGUAGE plpgsql;

-- 4. Verify
SELECT routine_name FROM information_schema.routines WHERE routine_name = 'create_shop';
SELECT indexname FROM pg_indexes WHERE tablename = 'Shop' AND indexdef ILIKE '%shopDomain%';
