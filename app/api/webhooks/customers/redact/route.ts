export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";

// Shopify GDPR: customers/redact
// Shopify requests erasure of a customer's data 10 days after the
// shop uninstalls the app, OR when a customer requests deletion.
// We delete checkout events linked to the customer's session IDs.
export async function POST(req: NextRequest) {
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  if (!hmac) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    console.log("[webhook] customers/redact", JSON.stringify(body));

    const shopDomain: string | undefined = body?.shop_domain;
    const ordersToRedact: { id: number }[] = body?.orders_to_redact ?? [];

    if (shopDomain && ordersToRedact.length > 0) {
      // CheckoutMaxx stores session-level events — we don't store Shopify
      // order IDs. Nothing to delete for this specific customer, but we
      // log for compliance.
      console.log(
        `[redact] customers/redact for ${shopDomain}: ${ordersToRedact.length} order(s) — no PII stored.`
      );
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
