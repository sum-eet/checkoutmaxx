import { redirect } from "next/navigation";

export default async function RootPage({
  searchParams,
}: {
  searchParams: {
    shop?: string;
    host?: string;
    [key: string]: string | undefined;
  };
}) {
  console.log("!!!! ROOT PAGE HIT — shop:", searchParams.shop, "host:", searchParams.host);

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();

  // Fresh install: Shopify sends ?shop=xxx with no host
  // Embedded re-open: Shopify sends ?shop=xxx&host=xxx
  if (searchParams.shop && !searchParams.host) {
    console.log("!!!! ROOT PAGE — fresh install, starting OAuth");
    redirect(`/api/auth/begin?${qs}`);
  }

  console.log("!!!! ROOT PAGE — redirecting to analytics");
  redirect(`/couponmaxx/analytics${qs ? `?${qs}` : ""}`);
}
