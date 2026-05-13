"use client";

/**
 * PRD-4 §5.2 — Setup guide card shown at top of every embedded page until allComplete.
 * Polls /onboarding/state every 10s. Hard cap: 5min polling timeout.
 * Session-dismiss: sessionStorage cl:setup_dismissed — hides for tab session only.
 */

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Icon,
  ProgressBar,
  Spinner,
  Badge,
} from "@shopify/polaris";
import { CheckCircleIcon, CircleIcon } from "@shopify/polaris-icons";
import type { OnboardingResult, OnboardingStepResult } from "@/lib/onboarding/recompute";

const SESSION_DISMISSED_KEY = "cl:setup_dismissed";
const POLL_INTERVAL_MS = 10_000;
const POLL_HARD_CAP_MS = 5 * 60 * 1000;

function getSessionToken(): string {
  if (typeof window === "undefined") return "";
  return (window as any).__shopifySessionToken ?? "";
}

async function fetcher(url: string) {
  const token = getSessionToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Separate polling hook for diagnostics/sessions step 3
function useSessionCount(shopDomain: string | null, shouldPoll: boolean) {
  const [count, setCount] = useState<number | null>(null);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const hardCapRef = useRef<NodeJS.Timeout | null>(null);

  // Hard cap — stop after 5min
  useEffect(() => {
    if (!shouldPoll) return;
    setPolling(true);
    hardCapRef.current = setTimeout(() => {
      console.log("[PRD-4:SetupGuide] diagnostics hard cap reached — stopping poll");
      setPolling(false);
    }, POLL_HARD_CAP_MS);
    return () => {
      if (hardCapRef.current) clearTimeout(hardCapRef.current);
    };
  }, [shouldPoll]);

  const { data, error } = useSWR<{ count: number; lastSeenAt: string | null }>(
    polling ? "/api/checkoutlens/diagnostics/sessions?window=1h" : null,
    fetcher,
    { refreshInterval: POLL_INTERVAL_MS, revalidateOnFocus: false }
  );

  useEffect(() => {
    if (data) {
      console.log("[PRD-4:SetupGuide] diagnostics count=%d", data.count);
      setCount(data.count);
      setLastSeenAt(data.lastSeenAt ?? null);
      if (data.count >= 1) {
        console.log("[PRD-4:SetupGuide] step 3 satisfied — stopping poll");
        setPolling(false);
        if (hardCapRef.current) clearTimeout(hardCapRef.current);
      }
    }
    if (error) {
      console.error("[PRD-4:SetupGuide] diagnostics error", error.message ?? error);
    }
  }, [data, error]);

  return { count, lastSeenAt, polling };
}

interface Props {
  /** Optional: initial server-fetched result. SWR will keep it fresh. */
  initialResult?: OnboardingResult | null;
}

export function SetupGuide({ initialResult }: Props) {
  // Client-side session dismiss
  const [sessionDismissed, setSessionDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(SESSION_DISMISSED_KEY) === "1") {
      console.log("[PRD-4:SetupGuide] session dismissed — hidden");
      setSessionDismissed(true);
    }
  }, []);

  // Poll onboarding state
  const { data, mutate } = useSWR<OnboardingResult>(
    "/api/checkoutlens/onboarding/state",
    fetcher,
    {
      fallbackData: initialResult ?? undefined,
      refreshInterval: POLL_INTERVAL_MS,
      revalidateOnFocus: true,
    }
  );

  const result = data ?? initialResult;

  // Step 3 diagnostic polling — only when step3 is null and not session-dismissed
  const step3Incomplete = !result?.steps.find((s) => s.key === "data")?.completedAt;
  const { count: sessionCount, lastSeenAt, polling: diagnosticsPolling } = useSessionCount(
    null,
    !sessionDismissed && !!result && step3Incomplete
  );

  if (!result) return null;
  if (result.allComplete) {
    console.log("[PRD-4:SetupGuide] allComplete — not rendering");
    return null;
  }
  if (sessionDismissed) return null;

  const { steps, completedCount, totalSteps, isPlus } = result;
  const progress = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  function handleDismissSession() {
    console.log("[PRD-4:SetupGuide] session dismiss");
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SESSION_DISMISSED_KEY, "1");
    }
    setSessionDismissed(true);
  }

  async function handleReinstallPixel() {
    console.log("[PRD-4:SetupGuide] reinstallPixel clicked");
    try {
      const token = getSessionToken();
      const res = await fetch("/api/pixel/register", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log("[PRD-4:SetupGuide] pixel reinstall requested");
      // Trigger recompute
      await fetch("/api/checkoutlens/onboarding/recompute", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      mutate();
    } catch (err: any) {
      console.error("[PRD-4:SetupGuide] reinstallPixel error", err.message);
    }
  }

  return (
    <Card>
      <BlockStack gap="400">
        {/* Header row */}
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Finish setting up
          </Text>
          <Button variant="plain" onClick={handleDismissSession}>
            Dismiss
          </Button>
        </InlineStack>

        {/* Progress bar */}
        <ProgressBar progress={progress} size="small" tone="primary" />
        <Text as="p" variant="bodySm" tone="subdued">
          {completedCount} of {totalSteps} steps complete
        </Text>

        {/* Steps */}
        <BlockStack gap="300">
          {steps.map((step) => (
            <StepRow
              key={step.key}
              step={step}
              sessionCount={step.key === "data" ? sessionCount : null}
              diagnosticsPolling={step.key === "data" ? diagnosticsPolling : false}
              onReinstallPixel={step.key === "pixel" ? handleReinstallPixel : undefined}
            />
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// StepRow
// ---------------------------------------------------------------------------

interface StepRowProps {
  step: OnboardingStepResult;
  sessionCount: number | null;
  diagnosticsPolling: boolean;
  onReinstallPixel?: () => void;
}

function StepRow({ step, sessionCount, diagnosticsPolling, onReinstallPixel }: StepRowProps) {
  const completed = step.completedAt !== null;

  // Override for step "data": show real count
  const isDataStep = step.key === "data";
  const dataStepCompleted = isDataStep && sessionCount !== null && sessionCount >= 1;
  const effectiveCompleted = completed || dataStepCompleted;

  return (
    <InlineStack gap="300" blockAlign="start">
      {/* Status icon */}
      <div style={{ flexShrink: 0, paddingTop: 2 }}>
        <Icon
          source={effectiveCompleted ? CheckCircleIcon : CircleIcon}
          tone={effectiveCompleted ? "success" : "subdued"}
        />
      </div>

      {/* Content */}
      <BlockStack gap="100" inlineSize="grow">
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {step.title}
          </Text>
          {effectiveCompleted && (
            <Badge tone="success">Done</Badge>
          )}
        </InlineStack>

        {!effectiveCompleted && (
          <Text as="p" variant="bodySm" tone="subdued">
            {step.description}
          </Text>
        )}

        {/* Step 3 real-time count */}
        {isDataStep && !effectiveCompleted && (
          <InlineStack gap="200" blockAlign="center">
            {diagnosticsPolling ? (
              <>
                <Spinner accessibilityLabel="Waiting for first session" size="small" />
                <Text as="span" variant="bodySm" tone="subdued">
                  Waiting for first session… Visit your store to see data here.
                </Text>
              </>
            ) : sessionCount !== null && sessionCount === 0 ? (
              <Text as="span" variant="bodySm" tone="subdued">
                No sessions yet. Visit your store and add something to the cart.
              </Text>
            ) : null}
          </InlineStack>
        )}

        {isDataStep && dataStepCompleted && sessionCount !== null && (
          <Text as="p" variant="bodySm" tone="success">
            {sessionCount} session{sessionCount === 1 ? "" : "s"} in the last hour.
          </Text>
        )}
      </BlockStack>

      {/* CTA button */}
      {!effectiveCompleted && (
        <div style={{ flexShrink: 0 }}>
          {step.action === "reinstallPixel" ? (
            <Button onClick={onReinstallPixel} variant="secondary" size="slim">
              {step.cta}
            </Button>
          ) : step.url ? (
            <Button
              url={step.url}
              external={step.external ?? false}
              variant="secondary"
              size="slim"
            >
              {step.cta}
            </Button>
          ) : null}
        </div>
      )}
    </InlineStack>
  );
}
