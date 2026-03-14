-- Add UTM / traffic source columns to CartEvent
ALTER TABLE "CartEvent"
  ADD COLUMN IF NOT EXISTS "utmSource"   text,
  ADD COLUMN IF NOT EXISTS "utmMedium"   text,
  ADD COLUMN IF NOT EXISTS "utmCampaign" text,
  ADD COLUMN IF NOT EXISTS "utmReferrer" text;

-- Index for filtering by source on the sessions list
CREATE INDEX IF NOT EXISTS "CartEvent_shopId_utmSource_idx"
  ON "CartEvent" ("shopId", "utmSource");
