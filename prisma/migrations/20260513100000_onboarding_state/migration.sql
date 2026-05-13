-- PRD-4: OnboardingState table
-- Run manually: psql "$DIRECT_URL" -f prisma/migrations/20260513100000_onboarding_state/migration.sql

CREATE TABLE IF NOT EXISTS "OnboardingState" (
  "id"             TEXT NOT NULL,
  "shopId"         TEXT NOT NULL,
  "step1Completed" TIMESTAMP(3),
  "step2Completed" TIMESTAMP(3),
  "step3Completed" TIMESTAMP(3),
  "step4Completed" TIMESTAMP(3),
  "dismissedAt"    TIMESTAMP(3),
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnboardingState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OnboardingState_shopId_key" ON "OnboardingState"("shopId");

ALTER TABLE "OnboardingState"
  ADD CONSTRAINT "OnboardingState_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
