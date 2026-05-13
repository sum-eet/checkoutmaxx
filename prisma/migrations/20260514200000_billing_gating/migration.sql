-- PRD-3: Billing + freemium gating migration
-- Adds: Shop.partnerDevelopment, Shop.currentPeriodEnd, Shop.planChangedAt
--       FeatureFlag, FeatureFlagOverride tables

-- Shop additions
ALTER TABLE "Shop"
  ADD COLUMN IF NOT EXISTS "partnerDevelopment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "planChangedAt" TIMESTAMP(3);

-- FeatureFlag table
CREATE TABLE IF NOT EXISTS "FeatureFlag" (
  "id"           TEXT NOT NULL,
  "featureKey"   TEXT NOT NULL,
  "tierRequired" TEXT NOT NULL,
  "description"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FeatureFlag_featureKey_key" ON "FeatureFlag"("featureKey");

-- FeatureFlagOverride table
CREATE TABLE IF NOT EXISTS "FeatureFlagOverride" (
  "id"         TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "shopId"     TEXT NOT NULL,
  "enabled"    BOOLEAN NOT NULL,
  "reason"     TEXT,
  "expiresAt"  TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlagOverride_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FeatureFlagOverride_featureKey_shopId_key"
  ON "FeatureFlagOverride"("featureKey", "shopId");

-- FK from FeatureFlagOverride to FeatureFlag
ALTER TABLE "FeatureFlagOverride"
  ADD CONSTRAINT "FeatureFlagOverride_featureKey_fkey"
  FOREIGN KEY ("featureKey") REFERENCES "FeatureFlag"("featureKey")
  ON DELETE RESTRICT ON UPDATE CASCADE;
