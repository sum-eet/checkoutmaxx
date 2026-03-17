import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CouponMaxx",
  description: "Coupon analytics and code performance tracking for Shopify stores",
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
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key={process.env.NEXT_PUBLIC_SHOPIFY_API_KEY} />
      </head>
      <body>{children}</body>
    </html>
  );
}
