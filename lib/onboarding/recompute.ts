/**
 * PRD-4: Onboarding recompute logic.
 * Derives step completion from real DB rows — never fakes success.
 */

import { prisma } from "@/lib/prisma";
import type { OnboardingState } from "@prisma/client";

export type OnboardingStateRow = OnboardingState;

export interface OnboardingStepResult {
  key: "theme" | "pixel" | "data" | "recovery";
  title: string;
  description: string;
  cta: string;
  url?: string;
  external?: boolean;
  action?: string;
  completedAt: Date | null;
}

export interface OnboardingResult {
  state: OnboardingStateRow;
  steps: OnboardingStepResult[];
  allComplete: boolean;
  isPlus: boolean;
  dismissedAt: Date | null;
  totalSteps: number;
  completedCount: number;
}

/**
 * Recompute all onboarding steps for a shop and upsert the DB row.
 * Called on every GET /onboarding/state, on CartEvent insert, and on recovery rule PUT.
 */
export async function recomputeOnboarding(shopId: string): Promise<OnboardingResult> {
  console.log("[PRD-4:recompute] start shopId=%s", shopId);

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true, shopDomain: true, pixelId: true, installedAt: true, isPlus: true },
  });

  if (!shop) {
    console.error("[PRD-4:recompute] shop_missing shopId=%s", shopId);
    throw new Error("shop_missing");
  }

  // Step 1: Cart Monitor in theme — first CartEvent signals the block is active
  const firstCartEvent = await prisma.cartEvent.findFirst({
    where: { shopId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const step1 = firstCartEvent?.createdAt ?? null;
  console.log("[PRD-4:recompute] step1 (theme) cartEvent=%s", step1?.toISOString() ?? "none");

  // Step 2: Pixel registered — true if pixelId set on shop
  const step2 = shop.pixelId ? shop.installedAt : null;
  console.log("[PRD-4:recompute] step2 (pixel) pixelId=%s", shop.pixelId ?? "none");

  // Step 3: See your data — alias for step 1 (once CartEvent exists, data flows)
  const step3 = step1;
  console.log("[PRD-4:recompute] step3 (data) = step1=%s", step3?.toISOString() ?? "none");

  // Step 4 (Plus only): recovery rule enabled
  let step4: Date | null = null;
  if (shop.isPlus) {
    const recoveryRule = await prisma.recoveryRule.findUnique({
      where: { shopId },
      select: { enabled: true, updatedAt: true },
    });
    step4 = recoveryRule?.enabled ? recoveryRule.updatedAt : null;
    console.log("[PRD-4:recompute] step4 (recovery, plus) enabled=%s", recoveryRule?.enabled ?? false);
  } else {
    console.log("[PRD-4:recompute] step4 skipped (not plus)");
  }

  // Upsert OnboardingState
  const state = await prisma.onboardingState.upsert({
    where: { shopId },
    update: {
      step1Completed: step1,
      step2Completed: step2,
      step3Completed: step3,
      step4Completed: step4,
    },
    create: {
      shopId,
      step1Completed: step1,
      step2Completed: step2,
      step3Completed: step3,
      step4Completed: step4,
    },
  });
  console.log("[PRD-4:recompute] upserted stateId=%s shopId=%s", state.id, shopId);

  // Build step descriptors
  const themeEditorUrl = `https://${shop.shopDomain}/admin/themes/current/editor?context=apps`;

  const stepsAll: OnboardingStepResult[] = [
    {
      key: "theme",
      title: "Activate Cart Monitor in your theme",
      description: 'Open theme editor → Add block → Checkout Lens Cart Monitor → Save.',
      cta: "Open theme editor",
      url: themeEditorUrl,
      external: true,
      completedAt: state.step1Completed,
    },
    {
      key: "pixel",
      title: "Verify checkout pixel",
      description: "Auto-installed at setup. Click Reinstall if the check below shows unset.",
      cta: "Reinstall pixel",
      action: "reinstallPixel",
      completedAt: state.step2Completed,
    },
    {
      key: "data",
      title: "See your data",
      description: "We'll check for live sessions once your Cart Monitor block is active.",
      cta: "Go to dashboard",
      url: "/checkoutlens",
      completedAt: state.step3Completed,
    },
  ];

  if (shop.isPlus) {
    stepsAll.push({
      key: "recovery",
      title: "Set up Coupon Recovery",
      description: "Enable a recovery rule to automatically offer discounts to cart abandoners.",
      cta: "Configure rule",
      url: "/checkoutlens/recovery",
      completedAt: state.step4Completed,
    });
  }

  const completedCount = stepsAll.filter((s) => s.completedAt !== null).length;
  const allComplete = completedCount === stepsAll.length;

  console.log(
    "[PRD-4:recompute] done shopId=%s completedCount=%d/%d allComplete=%s",
    shopId, completedCount, stepsAll.length, allComplete
  );

  return {
    state,
    steps: stepsAll,
    allComplete,
    isPlus: shop.isPlus,
    dismissedAt: state.dismissedAt,
    totalSteps: stepsAll.length,
    completedCount,
  };
}
