import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default async function RootPage({
  searchParams,
}: {
  searchParams: { shop?: string; host?: string; [key: string]: string | undefined };
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  const shop = searchParams.shop;

  // If we have a shop domain, check if it needs OAuth
  if (shop) {
    const { data: existing } = await supabase
      .from("Shop")
      .select("accessToken")
      .eq("shopDomain", shop)
      .eq("isActive", true)
      .maybeSingle();

    // No shop record OR pending token → need OAuth
    if (!existing || existing.accessToken === "pending_oauth") {
      console.log("[root] Redirecting to OAuth — shop:", shop, "exists:", !!existing);
      redirect(`/api/auth/begin?${qs}`);
    }
  }

  // Shop has real token (or no shop param) → go to dashboard
  redirect(`/couponmaxx/analytics${qs ? `?${qs}` : ""}`);
}
