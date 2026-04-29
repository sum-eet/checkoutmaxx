"use client";

import { Banner, BlockStack, Button, Page } from "@shopify/polaris";
import { useEffect } from "react";

export default function EmbeddedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[embedded] unhandled error:", error);
  }, [error]);

  return (
    <Page>
      <BlockStack gap="400">
        <Banner
          title="Something went wrong"
          tone="critical"
          action={{ content: "Try again", onAction: reset }}
        >
          <p>An unexpected error occurred. If this keeps happening, contact support at sk200435@gmail.com.</p>
        </Banner>
      </BlockStack>
    </Page>
  );
}
