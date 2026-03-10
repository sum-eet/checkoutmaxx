"use client";
import { Card, Text, Badge, BlockStack, InlineStack, Select, Tooltip } from "@shopify/polaris";

type FunnelStep = {
  step: string;
  label: string;
  sessions: number;
  pct: number;
  dropPct: number;
};

interface Props {
  steps: FunnelStep[];
  device: string;
  country: string;
  countries: string[];
  onDeviceChange: (v: string) => void;
  onCountryChange: (v: string) => void;
}

const DEVICE_OPTIONS = [
  { label: "All devices", value: "" },
  { label: "Mobile", value: "mobile" },
  { label: "Desktop", value: "desktop" },
  { label: "Tablet", value: "tablet" },
];

export function CheckoutFunnel({
  steps,
  device,
  country,
  countries,
  onDeviceChange,
  onCountryChange,
}: Props) {
  const countryOptions = [
    { label: "All countries", value: "" },
    ...countries.map((c) => ({ label: c, value: c })),
  ];

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Checkout Funnel
          </Text>
          <InlineStack gap="200">
            <Select
              label=""
              labelHidden
              options={DEVICE_OPTIONS}
              value={device}
              onChange={onDeviceChange}
            />
            <Select
              label=""
              labelHidden
              options={countryOptions}
              value={country}
              onChange={onCountryChange}
            />
          </InlineStack>
        </InlineStack>

        <BlockStack gap="400">
          {steps.map((step, i) => {
            const isAnomaly = i > 0 && step.dropPct > 20;
            const dropCount = i > 0 ? (steps[i - 1].sessions - step.sessions) : 0;
            const tooltipContent = i > 0
              ? `${dropCount} dropped from previous step (${step.dropPct}% of total)`
              : `${step.sessions} sessions started checkout`;

            return (
              <BlockStack key={step.step} gap="100">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <Text
                      as="p"
                      variant="bodyMd"
                      fontWeight={isAnomaly ? "semibold" : "regular"}
                    >
                      {step.label}
                    </Text>
                    {isAnomaly && <Badge tone="critical">High drop-off</Badge>}
                  </InlineStack>
                  <InlineStack gap="300" blockAlign="center">
                    <Tooltip content={tooltipContent}>
                      <Text as="p" tone="subdued" variant="bodySm">
                        {step.sessions} sessions
                      </Text>
                    </Tooltip>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      {step.pct}%
                    </Text>
                  </InlineStack>
                </InlineStack>

                <div style={{ background: "#f4f6f8", borderRadius: 4, height: 10 }}>
                  <div
                    style={{
                      background: isAnomaly ? "#d72c0d" : "#008060",
                      width: `${step.pct}%`,
                      height: "100%",
                      borderRadius: 4,
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              </BlockStack>
            );
          })}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
