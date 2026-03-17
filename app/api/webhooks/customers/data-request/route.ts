export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/verifyWebhookHmac";

// Shopify GDPR: customers/data_request
// A customer has requested their data. Since CouponMaxx stores checkout
// events (anonymous session data) and not PII beyond what the merchant
// already holds, we acknowledge the request. Merchants must fulfil the
// actual data export themselves via Shopify admin.
export async function POST(req: NextRequest) {
  const verified = await verifyWebhookHmac(req);
  if (!verified) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = verified.body as Record<string, unknown>;
    console.log("[webhook] customers/data_request", JSON.stringify(body));
    // We acknowledge. The merchant is responsible for customer data exports.
    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
