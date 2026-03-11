"use client";

import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  DataTable,
  SkeletonBodyText,
} from "@shopify/polaris";
import { useState } from "react";
import useSWR from "swr";
import { useShop } from "@/hooks/useShop";
import { DateRangeSelector, type DateRange } from "@/components/monitor/DateRangeSelector";
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

type FunnelStep = {
  step: string;
  label: string;
  sessions: number;
  pct: number;
  dropPct: number;
};

type TopError = {
  type: string;
  label: string;
  count: number;
};

type DroppedProduct = {
  title: string;
  count: number;
  pctOfDrops: number;
};

type FailedDiscount = {
  code: string;
  count: number;
  lastSeen: string;
  errorMessage: string | null;
};

function FunnelViz({ steps }: { steps: FunnelStep[] }) {
  if (!steps || steps.length === 0) return null;
  const baseline = steps[0].sessions || 1;

  return (
    <div style={{ fontFamily: "inherit" }}>
      {steps.map((step, i) => {
        const barPct = Math.max((step.sessions / baseline) * 100, 0);
        const isLast = i === steps.length - 1;
        const dropped = i > 0 ? steps[i - 1].sessions - step.sessions : 0;
        const dropPct = steps[i - 1]?.sessions > 0
          ? Math.round((dropped / steps[i - 1].sessions) * 100)
          : 0;
        const isHighDrop = dropPct >= 30;

        return (
          <div key={step.step}>
            {/* Drop connector */}
            {i > 0 && dropped > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 0 6px 16px", color: isHighDrop ? "#d72c0d" : "#8c9196",
                fontSize: 12,
              }}>
                <span style={{ fontSize: 10 }}>▼</span>
                <span>
                  <strong>{dropped.toLocaleString()}</strong> dropped here
                  {" "}
                  <span style={{
                    background: isHighDrop ? "#fff4f4" : "#f4f6f8",
                    border: `1px solid ${isHighDrop ? "#ffc9c9" : "#e1e3e5"}`,
                    borderRadius: 4, padding: "1px 6px", fontWeight: 600,
                    color: isHighDrop ? "#d72c0d" : "#6d7175",
                  }}>
                    -{dropPct}%
                  </span>
                </span>
              </div>
            )}
            {i > 0 && dropped === 0 && <div style={{ height: 4 }} />}

            {/* Step row */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "8px 0",
            }}>
              {/* Label */}
              <div style={{ width: 110, flexShrink: 0, fontSize: 13, color: "#202223", fontWeight: isLast ? 600 : 400 }}>
                {step.label}
              </div>

              {/* Bar track */}
              <div style={{ flex: 1, background: "#f4f6f8", borderRadius: 4, height: 28, position: "relative", overflow: "hidden" }}>
                <div style={{
                  width: `${barPct}%`,
                  height: "100%",
                  background: isLast
                    ? "linear-gradient(90deg,#007f5f,#00a47a)"
                    : isHighDrop
                    ? "linear-gradient(90deg,#d72c0d,#e85d3a)"
                    : "linear-gradient(90deg,#4f7fff,#6b8fff)",
                  borderRadius: 4,
                  transition: "width 0.3s",
                }} />
              </div>

              {/* Count + pct */}
              <div style={{ width: 80, flexShrink: 0, textAlign: "right", fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: "#202223" }}>{step.sessions.toLocaleString()}</span>
                <span style={{ color: "#8c9196", marginLeft: 4 }}>{step.pct}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AbandonedContent() {
  const shop = useShop();
  const [range, setRange] = useState<DateRange>(getDefaultRange);

  const rp = rangeParams(range);
  const baseUrl = shop ? `/api/metrics?shop=${shop}` : null;

  const { data: funnel } = useSWR<FunnelStep[]>(
    baseUrl ? `${baseUrl}&metric=funnel&${rp}` : null,
    fetcher
  );
  const { data: errors } = useSWR<TopError[]>(
    baseUrl ? `${baseUrl}&metric=errors&${rp}` : null,
    fetcher
  );
  const { data: dropped } = useSWR<DroppedProduct[]>(
    baseUrl ? `${baseUrl}&metric=dropped-products&${rp}` : null,
    fetcher
  );
  const { data: failedDiscounts = [] } = useSWR<FailedDiscount[]>(
    baseUrl ? `${baseUrl}&metric=failed-discounts&${rp}` : null,
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

  const funnelArr = Array.isArray(funnel) ? funnel : [];
  const started = funnelArr[0]?.sessions ?? 0;
  const completed = funnelArr[funnelArr.length - 1]?.sessions ?? 0;
  const dropped_count = started - completed;
  const dropRate = started > 0 ? ((dropped_count / started) * 100).toFixed(1) : "0";

  const droppedRows =
    dropped?.map((p) => [p.title, String(p.count), `${p.pctOfDrops}%`]) ?? [];

  const errorRows =
    errors?.map((e) => [e.label, String(e.count)]) ?? [];

  return (
    <BlockStack gap="500">
      <InlineStack align="end">
        <DateRangeSelector value={range} onChange={setRange} />
      </InlineStack>

      {/* KPI Row */}
      {Array.isArray(funnel) ? (
        <InlineGrid columns={4} gap="400">
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="headingMd" tone="subdued">
                Sessions Started
              </Text>
              <Text as="p" variant="heading2xl">
                {started.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="headingMd" tone="subdued">
                Sessions Dropped
              </Text>
              <Text as="p" variant="heading2xl">
                {dropped_count.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="headingMd" tone="subdued">
                Drop Rate
              </Text>
              <Text as="p" variant="heading2xl">
                {`${dropRate}%`}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="headingMd" tone="subdued">
                Completed
              </Text>
              <Text as="p" variant="heading2xl">
                {completed.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>
      ) : (
        <LoadingCard />
      )}

      {/* Checkout Funnel */}
      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            Checkout Funnel
          </Text>
          {Array.isArray(funnel) ? (
            <FunnelViz steps={funnelArr} />
          ) : (
            <SkeletonBodyText lines={6} />
          )}
        </BlockStack>
      </Card>

      {/* Top Errors */}
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Top Errors
          </Text>
          {errors ? (
            errors.length === 0 ? (
              <Text as="p" tone="subdued">
                No errors recorded in this period.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric"]}
                headings={["Error Type", "Count"]}
                rows={errorRows}
              />
            )
          ) : (
            <SkeletonBodyText lines={3} />
          )}
        </BlockStack>
      </Card>

      {/* Dropped Products */}
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Dropped Products
          </Text>
          {dropped ? (
            dropped.length === 0 ? (
              <Text as="p" tone="subdued">
                No dropped products in this period.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric"]}
                headings={["Product", "Carts", "% of Drops"]}
                rows={droppedRows}
              />
            )
          ) : (
            <SkeletonBodyText lines={3} />
          )}
        </BlockStack>
      </Card>

      {/* Failed Discount Codes */}
      {failedDiscounts ? (
        <FailedDiscountsTable discounts={failedDiscounts} />
      ) : (
        <LoadingCard />
      )}
    </BlockStack>
  );
}

export default function AbandonedCartsPage() {
  return (
    <Page title="Abandoned Carts" subtitle="Where customers drop off and why">
      <Layout>
        <Layout.Section>
          <AbandonedContent />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
