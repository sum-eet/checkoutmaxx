export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getShop } from "@/lib/shop";

export async function POST(req: NextRequest) {
  console.log("[billing/webhook] ====== APP_SUBSCRIPTIONS_UPDATE HIT ======");

  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) {
    console.error("[billing/webhook] NO HMAC HEADER");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.text();
  const { createHmac } = await import("crypto");
  const secret = process.env.SHOPIFY_API_SECRET!;
  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  if (computed !== hmacHeader) {
    console.error("[billing/webhook] HMAC MISMATCH");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("[billing/webhook] INVALID JSON BODY");
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Payload: { app_subscription: { status, name, ... }, shop_domain: "..." }
  const shop = body?.shop_domain as string | undefined;
  const status = body?.app_subscription?.status as string | undefined;

  if (!shop || !status) {
    console.error("[billing/webhook] MISSING FIELDS: shop=%s status=%s", shop, status);
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  console.log("[billing/webhook] shop=%s status=%s", shop, status);

  const activeShop = await getShop(shop);
  if (!activeShop) {
    console.error("[billing/webhook] active shop not found:", shop);
    return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  }

  const updatePayload: Record<string, string | null> =
    status === "ACTIVE"
      ? { subscriptionStatus: "ACTIVE", billingPlan: "pro" }
      : status === "DECLINED" || status === "EXPIRED" || status === "CANCELLED"
      ? { subscriptionStatus: status, billingPlan: "free" }
      : { subscriptionStatus: status };

  const { error: updateErr } = await supabase
    .from("Shop")
    .update(updatePayload)
    .eq("id", activeShop.id);

  if (updateErr) {
    console.error("[billing/webhook] DB update failed:", updateErr.message);
    return NextResponse.json({ error: "DB update failed" }, { status: 500 });
  }

  console.log("[billing/webhook] ====== DONE: shop=%s status=%s ======", shop, status);
  return NextResponse.json({ ok: true });
}
