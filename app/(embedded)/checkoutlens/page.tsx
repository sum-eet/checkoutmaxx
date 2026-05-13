"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  Page,
  BlockStack,
  InlineStack,
  InlineGrid,
  Card,
  Text,
  EmptyState,
  IndexTable,
  SkeletonBodyText,
  SkeletonDisplayText,
} from "@shopify/polaris";
import { PolarisVizProvider, FunnelChartNext } from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";

import DateRangePicker, { computePresetRange } from "@/components/checkoutlens/DateRangePicker";
import type { DateRange } from "@/components/checkoutlens/DateRangePicker";
import { KpiCard } from "@/components/checkoutlens/dashboard/KpiCard";
import { UpgradeKpiCard } from "@/components/checkoutlens/dashboard/UpgradeKpiCard";
import { HeatmapGrid } from "@/components/checkoutlens/dashboard/HeatmapGrid";

import type { DashboardPayload, DashboardKpis } from "@/lib/analytics/dashboardAggregator";
import { WelcomeModal } from "@/components/checkoutlens/onboarding/WelcomeModal";
import type { OnboardingResult } from "@/lib/onboarding/recompute";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TZ = "America/New_York";
const FUNNEL_STEPS = [
  "checkout_started",
  "checkout_contact_info_submitted",
  "checkout_shipping_info_submitted",
  "payment_info_submitted",
  "checkout_completed",
] as const;
const STEP_LABELS: Record<string, string> = {
  checkout_started: "Checkout started",
  checkout_contact_info_submitted: "Contact info",
  checkout_shipping_info_submitted: "Shipping info",
  payment_info_submitted: "Payment",
  checkout_completed: "Completed",
};
const SPARSE_THRESHOLD = 10; // total sessions below which we show "—"

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  if (n === 0) return "—";
  return n.toLocaleString();
}

