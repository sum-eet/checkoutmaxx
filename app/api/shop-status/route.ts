export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { ensureShop } from "@/lib/ensure-shop";

export async function GET(req: NextRequest) {
  const result = await ensureShop(req);
  console.log("[shop-status]", result ? `active shopId=${result.shopId}` : "no shop");
  return NextResponse.json({ active: !!result });
}
