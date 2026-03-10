import { redirect } from "next/navigation";

export default function RootPage({
  searchParams,
}: {
  searchParams: { shop?: string; host?: string };
}) {
  const params = new URLSearchParams();
  if (searchParams.shop) params.set("shop", searchParams.shop);
  if (searchParams.host) params.set("host", searchParams.host);
  const qs = params.toString();
  redirect(`/dashboard${qs ? `?${qs}` : ""}`);
}
