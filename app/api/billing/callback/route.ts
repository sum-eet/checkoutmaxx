export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { shopify, sessionStorage } from "@/lib/shopify";
import { getActiveSubscription } from "@/lib/billing";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  console.log("[billing/callback] START");

  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) {
    console.error("[billing/callback] BAIL: missing shop param");
    return NextResponse.redirect(new URL("/couponmaxx/analytics", req.url));
  }

  const sessionId = shopify.session.getOfflineId(shop);
  const session = await sessionStorage.loadSession(sessionId);
  if (!session?.accessToken) {
    console.error("[billing/callback] BAIL: no session for shop=%s", shop);
    return NextResponse.redirect(new URL(`/couponmaxx/analytics?shop=${shop}`, req.url));
  }

  let sub: { id: string; status: string } | null = null;
  try {
    sub = await getActiveSubscription(shop, session.accessToken);
  } catch (err: any) {
    console.error("[billing/callback] getActiveSubscription failed:", err.message);
  }
  console.log("[billing/callback] sub=%s status=%s (%dms)", sub?.id ?? "NULL", sub?.status ?? "NULL", Date.now() - t0);

  if (sub?.status === "ACTIVE") {
    const { error: updateErr } = await supabase
      .from("Shop")
      .update({
        subscriptionStatus: "ACTIVE",
        billingPlan: "pro",
        // trialEndsAt is managed by Shopify — do not set it manually here
      })
      .eq("shopDomain", shop)
      .eq("isActive", true);
    if (updateErr) console.error("[billing/callback] DB update ACTIVE failed:", updateErr.message);
    console.log("[billing/callback] ACTIVE: shop=%s (%dms)", shop, Date.now() - t0);
    return NextResponse.redirect(new URL(`/couponmaxx/analytics?shop=${shop}`, req.url));
  } else {
    const { error: updateErr } = await supabase
      .from("Shop")
      .update({ subscriptionStatus: "DECLINED", billingPlan: "free" })
      .eq("shopDomain", shop)
      .eq("isActive", true);
    if (updateErr) console.error("[billing/callback] DB update DECLINED failed:", updateErr.message);
    console.log("[billing/callback] DECLINED: shop=%s (%dms)", shop, Date.now() - t0);
    return NextResponse.redirect(
      new URL(`/couponmaxx/analytics?billing=declined&shop=${shop}`, req.url)
    );
  }
}
