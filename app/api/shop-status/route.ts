export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedShop } from "@/lib/verify-session-token";
import { getShop } from "@/lib/shop";

export async function GET(req: NextRequest) {
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) return NextResponse.json({ active: false });
  const shop = await getShop(shopDomain);
  return NextResponse.json({ active: !!shop });
}
