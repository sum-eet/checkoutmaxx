export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get("shop");
  if (!shopDomain) return NextResponse.json({ error: "Missing shop" }, { status: 400 });

  const { data: shop } = await supabase
    .from("Shop")
    .select("alertEmail, slackWebhookUrl, alertEmailEnabled, alertSlackEnabled, alertAbandonmentEnabled, alertDiscountEnabled, alertExtensionEnabled, alertPaymentEnabled, abandonmentThreshold, discountFailureMin, paymentFailureRate")
    .eq("shopDomain", shopDomain)
    .single();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  return NextResponse.json({
    alertEmail: shop.alertEmail ?? "",
    slackWebhookUrl: shop.slackWebhookUrl ?? "",
    alertEmailEnabled: shop.alertEmailEnabled,
    alertSlackEnabled: shop.alertSlackEnabled,
    alertAbandonmentEnabled: shop.alertAbandonmentEnabled,
    alertDiscountEnabled: shop.alertDiscountEnabled,
    alertExtensionEnabled: shop.alertExtensionEnabled,
    alertPaymentEnabled: shop.alertPaymentEnabled,
    abandonmentThreshold: shop.abandonmentThreshold,
    discountFailureMin: shop.discountFailureMin,
    paymentFailureRate: shop.paymentFailureRate,
  });
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { shop: shopDomain, ...fields } = body as { shop: string } & Record<string, unknown>;
  if (!shopDomain) return NextResponse.json({ error: "Missing shop" }, { status: 400 });

  const allowed = [
    "alertEmail", "slackWebhookUrl", "alertEmailEnabled", "alertSlackEnabled",
    "alertAbandonmentEnabled", "alertDiscountEnabled", "alertExtensionEnabled",
    "alertPaymentEnabled", "abandonmentThreshold", "discountFailureMin", "paymentFailureRate",
  ];

  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in fields) data[key] = fields[key];
  }

  const { error } = await supabase.from("Shop").update(data).eq("shopDomain", shopDomain);
  if (error) {
    console.error("[settings/patch]", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