function pct(n: number, sessions: number): string {
  if (sessions < SPARSE_THRESHOLD) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function money(n: number, currency: string, sessions: number): string {
  if (sessions < SPARSE_THRESHOLD) return "—";
  if (n === 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function relativeTime(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return iso;
  }
}

function getSessionToken(): string {
  if (typeof window === "undefined") return "";
  return (window as any).__shopifySessionToken ?? "";
}

// ---------------------------------------------------------------------------
// Preset label for the header text
// ---------------------------------------------------------------------------

const PRESET_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7d: "Last 7 days",
  last_30d: "Last 30 days",
  last_90d: "Last 90 days",
  month_to_date: "Month to date",
  last_month: "Last month",
  custom: "Custom range",
};

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

async function onboardingFetcher(url: string) {
  const token = getSessionToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function DashboardInner() {
  const [shopTimezone, setShopTimezone] = useState(DEFAULT_TZ);
  const [currency, setCurrency] = useState("USD");

  // PRD-4: fetch onboarding state for WelcomeModal
  const { data: onboardingResult } = useSWR<OnboardingResult>(
    "/api/checkoutlens/onboarding/state",
    onboardingFetcher,
    { revalidateOnFocus: false }
  );
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  // Initialise date range to last_30d using shop timezone
  const [range, setRange] = useState<DateRange>(() => {
    const { start, end } = computePresetRange("last_30d", DEFAULT_TZ);
    return { start, end, preset: "last_30d" };
  });

  // Re-compute range once timezone is known (prevents SSR mismatch)
  useEffect(() => {
    const tz = (window as any)?.shopify?.config?.shop?.timezone ?? DEFAULT_TZ;
    setShopTimezone(tz);
    const { start, end } = computePresetRange("last_30d", tz);
    setRange({ start, end, preset: "last_30d" });
  }, []);

  // Dashboard data
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchDashboard = useCallback(
    async (r: DateRange) => {
      console.log("[PRD-5:page] fetchDashboard start=%s end=%s", r.start.toISOString(), r.end.toISOString());
      setLoading(true);
      setError(false);

      const params = new URLSearchParams({
        start: r.start.toISOString(),
        end: r.end.toISOString(),
      });

      try {
        const token = getSessionToken();
        const res = await fetch(`/api/checkoutlens/dashboard?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload: DashboardPayload = await res.json();
        console.log("[PRD-5:page] fetchDashboard done sessions=%d", payload.kpis?.sessions ?? 0);
        setData(payload);
        if (payload.kpis?.currency) setCurrency(payload.kpis.currency);
      } catch (err: any) {
        console.error("[PRD-5:page] fetchDashboard error:", err.message);
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // E5.6: single fetch on date range change
  useEffect(() => {
    fetchDashboard(range);
  }, [range.start.toISOString(), range.end.toISOString()]);

  const kpi = data?.kpis;
  const sessions = kpi?.sessions ?? 0;
  const sparse = sessions < SPARSE_THRESHOLD;

  // Funnel chart data for FunnelChartNext
  const funnelData = (data?.funnel ?? []).map((step) => ({
    name: STEP_LABELS[step.key] ?? step.key,
    value: step.sessions,
  }));
  const hasFunnelData = !sparse && funnelData.length > 0 && funnelData[0]?.value >= SPARSE_THRESHOLD;

  // Format KPI values — all show "—" when sparse
  const sessionsValue = sparse ? "—" : fmt(sessions);
  const convValue = sparse ? "—" : pct(kpi?.convRate ?? 0, sessions);
  const aovValue = sparse ? "—" : money(kpi?.aov ?? 0, currency, sessions);
  const recoveredValue = money(kpi?.recoveredRevenue ?? 0, currency, sessions);

  const presetLabel = PRESET_LABELS[range.preset] ?? "Custom range";

  return (
    <Page title="Checkout Lens">
      {/* PRD-4: Welcome modal — shown once on fresh install */}
      <WelcomeModal
        onboardingResult={onboardingResult ?? null}
        onStart={() => {
          console.log("[PRD-4:DashboardPage] WelcomeModal start clicked — setup guide visible");
          setShowSetupGuide(true);
        }}
      />
      <PolarisVizProvider>
        <BlockStack gap="400">
          {/* Header row: period label + date picker */}
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingLg">
              {presetLabel}
            </Text>
            <DateRangePicker
              value={range}
              onChange={setRange}
              shopTimezone={shopTimezone}
            />
          </InlineStack>

          {/* KPI cards row */}
          <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
            <KpiCard
              title="Sessions"
              value={sessionsValue}
              delta={sparse ? null : (kpi?.sessionsDelta ?? null)}
              sparkline={kpi?.sessionsSpark ?? []}
              loading={loading}
            />
            <KpiCard
              title="Checkout conversion"
              value={convValue}
              delta={sparse ? null : (kpi?.convDelta ?? null)}
              sparkline={kpi?.convSpark ?? []}
              loading={loading}
            />
            <KpiCard
              title="Average order value"
              value={aovValue}
              delta={sparse ? null : (kpi?.aovDelta ?? null)}
              sparkline={kpi?.aovSpark ?? []}
              loading={loading}
            />
            {/*
              TODO(PRD-3): wrap in <FeatureGate feature="recovery" fallback={<UpgradeKpiCard>}>
              For now render unconditionally so the card is visible in all tiers.
            */}
            <KpiCard
              title="Recovered sales"
              value={recoveredValue === "—" && !sparse ? "$0" : recoveredValue}
              delta={sparse ? null : (kpi?.recoveredDelta ?? null)}
              sparkline={kpi?.recoveredSpark ?? []}
              loading={loading}
            />
          </InlineGrid>

          {/* Checkout funnel */}
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Checkout funnel
              </Text>
              {loading ? (
                <SkeletonBodyText lines={5} />
              ) : hasFunnelData ? (
                <FunnelChartNext
                  data={[
                    {
                      name: "Funnel",
                      data: funnelData.map((step, i) => ({
                        key: step.name,
                        value: step.value,
                      })),
                    },
                  ]}
                />
              ) : (
                <EmptyState heading="Not enough data" image="" />
              )}
            </BlockStack>
          </Card>

          {/* Bottom row: failed discounts + drop-off heatmap */}
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            {/* Failed discounts */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Failed discounts
                </Text>
                {loading ? (
                  <SkeletonBodyText lines={4} />
                ) : (data?.failed ?? []).length > 0 ? (
                  <IndexTable
                    resourceName={{ singular: "code", plural: "codes" }}
                    itemCount={(data?.failed ?? []).length}
                    headings={[
                      { title: "Code" },
                      { title: "Attempts" },
                      { title: "Unique sessions" },
                      { title: "Last seen" },
                    ]}
                    selectable={false}
                  >
                    {(data?.failed ?? []).map((row, i) => (
                      <IndexTable.Row key={row.code} id={row.code} position={i}>
                        <IndexTable.Cell>
                          <Text as="span" fontWeight="semibold">
                            {row.code}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>{row.attempts}</IndexTable.Cell>
                        <IndexTable.Cell>{row.uniqueSessions}</IndexTable.Cell>
                        <IndexTable.Cell>{relativeTime(row.lastSeen)}</IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                ) : (
                  <EmptyState heading="No failed coupons yet" image="" />
                )}
              </BlockStack>
            </Card>

            {/* Drop-off heatmap */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  Drop-off heatmap
                </Text>
                {loading ? (
                  <SkeletonBodyText lines={6} />
                ) : (
                  <HeatmapGrid
                    steps={[...FUNNEL_STEPS]}
                    segments={["mobile", "tablet", "desktop"]}
                    data={data?.dropOff ?? {}}
                    loading={loading}
                  />
                )}
              </BlockStack>
            </Card>
          </InlineGrid>
        </BlockStack>
      </PolarisVizProvider>
    </Page>
  );
}

// useSearchParams / client hooks require Suspense boundary per Next.js
export default function DashboardPage() {
  return (
    <Suspense fallback={<SkeletonBodyText lines={10} />}>
      <DashboardInner />
    </Suspense>
  );
}
