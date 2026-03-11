export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { shopify, sessionStorage } from "@/lib/shopify";
import { getActiveSubscription } from "@/lib/billing";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) return NextResponse.redirect(new URL("/dashboard/converted", req.url));

  const sessionId = shopify.session.getOfflineId(shop);
  const session = await sessionStorage.loadSession(sessionId);
  if (!session?.accessToken) {
    return NextResponse.redirect(new URL(`/dashboard/converted?shop=${shop}`, req.url));
  }

  const sub = await getActiveSubscription(shop, session.accessToken);

  if (sub?.status === "ACTIVE") {
    await prisma.shop.update({
      where: { shopDomain: shop },
      data: {
        subscriptionStatus: "ACTIVE",
        billingPlan: "pro",
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return NextResponse.redirect(new URL(`/dashboard/converted?shop=${shop}`, req.url));
  } else {
    await prisma.shop.update({
      where: { shopDomain: shop },
      data: { subscriptionStatus: "DECLINED", billingPlan: "free" },
    });
    return NextResponse.redirect(
      new URL(`/dashboard/converted?billing=declined&shop=${shop}`, req.url)
    );
  }
}
