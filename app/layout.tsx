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
      <body>{children}</body>
    </html>
  );
}
