"use client";

import { AppProvider } from "@shopify/polaris";
import { NavMenu } from "@shopify/app-bridge-react";
import en from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";
import { useShop } from "@/hooks/useShop";

function LiveBanner() {
  const shop = useShop();
  const displayName = shop ? shop.replace(".myshopify.com", "") : "…";

  return (
    <>
      <style>{`
        @keyframes livePulse {
          0%   { box-shadow: 0 0 0 0 rgba(0,127,95,.6); }
          70%  { box-shadow: 0 0 0 7px rgba(0,127,95,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,127,95,0); }
        }
        .live-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #007f5f; display: inline-block; flex-shrink: 0;
          animation: livePulse 2s ease-in-out infinite;
        }
      `}</style>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "6px 20px", background: "#f6f6f7",
        borderBottom: "1px solid #e1e3e5", fontSize: 12, color: "#6d7175",
      }}>
        <span className="live-dot" />
        <span>Live · {displayName}</span>
      </div>
    </>
  );
}

export default function EmbeddedLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider i18n={en}>
      <NavMenu>
        <a href="/dashboard/converted" rel="home">Converted Carts</a>
        <a href="/dashboard/abandoned">Abandoned Carts</a>
        <a href="/alerts">Notifications</a>
        <a href="/settings">Settings</a>
      </NavMenu>
      <LiveBanner />
      {children}
    </AppProvider>
  );
}
