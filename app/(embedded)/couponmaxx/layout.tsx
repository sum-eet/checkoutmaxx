"use client";

export default function CouponMaxxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "20px 24px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>{children}</div>
    </div>
  );
}
