"use client";

/**
 * PRD-3 — /checkoutlens/billing
 * Plan selection and current plan management.
 */

import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  InlineGrid,
  Badge,
} from "@shopify/polaris";
import { useFeatures } from "@/hooks/useFeatures";
import { PlanCard } from "@/components/billing/PlanCard";

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function doUpgrade(plan: "standard" | "plus"): Promise<void> {
  const token = (window as any).__shopifySessionToken ?? "";
  const res = await fetch("/api/billing/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ plan }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.message ?? body?.error ?? `billing/create returned ${res.status}`);
  }
  if (body.confirmationUrl) {
    window.top!.location.href = body.confirmationUrl;
  }
}

async function doCancel(): Promise<void> {
  const token = (window as any).__shopifySessionToken ?? "";
  const res = await fetch("/api/billing/cancel", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `billing/cancel returned ${res.status}`);
  }
}

export default function BillingPage() {
  const { tier, plan, subscriptionStatus, trialEndsAt, currentPeriodEnd, isLoading, features } = useFeatures();
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = useState(false);

  // Read isPlus from /api/billing/me — included in features response
  // We'll check via a dedicated call if needed, but use hasFeature("recovery") as Plus proxy
  const isPlus = !!features?.recovery !== undefined
    ? undefined  // We need explicit isPlus from server
    : false;

  const isOnPlus = tier === "plus";
  const isOnStandard = tier === "standard";
  const isOnFree = tier === "free";

  async function handleUpgrade(p: "standard" | "plus") {
    setError(null);
    setUpgradeLoading(true);
    try {
      await doUpgrade(p);
    } catch (err: any) {
      console.error("[PRD-3:billing/page] upgrade error:", err?.message);
      setError(err?.message ?? "Upgrade failed.");
      setUpgradeLoading(false);
    }
  }

  async function handleCancel() {
    setError(null);
    setCancelLoading(true);
    try {
      await doCancel();
      setCancelSuccess(true);
    } catch (err: any) {
      console.error("[PRD-3:billing/page] cancel error:", err?.message);
      setError(err?.message ?? "Cancel failed.");
    } finally {
      setCancelLoading(false);
    }
  }

  return (
    <Page title="Plan & billing">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" title="Something went wrong">
                <p>{error}</p>
              </Banner>
            )}
            {cancelSuccess && (
              <Banner tone="success" title="Plan cancelled">
                <p>
                  Your plan has been cancelled. You will retain access until{" "}
                  {formatDate(currentPeriodEnd)}, then your account will revert to the Free plan.
                </p>
              </Banner>
            )}
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              <PlanCard
                tier="free"
                current={isOnFree}
                onCancel={!isOnFree && subscriptionStatus === "ACTIVE" ? handleCancel : undefined}
                cancelLoading={cancelLoading}
              />
              <PlanCard
                tier="standard"
                current={isOnStandard}
                onUpgrade={handleUpgrade}
                upgradeLoading={upgradeLoading}
              />
              <PlanCard
                tier="plus"
                current={isOnPlus}
                disabled={isLoading ? false : !features?.recovery && !isOnPlus}
                onUpgrade={handleUpgrade}
                upgradeLoading={upgradeLoading}
              />
            </InlineGrid>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Current plan</Text>
              <Text as="p">
                {isLoading ? "Loading…" : `${plan.replace("pending_", "")} — ${subscriptionStatus ?? "Free"}`}
              </Text>
              {trialEndsAt && (
                <Text as="p" tone="subdued">
                  Trial ends {formatDate(trialEndsAt)}
                </Text>
              )}
              {currentPeriodEnd && subscriptionStatus === "ACTIVE" && (
                <Text as="p" tone="subdued">
                  Next renewal {formatDate(currentPeriodEnd)}
                </Text>
              )}
              {subscriptionStatus === "CANCELLED" && (
                <Text as="p" tone="caution">
                  Access until {formatDate(currentPeriodEnd)}
                </Text>
              )}
              {subscriptionStatus === "ACTIVE" && !isOnFree && (
                <Button
                  tone="critical"
                  variant="plain"
                  onClick={handleCancel}
                  loading={cancelLoading}
                  disabled={cancelLoading}
                >
                  Cancel plan
                </Button>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
