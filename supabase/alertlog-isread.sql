-- Run this in Supabase SQL editor before using the notifications page.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE "AlertLog"
ADD COLUMN IF NOT EXISTS "isRead" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "AlertLog_shopId_isRead_idx"
ON "AlertLog" ("shopId", "isRead");
