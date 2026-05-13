-- Add Plus plan fields to Shop
ALTER TABLE "Shop"
  ADD COLUMN IF NOT EXISTS "planDisplayName" TEXT,
  ADD COLUMN IF NOT EXISTS "isPlus" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "planCheckedAt" TIMESTAMP(3);

-- RecoveryRule: one rule per shop
CREATE TABLE IF NOT EXISTS "RecoveryRule" (
  "id"               TEXT NOT NULL,
  "shopId"           TEXT NOT NULL,
  "enabled"          BOOLEAN NOT NULL DEFAULT false,
  "threshold"        INTEGER NOT NULL DEFAULT 2,
  "codeStrategy"     TEXT NOT NULL,
  "staticCode"       TEXT,
  "generatedPercent" INTEGER,
  "expiryMinutes"    INTEGER NOT NULL DEFAULT 60,
  "allowStacking"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecoveryRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecoveryRule_shopId_key" ON "RecoveryRule"("shopId");

ALTER TABLE "RecoveryRule"
  ADD CONSTRAINT "RecoveryRule_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- RecoveryIssue: one row per (shop, session)
CREATE TABLE IF NOT EXISTS "RecoveryIssue" (
  "id"              TEXT NOT NULL,
  "shopId"          TEXT NOT NULL,
  "sessionId"       TEXT NOT NULL,
  "cartToken"       TEXT,
  "code"            TEXT NOT NULL,
  "source"          TEXT NOT NULL,
  "discountNodeId"  TEXT,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "issuedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt"       TIMESTAMP(3),
  "redeemedAt"      TIMESTAMP(3),
  "redeemedOrderId" TEXT,
  "redeemedTotal"   INTEGER,
  CONSTRAINT "RecoveryIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecoveryIssue_shopId_sessionId_key"
  ON "RecoveryIssue"("shopId", "sessionId");

CREATE INDEX IF NOT EXISTS "RecoveryIssue_shopId_redeemedAt_idx"
  ON "RecoveryIssue"("shopId", "redeemedAt");

ALTER TABLE "RecoveryIssue"
  ADD CONSTRAINT "RecoveryIssue_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
