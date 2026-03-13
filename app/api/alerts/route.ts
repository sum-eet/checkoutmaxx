export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get("shop");
  const tab = req.nextUrl.searchParams.get("tab") || "active";

  if (!shopDomain) return NextResponse.json({ error: "Missing shop" }, { status: 400 });

  const { data: shop } = await supabase.from("Shop").select("id").eq("shopDomain", shopDomain).single();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  if (tab === "active") {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: alerts } = await supabase
      .from("AlertLog")
      .select("id, alertType, severity, title, body, actionUrl, actionLabel, sentEmail, sentSlack, firedAt")
      .eq("shopId", shop.id)
      .is("resolvedAt", null)
      .gte("firedAt", twoHoursAgo)
      .order("firedAt", { ascending: false });
    return NextResponse.json(alerts ?? []);
  }

  // history tab
  const { data: alerts } = await supabase
    .from("AlertLog")
    .select("id, alertType, title, sentEmail, sentSlack, firedAt, resolvedAt, roiEstimatedUsd")
    .eq("shopId", shop.id)
    .order("firedAt", { ascending: false })
    .limit(50);
  return NextResponse.json(alerts ?? []);
}
