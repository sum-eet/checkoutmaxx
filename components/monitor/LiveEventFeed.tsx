"use client";
import { Card, Text, Badge, BlockStack, DataTable } from "@shopify/polaris";
import useSWR from "swr";

type LiveEvent = {
  id: string;
  eventType: string;
  sessionId: string;
  deviceType: string | null;
  country: string | null;
  discountCode: string | null;
  totalPrice: number | null;
  currency: string | null;
  errorMessage: string | null;
  occurredAt: string;
};

interface Props {
  shop: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const EVENT_LABELS: Record<string, string> = {
  checkout_started: "Checkout started",
  checkout_contact_info_submitted: "Contact info",
  checkout_address_info_submitted: "Address submitted",
  checkout_shipping_info_submitted: "Shipping selected",
  payment_info_submitted: "Payment submitted",
  checkout_completed: "Order completed",
  alert_displayed: "Discount error",
  ui_extension_errored: "Extension error",
};

function formatTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function eventBadge(eventType: string) {
  if (eventType === "alert_displayed" || eventType === "ui_extension_errored") {
    return <Badge tone="critical">{EVENT_LABELS[eventType] || eventType}</Badge>;
  }
  if (eventType === "checkout_completed") {
    return <Badge tone="success">{EVENT_LABELS[eventType]}</Badge>;
  }
  return <Text as="span">{EVENT_LABELS[eventType] || eventType}</Text>;
}

function eventDetail(e: LiveEvent) {
  if (e.discountCode) return `Code "${e.discountCode}"`;
  if (e.totalPrice) return `$${e.totalPrice.toFixed(2)} ${e.currency || ""}`.trim();
  if (e.errorMessage) return e.errorMessage.slice(0, 60);
  return "—";
}

export function LiveEventFeed({ shop }: Props) {
  const { data: events = [] } = useSWR<LiveEvent[]>(
    shop ? `/api/metrics?metric=live-feed&shop=${shop}` : null,
    fetcher,
    { refreshInterval: 30000 }
  );

  const rows = events.map((e) => [
    formatTime(e.occurredAt),
    eventBadge(e.eventType),
    eventDetail(e),
    e.deviceType || "—",
    e.country || "—",
  ]);

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Recent Events
        </Text>
        {events.length === 0 ? (
          <Text as="p" tone="subdued">
            No events yet. Go through a checkout on your store to generate data.
          </Text>
        ) : (
          <DataTable
            columnContentTypes={["text", "text", "text", "text", "text"]}
            headings={["Time", "Event", "Detail", "Device", "Country"]}
            rows={rows}
          />
        )}
      </BlockStack>
    </Card>
  );
}
