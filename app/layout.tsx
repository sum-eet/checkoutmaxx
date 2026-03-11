import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CheckoutMaxx",
  description: "Checkout monitoring and alerts for Shopify stores",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* App Bridge — required for ui-nav-menu and other embedded app components */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key="0a60bbe935cef2f46838acec2b3918d8" />
      </head>
      <body>{children}</body>
    </html>
  );
}
