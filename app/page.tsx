import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";

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

  if (searchParams.shop) {
    let shopRecord;
    try {
      shopRecord = await prisma.shop.findUnique({
        where: { shopDomain: searchParams.shop },
        select: { isActive: true },
      });
      console.log("!!!! ROOT PAGE DB RESULT — shop:", searchParams.shop, "record:", JSON.stringify(shopRecord));
    } catch (err: any) {
      console.error("!!!! ROOT PAGE DB ERROR:", err.message);
      // DB down — still try OAuth so install can complete
      console.log("!!!! ROOT PAGE — DB error, falling through to auth/begin");
      redirect(`/api/auth/begin?${qs}`);
    }

    if (!shopRecord || !shopRecord.isActive) {
      console.log("!!!! ROOT PAGE — no active shop, redirecting to auth/begin");
      redirect(`/api/auth/begin?${qs}`);
    }
  }

  // Installed → go to app
  console.log("!!!! ROOT PAGE — shop active, redirecting to analytics");
  redirect(`/couponmaxx/analytics${qs ? `?${qs}` : ""}`);
}
