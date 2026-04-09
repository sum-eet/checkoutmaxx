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

  // Find the ACTIVE shop record for this domain
  const { data: shopRecord } = await supabase
    .from("Shop")
    .select("id, pixelId, accessToken")
    .eq("shopDomain", shop)
    .eq("isActive", true)
    .maybeSingle();

  if (!shopRecord) {
    console.log("[UNINSTALL] No active shop record found for:", shop, "— nothing to do");
    return NextResponse.json({ ok: true });
  }

  console.log("[UNINSTALL] STEP 2 FOUND SHOP:", shopRecord.id);

  // Deregister pixel with Shopify (cleanup)
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

  // SOFT DELETE — mark inactive, keep ALL data (CartEvent, CheckoutEvent, etc.)
  // Next install will create a NEW Shop record with a fresh cuid.
  const { error: updateError } = await supabase
    .from("Shop")
    .update({ isActive: false, pixelId: null })
    .eq("id", shopRecord.id);

  if (updateError) {
    console.error("[UNINSTALL] STEP 4 SOFT DELETE FAILED:", updateError.message);
  } else {
    console.log("[UNINSTALL] STEP 4 SHOP SOFT DELETED:", shopRecord.id);
  }

  // Delete the session — not needed after uninstall
  try {
    await prisma.session.delete({ where: { id: `offline_${shop}` } });
    console.log("[UNINSTALL] STEP 5 SESSION DELETED");
  } catch (err: any) {
    console.log("[UNINSTALL] STEP 5 SESSION DELETE SKIPPED:", err.message);
  }

  console.log("[UNINSTALL] ====== DONE ======");
  return NextResponse.json({ ok: true });
}
