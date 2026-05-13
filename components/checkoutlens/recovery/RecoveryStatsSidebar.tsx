"use client";

import { BlockStack, Text, Divider, SkeletonBodyText } from "@shopify/polaris";
import { useEffect, useState } from "react";
import { fetcher } from "@/lib/admin-fetch";

interface Stats {
  issued: number;
  claimed: number;
  claimRate: number;
  redeemed: number;
  revenue: number;
}

export function RecoveryStatsSidebar() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date().toISOString();
    fetcher(`/api/checkoutlens/recovery/stats?start=${start}&end=${end}`)
      .then((data: Stats) => {
        console.log("[PRD-2:RecoveryStatsSidebar] stats", data);
        setStats(data);
      })
      .catch((err: Error) => {
        console.error("[PRD-2:RecoveryStatsSidebar] error", err.message);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">Last 30 days</Text>
        <SkeletonBodyText lines={3} />
      </BlockStack>
    );
  }

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

  return (
    <BlockStack gap="200">
      <Text as="h3" variant="headingSm">Last 30 days</Text>
      <Divider />
      <BlockStack gap="100">
        <Text as="p" variant="bodyMd">
          Issued: <Text as="span" fontWeight="bold">{stats?.issued ?? 0}</Text>
        </Text>
        <Text as="p" variant="bodyMd">
          Claimed: <Text as="span" fontWeight="bold">{stats?.claimed ?? 0}</Text>
          {(stats?.issued ?? 0) > 0 && (
            <Text as="span" tone="subdued"> ({stats?.claimRate}%)</Text>
          )}
        </Text>
        <Text as="p" variant="bodyMd">
          Redeemed: <Text as="span" fontWeight="bold">{stats?.redeemed ?? 0}</Text>
          {(stats?.redeemed ?? 0) > 0 && (
            <Text as="span" tone="subdued"> — {fmt(stats?.revenue ?? 0)} recovered</Text>
          )}
        </Text>
      </BlockStack>
    </BlockStack>
  );
}
