-- Run this in Supabase SQL editor (Table Editor → SQL Editor)
-- Creates the IngestLog operational table.
-- This is NOT managed by Prisma migrations — it's an operational table.

CREATE TABLE IF NOT EXISTS "IngestLog" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "endpoint"     TEXT NOT NULL,         -- 'cart' or 'pixel'
  "shopDomain"   TEXT NOT NULL,
  "eventType"    TEXT,
  "success"      BOOLEAN NOT NULL,
  "latencyMs"    INTEGER,
  "errorCode"    TEXT,
  "errorMessage" TEXT,
  "occurredAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the daily health query
CREATE INDEX IF NOT EXISTS "IngestLog_occurredAt_idx" ON "IngestLog" ("occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "IngestLog_success_idx"    ON "IngestLog" ("success", "occurredAt" DESC);

-- Disable RLS (service role key bypasses it anyway, but be explicit)
ALTER TABLE "IngestLog" DISABLE ROW LEVEL SECURITY;
