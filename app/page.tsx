import { redirect } from "next/navigation";

const APP_URL = process.env.SHOPIFY_APP_URL || "https://couponmaxx.vercel.app";

export default async function RootPage({
  searchParams,
}: {
  searchParams: { shop?: string; host?: string; [key: string]: string | undefined };
}) {
  console.log("!!!! ROOT PAGE HIT — shop:", searchParams.shop, "host:", searchParams.host);

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();

  if (searchParams.shop) {
    try {
      const res = await fetch(`${APP_URL}/api/shop-status?shop=${searchParams.shop}`, { cache: "no-store" });
      const json = await res.json();
      console.log("!!!! ROOT PAGE shop-status:", searchParams.shop, JSON.stringify(json));
      if (!json.active) {
        console.log("!!!! ROOT PAGE — not active, starting OAuth");
        redirect(`/api/auth/begin?${qs}`);
      }
    } catch (err: any) {
      console.error("!!!! ROOT PAGE shop-status error:", err.message);
      redirect(`/api/auth/begin?${qs}`);
    }
  }

  console.log("!!!! ROOT PAGE — shop active, going to analytics");
  redirect(`/couponmaxx/analytics${qs ? `?${qs}` : ""}`);
}
