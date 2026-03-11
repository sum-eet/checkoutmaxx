"use client";

import { AppProvider, Frame, Navigation, Box, BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";
import { usePathname, useRouter } from "next/navigation";
import { useShop } from "@/hooks/useShop";
import { useState, useEffect } from "react";

function NavWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const shop = useShop();
  const [unresolvedCount, setUnresolvedCount] = useState(0);

  useEffect(() => {
    if (!shop) return;
    fetch(`/api/alerts?shop=${shop}&tab=active`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setUnresolvedCount(data.length);
      })
      .catch(() => {});
  }, [shop]);

  function nav(path: string) {
    const url = shop ? `${path}?shop=${shop}` : path;
    router.push(url);
  }

  const navMarkup = (
    <Navigation location={pathname}>
      <Navigation.Section
        items={[
          {
            label: "Converted Carts",
            url: "#",
            onClick: () => nav("/dashboard/converted"),
            selected: pathname.startsWith("/dashboard/converted"),
          },
          {
            label: "Abandoned Carts",
            url: "#",
            onClick: () => nav("/dashboard/abandoned"),
            selected: pathname.startsWith("/dashboard/abandoned"),
          },
          {
            label: "Notifications",
            url: "#",
            onClick: () => nav("/alerts"),
            selected: pathname.startsWith("/alerts"),
            badge: unresolvedCount > 0 ? String(unresolvedCount) : undefined,
          },
          {
            label: "Settings",
            url: "#",
            onClick: () => nav("/settings"),
            selected: pathname.startsWith("/settings"),
          },
        ]}
      />
      <Box padding="400" borderBlockStartWidth="025" borderColor="border">
        <BlockStack gap="100">
          <InlineStack gap="200" blockAlign="center">
            <span className="pulse-dot" />
            <Text as="span" tone="subdued" variant="bodySm">Pixel active</Text>
          </InlineStack>
          <Text as="p" tone="subdued" variant="bodySm">{shop || "loading..."}</Text>
        </BlockStack>
      </Box>
    </Navigation>
  );

  return (
    <>
      <style>{`
        .pulse-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #007f5f; display: inline-block;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%   { box-shadow: 0 0 0 0 rgba(0,127,95,.5); }
          70%  { box-shadow: 0 0 0 8px rgba(0,127,95,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,127,95,0); }
        }
      `}</style>
      <Frame navigation={navMarkup}>{children}</Frame>
    </>
  );
}

export default function EmbeddedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider i18n={en}>
      <NavWrapper>{children}</NavWrapper>
    </AppProvider>
  );
}
