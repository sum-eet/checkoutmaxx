import { NextRequest, NextResponse } from "next/server";

// Cron endpoint — protected by CRON_SECRET (Guardrail #10)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Phase 2 implementation — stub returns 200 so Vercel cron doesn't error
  return NextResponse.json({ ok: true, message: "Weekly digest — Phase 2" });
}
