export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { ensureShop } from "@/lib/ensure-shop";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const result = await ensureShop(req);
  if (!result) {
    return NextResponse.json({ active: false });
  }

  // Check if the shop needs OAuth (has pending token)
  const { data: shop } = await supabase
    .from("Shop")
    .select("accessToken")
    .eq("id", result.shopId)
    .single();

  const needsAuth = !shop?.accessToken || shop.accessToken === "pending_oauth";
  const authUrl = needsAuth
    ? `/api/auth/begin?shop=${encodeURIComponent(result.shopDomain)}`
    : undefined;

  console.log("[shop-status]", result.shopDomain, "needsAuth:", needsAuth);

  return NextResponse.json({ active: true, needsAuth, authUrl });
}
