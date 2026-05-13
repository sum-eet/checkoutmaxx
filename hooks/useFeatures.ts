"use client";

/**
 * PRD-3 — SWR-cached hook for current shop's tier and feature flags.
 * Fetches /api/billing/me; dedupes for 5 minutes.
 */

import useSWR from "swr";
import type { Tier } from "@/lib/billing/gate";
import { fetcher as adminFetch } from "@/lib/admin-fetch";

interface BillingMe {
  tier: Tier;
  plan: string;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  features: Record<string, boolean>;
  isPlus: boolean;
}

export function useFeatures() {
  const { data, isLoading, error } = useSWR<BillingMe>("/api/billing/me", adminFetch, {
    dedupingInterval: 5 * 60_000,
    revalidateOnFocus: false,
  });

  return {
    tier: (data?.tier ?? "free") as Tier,
    plan: data?.plan ?? "free",
    subscriptionStatus: data?.subscriptionStatus ?? null,
    trialEndsAt: data?.trialEndsAt ? new Date(data.trialEndsAt) : null,
    currentPeriodEnd: data?.currentPeriodEnd ? new Date(data.currentPeriodEnd) : null,
    features: data?.features ?? {},
    isPlus: data?.isPlus ?? false,
    has: (key: string): boolean => !!data?.features?.[key],
    isLoading,
    error,
  };
}
