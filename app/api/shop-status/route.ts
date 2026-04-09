export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { ensureShop } from "@/lib/ensure-shop";

export async function GET(req: NextRequest) {
  const result = await ensureShop(req);
  return NextResponse.json({ active: !!result });
}
