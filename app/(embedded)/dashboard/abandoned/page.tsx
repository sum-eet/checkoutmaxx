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
  const started = steps[0].sessions;
  const completed = steps[steps.length - 1].sessions;
  const totalLost = steps.reduce((sum, s, i) => {
    if (i === 0) return sum;
    return sum + (steps[i - 1].sessions - s.sessions);
  }, 0);

  return (
    <BlockStack gap="0">
      {steps.map((step, i) => {
        const width = started > 0 ? (step.sessions / started) * 100 : 0;
        const isLast = i === steps.length - 1;
        const dropped = i > 0 ? steps[i - 1].sessions - step.sessions : 0;
        const dropPct = started > 0 ? ((dropped / started) * 100).toFixed(1) : "0";
        const isHighDrop = step.dropPct > 15;
        const bg = isLast ? "#e3f1df" : isHighDrop ? "#fdf1f1" : "#f4f6fe";

        return (
          <div key={step.step}>
            <div
              style={{
                width: `${width}%`,
                minWidth: 120,
                background: bg,
                padding: "12px 16px",
                borderRadius: 8,
                minHeight: 44,
                marginBottom: 0,
              }}
            >
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" fontWeight="semibold">
                    {step.label}
                  </Text>
                  {isHighDrop && !isLast && (
                    <Badge tone="critical">High drop-off</Badge>
                  )}
                </InlineStack>
                <Text as="span" tone="subdued">
                  {step.sessions.toLocaleString()}
                </Text>
              </InlineStack>
            </div>
            {i < steps.length - 1 && dropped > 0 && (
              <div style={{ padding: "4px 16px" }}>
                <InlineStack align="center">
                  <Badge tone={isHighDrop ? "critical" : "attention"}>
                    {`-${dropped.toLocaleString()} dropped · ${dropPct}%`}
                  </Badge>
                </InlineStack>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ marginTop: 12 }}>
        <InlineStack align="space-between">
          <Text as="p" tone="subdued" variant="bodySm">
            {(started - completed).toLocaleString()} sessions never completed
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Total dropped: {totalLost.toLocaleString()} sessions
          </Text>
        </InlineStack>
      </div>
    </BlockStack>
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

  const started = funnel?.[0]?.sessions ?? 0;
  const completed = funnel?.[funnel.length - 1]?.sessions ?? 0;
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
      {funnel ? (
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
          {funnel ? (
            <FunnelViz steps={funnel} />
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
