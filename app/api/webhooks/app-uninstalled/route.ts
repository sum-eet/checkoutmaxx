export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabase } from "@/lib/supabase";

function ok() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  console.log("[UNINSTALL] ====== WEBHOOK ======");

  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) return ok();

  const rawBody = await req.text();
  const secret = process.env.SHOPIFY_API_SECRET!;
  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  const aBuf = Buffer.from(computed);
  const bBuf = Buffer.from(hmacHeader);
  if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
    console.error("[UNINSTALL] HMAC MISMATCH");
    return ok();
  }

  let body: any;
  try { body = JSON.parse(rawBody); } catch { return ok(); }

  const shopDomain = (body?.domain || body?.myshopify_domain) as string | undefined;
  if (!shopDomain) return ok();

  const triggeredAtHeader = req.headers.get("x-shopify-triggered-at");
  const triggered = triggeredAtHeader ? new Date(triggeredAtHeader) : new Date();
  console.log("[UNINSTALL] shop=%s triggered=%s", shopDomain, triggered.toISOString());

  const { data: row, error: selErr } = await supabase
    .from("Shop")
    .select("id, installedAt")
    .eq("shopDomain", shopDomain)
    .maybeSingle();

  if (selErr) {
    console.error("[UNINSTALL] SELECT failed", selErr.message);
    return ok();
  }
  if (!row) {
    console.log("[UNINSTALL] no row for %s", shopDomain);
    return ok();
  }

  if (new Date(row.installedAt) > triggered) {
    console.log("[UNINSTALL] stale webhook — installedAt(%s) > triggered(%s), skip",
      row.installedAt, triggered.toISOString());
    return ok();
  }

  const { error: updErr } = await supabase
    .from("Shop")
    .update({
      isActive: false,
      accessToken: null,
      pixelId: null,
      uninstalledAt: triggered.toISOString(),
    })
    .eq("id", row.id);

  if (updErr) console.error("[UNINSTALL] UPDATE failed", updErr.message);
  else console.log("[UNINSTALL] deactivated id=%s", row.id);

  return ok();
}
