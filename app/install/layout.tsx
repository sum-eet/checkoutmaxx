"use client";

import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";

export default function InstallLayout({ children }: { children: React.ReactNode }) {
  return <AppProvider i18n={en}>{children}</AppProvider>;
}
