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
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

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

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const gradId = `spark-${color.replace("#", "")}`;
  const arr = data.map((v, i) => ({ v, i }));
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={arr} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function KpiCard({
  label,
  value,
  delta,
  sparkData,
  color,
}: {
  label: string;
  value: string;
  delta: number | null;
  sparkData: number[];
  color: string;
}) {
  const positive = delta !== null && delta >= 0;
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="headingMd" tone="subdued">
          {label}
        </Text>
        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" variant="heading2xl">
            {value}
          </Text>
          {delta !== null && (
            <Badge tone={positive ? "success" : "critical"}>
              {`${positive ? "+" : ""}${(delta * 100).toFixed(1)}%`}
            </Badge>
          )}
        </InlineStack>
        <Sparkline data={sparkData} color={color} />
      </BlockStack>
    </Card>
  );
}

type KpiData = {
  checkoutsStarted: number;
  completedOrders: number;
  cvr: number;
  cvrDelta: number | null;
  baselineCvr: number | null;
};

type FunnelStep = {
  step: string;
  label: string;
  sessions: number;
  pct: number;
  dropPct: number;
};

function ConvertedContent() {
  const shop = useShop();
  const [range, setRange] = useState<DateRange>(getDefaultRange);

  const rp = rangeParams(range);
  const baseUrl = shop ? `/api/metrics?shop=${shop}` : null;

  const { data: kpi } = useSWR<KpiData>(
    baseUrl ? `${baseUrl}&metric=kpi&${rp}` : null,
    fetcher
  );
  const { data: funnel } = useSWR<FunnelStep[]>(
    baseUrl ? `${baseUrl}&metric=funnel&${rp}` : null,
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
  const kpiValid = kpi != null && "checkoutsStarted" in kpi;

  const sparkPoints =
    funnelArr.length > 0 ? funnelArr.map((f) => f.sessions) : [0, 0, 0, 0, 0];

  const cvrSpark =
    funnelArr.length > 0 ? funnelArr.map((f) => f.pct) : [0, 0, 0, 0, 0];

  const baselineCvr = kpiValid ? (kpi!.baselineCvr ?? 0) : 0;
  const currentCvr = kpiValid ? (kpi!.cvr ?? 0) : 0;
  const cvrOverTime =
    funnelArr.length > 1
      ? funnelArr.slice(0, 7).map((f, i) => ({
          date: `Step ${i + 1}`,
          cvr: parseFloat(((f.sessions / (funnelArr[0].sessions || 1)) * 100).toFixed(1)),
          baseline: parseFloat((baselineCvr * 100).toFixed(1)),
        }))
      : [{ date: "Now", cvr: parseFloat((currentCvr * 100).toFixed(1)), baseline: parseFloat((baselineCvr * 100).toFixed(1)) }];

  const cvrPct = parseFloat((currentCvr * 100).toFixed(1));
  const cvrDeltaForBadge = kpi?.cvrDelta ?? null;

  const funnelRows =
    funnelArr.map((f) => [f.label, String(f.sessions), `${f.pct}%`]);

  const kpiRows = kpiValid
    ? [
        ["Checkouts Started", String(kpi!.checkoutsStarted)],
        ["Completed Orders", String(kpi!.completedOrders)],
        ["CVR", `${(kpi!.cvr * 100).toFixed(1)}%`],
        ["Baseline CVR", kpi!.baselineCvr !== null ? `${(kpi!.baselineCvr * 100).toFixed(1)}%` : "—"],
        ["CVR Delta", kpi!.cvrDelta !== null ? `${(kpi!.cvrDelta * 100).toFixed(2)}pts` : "—"],
      ]
    : [];

  return (
    <BlockStack gap="500">
      <InlineStack align="end">
        <DateRangeSelector value={range} onChange={setRange} />
      </InlineStack>

      {/* KPI Row 1 */}
      {kpiValid ? (
        <InlineGrid columns={3} gap="400">
          <KpiCard
            label="Checkouts Started"
            value={kpi!.checkoutsStarted.toLocaleString()}
            delta={null}
            sparkData={sparkPoints}
            color="#4F7FFF"
          />
          <KpiCard
            label="Completed Orders"
            value={kpi!.completedOrders.toLocaleString()}
            delta={null}
            sparkData={sparkPoints.slice().reverse()}
            color="#007f5f"
          />
          <KpiCard
            label="Checkout CVR"
            value={`${cvrPct}%`}
            delta={cvrDeltaForBadge}
            sparkData={cvrSpark}
            color="#6366f1"
          />
        </InlineGrid>
      ) : (
        <LoadingCard />
      )}

      {/* KPI Row 2 */}
      {kpiValid ? (
        <InlineGrid columns={2} gap="400">
          <KpiCard
            label="Checkouts Started"
            value={kpi!.checkoutsStarted.toLocaleString()}
            delta={null}
            sparkData={sparkPoints}
            color="#f59e0b"
          />
          <KpiCard
            label="Completed Orders"
            value={kpi!.completedOrders.toLocaleString()}
            delta={null}
            sparkData={sparkPoints.slice().reverse()}
            color="#8b5cf6"
          />
        </InlineGrid>
      ) : (
        <LoadingCard />
      )}

      {/* CVR Over Time */}
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            CVR Over Time
          </Text>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart
              data={cvrOverTime}
              margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
            >
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#8c9196" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#8c9196" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip formatter={(v: unknown) => `${v}%`} />
              {baselineCvr > 0 && (
                <ReferenceLine
                  y={parseFloat((baselineCvr * 100).toFixed(1))}
                  stroke="#8c9196"
                  strokeDasharray="4 2"
                  label={{
                    value: `Baseline ${(baselineCvr * 100).toFixed(1)}%`,
                    fontSize: 10,
                    fill: "#8c9196",
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="cvr"
                stroke="#4F7FFF"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <Text as="p" tone="subdued" variant="bodySm">
            Red dots = days when an abandonment alert fired
          </Text>
        </BlockStack>
      </Card>

      {/* Funnel + KPI tables */}
      <InlineGrid columns={2} gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Funnel Steps
            </Text>
            {Array.isArray(funnel) ? (
              <DataTable
                columnContentTypes={["text", "numeric", "numeric"]}
                headings={["Step", "Sessions", "Pct"]}
                rows={funnelRows}
              />
            ) : (
              <SkeletonBodyText lines={3} />
            )}
          </BlockStack>
        </Card>
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Checkout CVR
            </Text>
            {kpiValid ? (
              <DataTable
                columnContentTypes={["text", "text"]}
                headings={["Metric", "Value"]}
                rows={kpiRows}
              />
            ) : (
              <SkeletonBodyText lines={3} />
            )}
          </BlockStack>
        </Card>
      </InlineGrid>
    </BlockStack>
  );
}

export default function ConvertedCartsPage() {
  return (
    <Page
      title="Converted Carts"
      subtitle="Orders that made it all the way through"
    >
      <Layout>
        <Layout.Section>
          <ConvertedContent />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
