export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";

// Cron endpoint — protected by CRON_SECRET (Guardrail #10)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Dynamic import keeps the alert engine out of the ingest path
    const { evaluateAlerts } = await import("@/lib/alert-engine");
    await evaluateAlerts();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[evaluate-alerts cron]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
