"use client";
import {
  Card,
  Text,
  IndexTable,
  Badge,
  BlockStack,
  Modal,
  EmptyState,
} from "@shopify/polaris";
import { useState } from "react";

type TopError = {
  type: string;
  label: string;
  count: number;
};

interface Props {
  errors: TopError[];
}

const TONE_MAP: Record<string, "critical" | "warning" | "attention"> = {
  discount_error: "critical",
  payment_dropoff: "warning",
  extension_error: "critical",
};

export function ErrorsTable({ errors }: Props) {
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillType, setDrillType] = useState<string>("");

  function openDrill(type: string) {
    setDrillType(type);
    setDrillOpen(true);
  }

  const selectedError = errors.find((e) => e.type === drillType);

  return (
    <>
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">
            Top Errors Before Drop-off
          </Text>

          {errors.length === 0 ? (
            <Text as="p" tone="subdued">
              No errors detected in this time range.
            </Text>
          ) : (
            <IndexTable
              resourceName={{ singular: "error", plural: "errors" }}
              itemCount={errors.length}
              headings={[
                { title: "Error Type" },
                { title: "Count" },
              ]}
              selectable={false}
            >
              {errors.map((error, i) => (
                <IndexTable.Row
                  key={error.type}
                  id={error.type}
                  position={i}
                  onClick={() => openDrill(error.type)}
                >
                  <IndexTable.Cell>
                    <Badge tone={TONE_MAP[error.type]}>{error.label}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {error.count}
                    </Text>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </BlockStack>
      </Card>

      <Modal
        open={drillOpen}
        onClose={() => setDrillOpen(false)}
        title={selectedError?.label || "Error detail"}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              <Text as="span" fontWeight="semibold">{selectedError?.count}</Text>
              {" "}occurrence{selectedError?.count !== 1 ? "s" : ""} in the selected time range.
            </Text>
            {drillType === "discount_error" && (
              <Text as="p" tone="subdued">
                These are checkout alerts shown when a discount code fails validation. Check your
                active discount codes in Shopify admin to identify expired or over-limit codes.
              </Text>
            )}
            {drillType === "payment_dropoff" && (
              <Text as="p" tone="subdued">
                Sessions that submitted payment info but never completed the order. This can indicate
                a payment gateway issue, card declines, or a broken checkout extension.
              </Text>
            )}
            {drillType === "extension_error" && (
              <Text as="p" tone="subdued">
                A checkout UI extension threw a JavaScript error. Check your installed checkout apps
                for recent updates that may have introduced a bug.
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
