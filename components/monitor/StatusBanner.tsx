"use client";
import { Banner, Text } from "@shopify/polaris";

type StatusBannerState = "healthy" | "critical" | "learning" | "no_data";

interface Props {
  state: StatusBannerState;
  activeAlert?: { title: string; id: string };
}

export function StatusBanner({ state, activeAlert }: Props) {
  if (state === "healthy") {
    return (
      <Banner tone="success">
        <Text as="p">Checkout healthy — no issues detected in the last 60 minutes.</Text>
      </Banner>
    );
  }
  if (state === "critical" && activeAlert) {
    return (
      <Banner tone="critical" action={{ content: "View alert", url: "/alerts" }}>
        <Text as="p">Active alert: {activeAlert.title}</Text>
      </Banner>
    );
  }
  if (state === "learning") {
    return (
      <Banner tone="warning">
        <Text as="p">
          Learning your store&apos;s patterns — alerts activate once we have 48 hours of data.
        </Text>
      </Banner>
    );
  }
  return (
    <Banner tone="info">
      <Text as="p">
        Monitoring paused — pixel not receiving events. Check Settings → Pixel Health.
      </Text>
    </Banner>
  );
}
