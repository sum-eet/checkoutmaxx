export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");

  if (!shop) {
    return new Response("Missing shop param", { status: 400 });
  }

  console.log("[auth/begin] shop:", shop);

  const apiKey = process.env.SHOPIFY_API_KEY!;
  const scopes = "read_orders,read_checkouts,write_pixels,read_customer_events,read_analytics";
  const redirectUri = `${process.env.SHOPIFY_APP_URL}/api/auth/callback`;
  const state = crypto.randomBytes(8).toString("hex");

  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;

  console.log("[auth/begin] redirecting to Shopify OAuth:", installUrl);
  return NextResponse.redirect(installUrl);
}
