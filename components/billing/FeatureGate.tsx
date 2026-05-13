"use client";

/**
 * PRD-3 — Client-side feature gate component.
 * Renders children when the shop has access to the feature;
 * renders fallback (or null) otherwise.
 * Always pair with a server-side requireFeature() call.
 */

import { SkeletonBodyText } from "@shopify/polaris";
import { useFeatures } from "@/hooks/useFeatures";

interface FeatureGateProps {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const { has, isLoading } = useFeatures();

  if (isLoading) {
    return <SkeletonBodyText lines={3} />;
  }

  if (!has(feature)) {
    return fallback ? <>{fallback}</> : null;
  }

  return <>{children}</>;
}
