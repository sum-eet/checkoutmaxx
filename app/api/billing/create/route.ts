export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { shopify, sessionStorage } from "@/lib/shopify";
import { createSubscription } from "@/lib/billing";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) return NextResponse.json({ error: "Missing shop" }, { status: 400 });

  const sessionId = shopify.session.getOfflineId(shop);
  const session = await sessionStorage.loadSession(sessionId);
  if (!session?.accessToken) return NextResponse.json({ error: "No session" }, { status: 401 });

  const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/billing/callback?shop=${shop}`;
  const confirmationUrl = await createSubscription(shop, session.accessToken, returnUrl);
  return NextResponse.redirect(confirmationUrl);
}
