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

  // Fresh install: shop present but no host = not embedded yet → kick off OAuth.
  // This is a fallback — ensureShop() in API routes also provisions the shop
  // via token exchange, so the app works even if this redirect is bypassed.
  if (searchParams.shop && !searchParams.host) {
    redirect(`/api/auth/begin?${qs}`);
  }

  // Already authenticated (has host) → go to app
  redirect(`/couponmaxx/analytics${qs ? `?${qs}` : ""}`);
}
