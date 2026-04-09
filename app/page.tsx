import { redirect } from "next/navigation";

export default function RootPage({
  searchParams,
}: {
  searchParams: { shop?: string; host?: string; [key: string]: string | undefined };
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();

  // Just forward to the dashboard. ensureShop() in API routes handles
  // token exchange and Shop provisioning automatically.
  redirect(`/couponmaxx/analytics${qs ? `?${qs}` : ""}`);
}
