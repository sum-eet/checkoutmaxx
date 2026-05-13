"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { Page, BlockStack, SkeletonBodyText } from "@shopify/polaris";
import { PolarisVizProvider } from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

import FilterBar from "@/components/checkoutlens/analytics/FilterBar";
import KpiRow from "@/components/checkoutlens/analytics/KpiRow";
import FunnelCard from "@/components/checkoutlens/analytics/FunnelCard";
import TrendCard from "@/components/checkoutlens/analytics/TrendCard";
import FailedDiscountsCard from "@/components/checkoutlens/analytics/FailedDiscountsCard";

import type { FunnelStep } from "@/lib/analytics/checkoutFunnel";
import type { TrendBucket } from "@/lib/analytics/checkoutTrend";
import type { FailedDiscountRow } from "@/lib/analytics/failedDiscounts";
import type { KpiPeriod } from "@/lib/analytics/kpis";

// PRD-1 §5 — shop timezone default; real value fetched on client from shop context
const DEFAULT_TZ = "America/New_York";

function getSessionToken(): string {
  if (typeof window === "undefined") return "";
  // App Bridge sets window.__shopifySessionToken
  return (window as any).__shopifySessionToken ?? "";
}

function buildApiUrl(base: string, params: URLSearchParams): string {
  const p = new URLSearchParams({
    start: params.get("start") ?? "",
    end: params.get("end") ?? "",
  });
  if (params.get("country")) p.set("country", params.get("country")!);
  if (params.get("device")) p.set("device", params.get("device")!);
  if (params.get("discountUsage")) p.set("discountUsage", params.get("discountUsage")!);
  return `${base}?${p.toString()}`;
}

function AnalyticsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // KPI state
  const [kpiData, setKpiData] = useState<{ current: KpiPeriod; previous: KpiPeriod } | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [kpiError, setKpiError] = useState(false);

  // Funnel state
  const [funnelSteps, setFunnelSteps] = useState<FunnelStep[] | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(true);
  const [funnelError, setFunnelError] = useState(false);

  // Trend state
  const [trendBuckets, setTrendBuckets] = useState<TrendBucket[] | null>(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState(false);

  // Failed discounts state
  const [discountRows, setDiscountRows] = useState<FailedDiscountRow[] | null>(null);
  const [discountTotal, setDiscountTotal] = useState(0);
  const [discountPage, setDiscountPage] = useState(1);
  const [discountLoading, setDiscountLoading] = useState(true);
  const [discountError, setDiscountError] = useState(false);

  // Shop timezone — fetch once from shop context or fall back to default
  const [shopTimezone, setShopTimezone] = useState(DEFAULT_TZ);
  useEffect(() => {
    // App Bridge exposes shopify.config if available
    const tz = (window as any)?.shopify?.config?.shop?.timezone ?? DEFAULT_TZ;
    setShopTimezone(tz);
  }, []);

  // Initialise default search params on first load
  useEffect(() => {
    if (!searchParams.get("start")) {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 29);
      const params = new URLSearchParams(searchParams.toString());
      params.set("start", start.toISOString());
      params.set("end", end.toISOString());
      params.set("preset", "last_30d");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
  }, []);

  async function apiFetch(url: string) {
    const token = getSessionToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Re-fetch all widgets when search params change
  useEffect(() => {
    if (!searchParams.get("start")) return; // wait for init

    const params = searchParams;

    setKpiLoading(true);
    setFunnelLoading(true);
    setTrendLoading(true);
    setDiscountLoading(true);
    setKpiError(false);
    setFunnelError(false);
    setTrendError(false);
    setDiscountError(false);

    apiFetch(buildApiUrl("/api/checkoutlens/analytics/kpis", params))
      .then((d) => setKpiData(d))
      .catch(() => setKpiError(true))
      .finally(() => setKpiLoading(false));

    apiFetch(buildApiUrl("/api/checkoutlens/analytics/funnel", params))
      .then((d) => setFunnelSteps(d.steps))
      .catch(() => setFunnelError(true))
      .finally(() => setFunnelLoading(false));

    apiFetch(buildApiUrl("/api/checkoutlens/analytics/trend", params))
      .then((d) => setTrendBuckets(d.buckets))
      .catch(() => setTrendError(true))
      .finally(() => setTrendLoading(false));

    const discountUrl = buildApiUrl("/api/checkoutlens/analytics/failed-discounts", params);
    apiFetch(`${discountUrl}&page=${discountPage}`)
      .then((d) => { setDiscountRows(d.rows); setDiscountTotal(d.total); })
      .catch(() => setDiscountError(true))
      .finally(() => setDiscountLoading(false));
  }, [searchParams.toString()]);

  // Re-fetch failed discounts on page change
  useEffect(() => {
    if (!searchParams.get("start")) return;
    setDiscountLoading(true);
    setDiscountError(false);
    const discountUrl = buildApiUrl("/api/checkoutlens/analytics/failed-discounts", searchParams);
    apiFetch(`${discountUrl}&page=${discountPage}`)
      .then((d) => { setDiscountRows(d.rows); setDiscountTotal(d.total); })
      .catch(() => setDiscountError(true))
      .finally(() => setDiscountLoading(false));
  }, [discountPage]);

  return (
    <Page title="Checkout Analytics">
      <PolarisVizProvider>
        <BlockStack gap="400">
          <FilterBar shopTimezone={shopTimezone} />
          <KpiRow
            current={kpiData?.current ?? null}
            previous={kpiData?.previous ?? null}
            loading={kpiLoading}
          />
          <FunnelCard
            steps={funnelSteps}
            loading={funnelLoading}
            error={funnelError}
          />
          <TrendCard
            buckets={trendBuckets}
            loading={trendLoading}
            error={trendError}
          />
          <FailedDiscountsCard
            rows={discountRows}
            total={discountTotal}
            page={discountPage}
            onPageChange={setDiscountPage}
            loading={discountLoading}
            error={discountError}
          />
        </BlockStack>
      </PolarisVizProvider>
    </Page>
  );
}

// useSearchParams requires Suspense boundary
export default function CheckoutAnalyticsPage() {
  return (
    <Suspense fallback={<SkeletonBodyText lines={10} />}>
      <AnalyticsInner />
    </Suspense>
  );
}
