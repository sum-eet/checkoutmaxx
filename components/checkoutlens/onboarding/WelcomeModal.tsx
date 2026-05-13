"use client";

/**
 * PRD-4 §5.1 — Welcome modal shown once per shop on first install.
 * Conditions: startedAt within 5 minutes, no step completed, not yet seen in sessionStorage.
 */

import { useEffect, useState } from "react";
import { Modal, BlockStack, Text, Button } from "@shopify/polaris";
import type { OnboardingResult } from "@/lib/onboarding/recompute";

const SESSION_KEY = "cl:welcome_shown";
const FRESH_INSTALL_MS = 5 * 60 * 1000; // 5 minutes

interface Props {
  onboardingResult: OnboardingResult | null;
  onStart: () => void;
}

export function WelcomeModal({ onboardingResult, onStart }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!onboardingResult) return;

    const { state, completedCount } = onboardingResult;

    // Already completed steps — no modal
    if (completedCount > 0) {
      console.log("[PRD-4:WelcomeModal] skipping — completedCount=%d", completedCount);
      return;
    }

    // Already dismissed server-side
    if (state.dismissedAt) {
      console.log("[PRD-4:WelcomeModal] skipping — server dismissedAt set");
      return;
    }

    // Already shown in this session
    if (typeof window !== "undefined" && sessionStorage.getItem(SESSION_KEY) === "1") {
      console.log("[PRD-4:WelcomeModal] skipping — already shown in session");
      return;
    }

    // Only show within the first 5 minutes of install
    const freshInstall = Date.now() - new Date(state.startedAt).getTime() < FRESH_INSTALL_MS;
    if (!freshInstall) {
      console.log("[PRD-4:WelcomeModal] skipping — install too old startedAt=%s", state.startedAt);
      return;
    }

    console.log("[PRD-4:WelcomeModal] showing modal shopId=%s", state.shopId);
    setOpen(true);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SESSION_KEY, "1");
    }
  }, [onboardingResult]);

  function handleClose() {
    console.log("[PRD-4:WelcomeModal] closed (dismiss)");
    setOpen(false);
  }

  function handleStart() {
    console.log("[PRD-4:WelcomeModal] start clicked");
    setOpen(false);
    onStart();
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Welcome to Checkout Lens"
      primaryAction={{
        content: "Show me how to set up",
        onAction: handleStart,
      }}
      secondaryActions={[
        {
          content: "Maybe later",
          onAction: handleClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd">
            Track every coupon attempt and recover lost checkouts — automatically.
          </Text>
          {/* Video: user supplies real asset at public/onboarding/recovery-demo.mp4 */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            autoPlay
            loop
            muted
            playsInline
            src="/onboarding/recovery-demo.mp4"
            poster="/onboarding/recovery-demo.jpg"
            style={{ width: "100%", borderRadius: 8 }}
            aria-label="Demo of a customer claiming a recovery discount code at checkout"
          />
          <Text as="p" variant="bodySm" tone="subdued">
            Watch a customer claim a recovery code in checkout.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
