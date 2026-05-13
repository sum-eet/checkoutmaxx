/**
 * PRD-3 — Prisma seed: canonical feature flags.
 * Run via: npm run db:seed
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FLAGS = [
  {
    featureKey: "segmentation_filters",
    tierRequired: "standard",
    description: "Country / device / discount segmentation filters in analytics",
  },
  {
    featureKey: "custom_date_range",
    tierRequired: "standard",
    description: "Custom date range beyond default 30 days",
  },
  {
    featureKey: "trend_chart",
    tierRequired: "standard",
    description: "AOV / shipping / conversion trend chart over time",
  },
  {
    featureKey: "sessions_full",
    tierRequired: "standard",
    description: "Full session timeline (vs. basic summary)",
  },
  {
    featureKey: "recovery",
    tierRequired: "plus",
    description: "Coupon recovery for abandoned carts (Shopify Plus stores only)",
  },
] as const;

async function main() {
  console.log("[PRD-3:seed] Upserting %d feature flags…", FLAGS.length);

  for (const flag of FLAGS) {
    await prisma.featureFlag.upsert({
      where: { featureKey: flag.featureKey },
      create: {
        featureKey: flag.featureKey,
        tierRequired: flag.tierRequired,
        description: flag.description,
      },
      update: {
        tierRequired: flag.tierRequired,
        description: flag.description,
      },
    });
    console.log("[PRD-3:seed]   upserted featureKey=%s tierRequired=%s", flag.featureKey, flag.tierRequired);
  }

  console.log("[PRD-3:seed] Done.");
}

main()
  .catch((e) => {
    console.error("[PRD-3:seed] FATAL:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
