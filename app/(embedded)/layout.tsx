"use client";

import { AppProvider as PolarisProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";

export default function EmbeddedLayout({ children }: { children: React.ReactNode }) {
  return <PolarisProvider i18n={en}>{children}</PolarisProvider>;
}
