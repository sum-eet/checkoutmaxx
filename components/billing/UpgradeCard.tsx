"use client";

/**
 * PRD-3 — Upgrade card shown inside FeatureGate when a feature is gated.
 * Clicking "Upgrade" calls POST /api/billing/create and redirects
 * to Shopify's charge approval page.
 */

import { useState } from "react";
import { Card, EmptyState, Banner } from "@shopify/polaris";

interface UpgradeCardProps {
  requiredTier: "standard" | "plus";
  feature: string;
}

async function upgradeTo(plan: "standard" | "plus"): Promise<void> {
  const token = (window as any).__shopifySessionToken ?? "";
  const res = await fetch("/api/billing/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ plan }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `billing/create returned ${res.status}`);
  }

  const { confirmationUrl } = await res.json();
  if (confirmationUrl) {
    window.top!.location.href = confirmationUrl;
  }
}

export function UpgradeCard({ requiredTier, feature }: UpgradeCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPlus = requiredTier === "plus";
  const price = isPlus ? 39 : 10;
  const tierLabel = isPlus ? "Plus" : "Standard";

  async function handleUpgrade() {
    setError(null);
    setLoading(true);
    try {
      await upgradeTo(requiredTier);
    } catch (err: any) {
      console.error("[PRD-3:UpgradeCard] upgrade error feature=%s", feature, err?.message);
      setError(err?.message ?? "Upgrade failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Card>
      {error && (
        <Banner tone="critical" title="Upgrade failed">
          <p>{error}</p>
        </Banner>
      )}
      <EmptyState
        heading={`Upgrade to ${tierLabel} to unlock this`}
        action={{
          content: `Upgrade — $${price}/mo`,
          onAction: handleUpgrade,
          loading,
          disabled: loading,
        }}
        image=""
      >
        <p>This feature requires the {tierLabel} plan.</p>
      </EmptyState>
    </Card>
  );
}
