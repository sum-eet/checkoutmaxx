"use client";

import { Page, Layout, BlockStack, InlineStack, SkeletonBodyText, Card, Text } from "@shopify/polaris";
import { useState } from "react";
import useSWR from "swr";
import { useShop } from "@/hooks/useShop";
import { DateRangeSelector, type DateRange } from "@/components/monitor/DateRangeSelector";
import { StatusBanner } from "@/components/monitor/StatusBanner";
import { KpiCards } from "@/components/monitor/KpiCards";
import { CheckoutFunnel } from "@/components/monitor/CheckoutFunnel";
import { ErrorsTable } from "@/components/monitor/ErrorsTable";
import { DroppedProductsTable } from "@/components/monitor/DroppedProductsTable";
import { LiveEventFeed } from "@/components/monitor/LiveEventFeed";
import { FailedDiscountsTable } from "@/components/monitor/FailedDiscountsTable";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function getDefaultRange(): DateRange {
  const now = new Date();
  return { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now };
}

function rangeParams(range: DateRange) {
  return `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
}

function LoadingCard() {
  return (
    <Card>
      <SkeletonBodyText lines={4} />
    </Card>
  );
}

function DashboardContent() {
  const shop = useShop();
  const [range, setRange] = useState<DateRange>(getDefaultRange);
  const [device, setDevice] = useState("");
  const [country, setCountry] = useState("");

  const rp = rangeParams(range);
  const baseUrl = shop ? `/api/metrics?shop=${shop}` : null;

  const { data: status } = useSWR(baseUrl ? `${baseUrl}&metric=status` : null, fetcher, {
    refreshInterval: 60000,
  });
  const { data: kpi } = useSWR(baseUrl ? `${baseUrl}&metric=kpi&${rp}` : null, fetcher);
  const { data: funnel } = useSWR(
    baseUrl
      ? `${baseUrl}&metric=funnel&${rp}${device ? `&device=${device}` : ""}${country ? `&country=${country}` : ""}`
      : null,
    fetcher
  );
  const { data: errors } = useSWR(baseUrl ? `${baseUrl}&metric=errors&${rp}` : null, fetcher);
  const { data: dropped } = useSWR(
    baseUrl ? `${baseUrl}&metric=dropped-products&${rp}` : null,
    fetcher
  );
  const { data: failedDiscounts = [] } = useSWR(
    baseUrl ? `${baseUrl}&metric=failed-discounts&${rp}` : null,
    fetcher
  );
  const { data: countries = [] } = useSWR(
    baseUrl ? `${baseUrl}&metric=countries&${rp}` : null,
    fetcher
  );

  if (!shop) {
    return (
      <Card>
        <Text as="p" tone="subdued">
          Loading store data...
        </Text>
      </Card>
    );
  }

  return (
    <BlockStack gap="400">
      {/* Status Banner */}
      {status ? (
        <StatusBanner state={status.state} activeAlert={status.activeAlert} />
      ) : (
        <LoadingCard />
      )}

      {/* Date Range */}
      <InlineStack align="end">
        <DateRangeSelector value={range} onChange={setRange} />
      </InlineStack>

      {/* KPI Cards */}
      {kpi ? (
        <KpiCards
          checkoutsStarted={kpi.checkoutsStarted}
          completedOrders={kpi.completedOrders}
          cvr={kpi.cvr}
          cvrDelta={kpi.cvrDelta}
          baselineCvr={kpi.baselineCvr}
        />
      ) : (
        <LoadingCard />
      )}

      {/* Checkout Funnel */}
      {funnel ? (
        <CheckoutFunnel
          steps={funnel}
          device={device}
          country={country}
          countries={countries}
          onDeviceChange={setDevice}
          onCountryChange={setCountry}
        />
      ) : (
        <LoadingCard />
      )}

      {/* Errors + Dropped Products (two-column) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
        }}
      >
        {errors ? <ErrorsTable errors={errors} /> : <LoadingCard />}
        {dropped ? <DroppedProductsTable products={dropped} /> : <LoadingCard />}
      </div>

      {/* Failed Discount Codes */}
      {failedDiscounts ? (
        <FailedDiscountsTable discounts={failedDiscounts} />
      ) : (
        <LoadingCard />
      )}

      {/* Live Event Feed */}
      <LiveEventFeed shop={shop} />
    </BlockStack>
  );
}

export default function MonitorPage() {
  return (
    <Page title="Monitor">
      <Layout>
        <Layout.Section>
          <DashboardContent />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
