export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { shopify, sessionStorage } from "@/lib/shopify";
import { createSubscription } from "@/lib/billing";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  console.log("[billing/create] START");

  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) {
    console.error("[billing/create] BAIL: missing shop param");
    return NextResponse.json({ error: "Missing shop" }, { status: 400 });
  }

  const sessionId = shopify.session.getOfflineId(shop);
  const session = await sessionStorage.loadSession(sessionId);
  if (!session?.accessToken) {
    console.error("[billing/create] BAIL: no session for shop=%s", shop);
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }

  const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/billing/callback?shop=${shop}`;
  let confirmationUrl: string;
  try {
    confirmationUrl = await createSubscription(shop, session.accessToken, returnUrl);
  } catch (err: any) {
    console.error("[billing/create] createSubscription failed for shop=%s:", shop, err.message);
    return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 });
  }

  console.log("[billing/create] redirecting to confirmationUrl (%dms)", Date.now() - t0);
  return NextResponse.redirect(confirmationUrl);
}
