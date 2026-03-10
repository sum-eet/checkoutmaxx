"use client";

import { AppProvider, Frame, Navigation } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";
import { usePathname, useRouter } from "next/navigation";
import { useShop } from "@/hooks/useShop";

function NavWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const shop = useShop();

  function nav(path: string) {
    const url = shop ? `${path}?shop=${shop}` : path;
    router.push(url);
  }

  const navMarkup = (
    <Navigation location={pathname}>
      <Navigation.Section
        items={[
          {
            label: "Monitor",
            url: "#",
            onClick: () => nav("/dashboard"),
            selected: pathname.startsWith("/dashboard"),
          },
          {
            label: "Alerts",
            url: "#",
            onClick: () => nav("/alerts"),
            selected: pathname.startsWith("/alerts"),
          },
          {
            label: "Settings",
            url: "#",
            onClick: () => nav("/settings"),
            selected: pathname.startsWith("/settings"),
          },
        ]}
      />
    </Navigation>
  );

  return <Frame navigation={navMarkup}>{children}</Frame>;
}

export default function EmbeddedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider i18n={en}>
      <NavWrapper>{children}</NavWrapper>
    </AppProvider>
  );
}
