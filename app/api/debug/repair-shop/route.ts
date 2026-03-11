export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * One-time repair: if OAuth completed but the Shop upsert failed,
 * this reads the stored session and creates the missing Shop row.
 *
 * GET /api/debug/repair-shop?shop=jg2svv-pc.myshopify.com
 */
export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) {
    return NextResponse.json({ error: "Missing ?shop= param" }, { status: 400 });
  }

  // 1. Check if Shop row already exists
  const existing = await prisma.shop.findUnique({ where: { shopDomain: shop } });
  if (existing) {
    return NextResponse.json({ status: "already_exists", shop: existing });
  }

  // 2. Find the stored OAuth session
  const session = await prisma.session.findFirst({
    where: { shop },
    orderBy: { id: "desc" },
  });

  if (!session) {
    return NextResponse.json({
      status: "no_session",
      message: "OAuth never completed — no session found for this shop. Must reinstall.",
    });
  }

  if (!session.accessToken) {
    return NextResponse.json({
      status: "session_no_token",
      message: "Session found but no access token. Must reinstall.",
      sessionId: session.id,
    });
  }

  // 3. Create the Shop row from the existing session
  try {
    const created = await prisma.shop.create({
      data: {
        shopDomain: shop,
        accessToken: session.accessToken,
        isActive: true,
      },
    });
    return NextResponse.json({ status: "created", shop: created });
  } catch (err: any) {
    return NextResponse.json(
      { status: "db_error", message: err.message },
      { status: 500 }
    );
  }
}
