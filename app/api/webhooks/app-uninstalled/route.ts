export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { supabase } from "@/lib/supabase";
import { deregisterAppPixel } from "@/lib/pixel-registration";

export async function POST(req: NextRequest) {
  console.log("[UNINSTALL] ====== WEBHOOK HIT ======");

  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) {
    console.error("[UNINSTALL] NO HMAC HEADER");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.text();
  const { createHmac } = await import("crypto");
  const secret = process.env.SHOPIFY_API_SECRET!;
  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  if (computed !== hmacHeader) {
    console.error("[UNINSTALL] HMAC MISMATCH");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("[UNINSTALL] INVALID JSON BODY");
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const shop = (body?.domain || body?.myshopify_domain) as string | undefined;
  if (!shop) {
    console.error("[UNINSTALL] NO SHOP DOMAIN IN PAYLOAD");
    return NextResponse.json({ error: "Missing shop" }, { status: 400 });
  }

  console.log("[UNINSTALL] STEP 1 VERIFIED:", shop);

  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: shop },
    select: { id: true, pixelId: true, accessToken: true },
  });

  if (!shopRecord) {
    console.log("[UNINSTALL] No shop record found for:", shop, "— nothing to do");
    return NextResponse.json({ ok: true });
  }

  console.log("[UNINSTALL] STEP 2 FOUND SHOP:", shopRecord.id);

  if (shopRecord.pixelId && shopRecord.accessToken) {
    try {
      await deregisterAppPixel(shop, shopRecord.accessToken, shopRecord.pixelId);
      console.log("[UNINSTALL] STEP 3 PIXEL DEREGISTERED");
    } catch (err: any) {
      console.error("[UNINSTALL] STEP 3 PIXEL DEREGISTER FAILED:", err.message);
    }
  } else {
    console.log("[UNINSTALL] STEP 3 NO PIXEL TO DEREGISTER");
  }

  const shopId = shopRecord.id;
  try {
    await Promise.all([
      supabase.from("CartEvent").delete().eq("shopId", shopId),
      supabase.from("CheckoutEvent").delete().eq("shopId", shopId),
      supabase.from("AlertLog").delete().eq("shopId", shopId),
      supabase.from("Baseline").delete().eq("shopId", shopId),
    ]);
    console.log("[UNINSTALL] STEP 4 CHILD RECORDS DELETED");
  } catch (err: any) {
    console.error("[UNINSTALL] STEP 4 CHILD DELETE ERROR:", err.message);
  }

  try {
    await prisma.shop.delete({ where: { id: shopId } });
    console.log("[UNINSTALL] STEP 5 SHOP ROW DELETED:", shop);
  } catch (err: any) {
    console.error("[UNINSTALL] STEP 5 SHOP DELETE FAILED:", err.message);
    try {
      await prisma.shop.update({
        where: { id: shopId },
        data: { isActive: false, pixelId: null },
      });
      console.log("[UNINSTALL] STEP 5 FALLBACK: soft deleted");
    } catch {}
  }

  try {
    await prisma.session.delete({ where: { id: `offline_${shop}` } });
    console.log("[UNINSTALL] STEP 6 SESSION DELETED");
  } catch (err: any) {
    console.log("[UNINSTALL] STEP 6 SESSION DELETE SKIPPED:", err.message);
  }

  console.log("[UNINSTALL] ====== DONE ======");
  return NextResponse.json({ ok: true });
}
