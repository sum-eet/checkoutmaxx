export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { sendSlackMessage } from "@/lib/send-slack";

export async function POST(req: NextRequest) {
  let body: { shop?: string; webhookUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { shop, webhookUrl } = body;
  if (!shop || !webhookUrl) {
    return NextResponse.json({ error: "Missing shop or webhookUrl" }, { status: 400 });
  }

  try {
    await sendSlackMessage({
      webhookUrl,
      title: "CouponMaxx test message",
      body: "This is a test notification from CouponMaxx. Your Slack integration is working correctly.",
      shopDomain: shop,
    });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
