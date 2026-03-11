import { redirect } from "next/navigation";

// Server component — immediate server-side redirect, no JS required
export default function InstallPage({
  searchParams,
}: {
  searchParams: { shop?: string };
}) {
  const shop = searchParams.shop;
  if (shop) {
    redirect(`/api/auth?shop=${encodeURIComponent(shop)}`);
  }
  return <p>Missing shop parameter.</p>;
}
