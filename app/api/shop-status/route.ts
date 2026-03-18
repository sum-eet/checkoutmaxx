export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getShopFromRequest } from "@/lib/verify-session-token";

export async function GET(req: NextRequest) {
  const shop = getShopFromRequest(req);
  if (!shop) return NextResponse.json({ active: false });

  try {
    const record = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: { isActive: true },
    });
    console.log("[shop-status]", shop, JSON.stringify(record));
    return NextResponse.json({ active: record?.isActive ?? false });
  } catch (err: any) {
    console.error("[shop-status] DB error:", err.message);
    return NextResponse.json({ active: false });
  }
}
