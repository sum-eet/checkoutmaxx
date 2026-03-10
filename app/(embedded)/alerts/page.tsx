"use client";

import {
  Page,
  Layout,
  Card,
  Tabs,
  EmptyState,
  IndexTable,
  Text,
  Badge,
  BlockStack,
} from "@shopify/polaris";
import { useState } from "react";

const HISTORY_HEADINGS = [
  { title: "Alert" },
  { title: "Fired" },
  { title: "Resolved" },
  { title: "Sent via" },
  { title: "ROI Saved" },
] as const;

export default function AlertsPage() {
  const [selected, setSelected] = useState(0);

  const tabs = [
    { id: "active", content: "Active", accessibilityLabel: "Active alerts" },
    { id: "history", content: "History", accessibilityLabel: "Alert history" },
  ];

  return (
    <Page title="Alerts">
      <Layout>
        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selected} onSelect={setSelected}>
              <div style={{ paddingTop: 16 }}>
                {selected === 0 && (
                  <EmptyState
                    heading="No active alerts"
                    image=""
                  >
                    <Text as="p" tone="subdued">
                      Your checkout is running smoothly. Alerts will appear here when issues are
                      detected.
                    </Text>
                  </EmptyState>
                )}

                {selected === 1 && (
                  <BlockStack gap="300">
                    <Text as="p" tone="subdued">
                      Alert history will appear here once alerts have fired.
                    </Text>
                    <IndexTable
                      resourceName={{ singular: "alert", plural: "alerts" }}
                      itemCount={0}
                      headings={HISTORY_HEADINGS}
                      selectable={false}
                      emptyState={
                        <Text as="p" tone="subdued">
                          No alert history yet.
                        </Text>
                      }
                    >
                      {[]}
                    </IndexTable>
                  </BlockStack>
                )}
              </div>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
