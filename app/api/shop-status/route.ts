export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { ensureShop } from "@/lib/ensure-shop";

export async function GET(req: NextRequest) {
  console.log("[shop-status] ====== HIT ======");
  console.log("[shop-status] URL:", req.url.slice(0, 300));
  console.log("[shop-status] id_token present:", !!req.nextUrl.searchParams.get("id_token"));
  console.log("[shop-status] shop param:", req.nextUrl.searchParams.get("shop"));

  const result = await ensureShop(req);
  console.log("[shop-status] ensureShop result:", result ? `active shopId=${result.shopId}` : "NULL — shop not provisioned");
  return NextResponse.json({ active: !!result });
}
