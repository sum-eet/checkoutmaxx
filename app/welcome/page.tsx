import { redirect } from "next/navigation";

export default function WelcomePage({
  searchParams,
}: {
  searchParams: { shop?: string; host?: string; [key: string]: string | undefined };
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  redirect(`/couponmaxx/analytics${qs ? `?${qs}` : ""}`);
}
