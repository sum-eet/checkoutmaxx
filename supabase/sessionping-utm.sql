-- Add UTM columns to SessionPing for V3 source tracking
ALTER TABLE "SessionPing"
  ADD COLUMN IF NOT EXISTS "utmSource"   text,
  ADD COLUMN IF NOT EXISTS "utmMedium"   text,
  ADD COLUMN IF NOT EXISTS "utmCampaign" text;
