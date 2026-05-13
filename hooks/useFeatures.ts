"use client";

/**
 * PRD-3 — SWR-cached hook for current shop's tier and feature flags.
 * Fetches /api/billing/me; dedupes for 5 minutes.
 */

import useSWR from "swr";
import type { Tier } from "@/lib/billing/gate";

interface BillingMe {
  tier: Tier;
  plan: string;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  features: Record<string, boolean>;
}

function fetcher(url: string): Promise<BillingMe> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${(window as any).__shopifySessionToken ?? ""}`,
    },
  }).then((r) => {
    if (!r.ok) throw new Error(`/api/billing/me returned ${r.status}`);
    return r.json();
  });
}

export function useFeatures() {
  const { data, isLoading, error } = useSWR<BillingMe>("/api/billing/me", fetcher, {
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
    has: (key: string): boolean => !!data?.features?.[key],
    isLoading,
    error,
  };
}
