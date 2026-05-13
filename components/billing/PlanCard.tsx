"use client";

/**
 * PRD-3 — Plan card for the billing page.
 * Shows plan name, price, features, and an action button.
 */

import { useState } from "react";
import { Card, BlockStack, Text, List, Button, Badge } from "@shopify/polaris";

interface PlanCardProps {
  tier: "free" | "standard" | "plus";
  current: boolean;
  disabled?: boolean;
  onUpgrade?: (plan: "standard" | "plus") => void;
  onCancel?: () => void;
  upgradeLoading?: boolean;
  cancelLoading?: boolean;
}

const PLAN_META: Record<
  string,
  { label: string; price: string; features: string[] }
> = {
  free: {
    label: "Free",
    price: "Free forever",
    features: [
      "Basic KPIs (last 30 days)",
      "Checkout funnel (30 days)",
      "Failed-discounts table",
      "Post-install onboarding guide",
    ],
  },
  standard: {
    label: "Standard",
    price: "$10 / month",
    features: [
      "Everything in Free",
      "Segmentation filters (country, device, discount)",
      "Custom date ranges",
      "Trend chart (AOV / shipping / conversion)",
      "Full sessions timeline",
    ],
  },
  plus: {
    label: "Plus",
    price: "$39 / month",
    features: [
      "Everything in Standard",
      "Coupon recovery (Shopify Plus stores only)",
      "Smart cart-abandon detection",
      "Automated discount code issuance",
    ],
  },
};

export function PlanCard({
  tier,
  current,
  disabled,
  onUpgrade,
  onCancel,
  upgradeLoading,
  cancelLoading,
}: PlanCardProps) {
  const meta = PLAN_META[tier];

  function getButton() {
    if (tier === "free") {
      if (current) {
        return <Button disabled>Current plan</Button>;
      }
      // Downgrade = cancel current
      if (onCancel) {
        return (
          <Button tone="critical" onClick={onCancel} loading={cancelLoading}>
            Downgrade to Free
          </Button>
        );
      }
      return <Button disabled>Downgrade to Free</Button>;
    }

    if (disabled) {
      return <Button disabled>Requires Shopify Plus</Button>;
    }

    if (current) {
      return <Button disabled>Current plan</Button>;
    }

    const plan = tier as "standard" | "plus";
    return (
      <Button
        variant="primary"
        onClick={() => onUpgrade?.(plan)}
        loading={upgradeLoading}
        disabled={upgradeLoading}
      >
        Upgrade to {meta.label}
      </Button>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {meta.label}
            {current && (
              <>
                {" "}
                <Badge tone="success">Current</Badge>
              </>
            )}
          </Text>
          <Text as="p" variant="bodyLg" tone="subdued">
            {meta.price}
          </Text>
          {tier === "plus" && (
            <Text as="p" variant="bodySm" tone="caution">
              Shopify Plus stores only
            </Text>
          )}
        </BlockStack>
        <List type="bullet">
          {meta.features.map((f) => (
            <List.Item key={f}>{f}</List.Item>
          ))}
        </List>
        {getButton()}
      </BlockStack>
    </Card>
  );
}
