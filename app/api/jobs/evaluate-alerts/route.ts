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

    // Ping healthchecks.io heartbeat — signals cron ran successfully
    const hcUrl = process.env.HEALTHCHECKS_PING_URL;
    if (hcUrl) {
      fetch(hcUrl).catch(() => {}); // fire and forget, never block
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[evaluate-alerts cron]", err);

    // Ping healthchecks.io /fail endpoint so it alerts immediately on error
    const hcUrl = process.env.HEALTHCHECKS_PING_URL;
    if (hcUrl) {
      fetch(hcUrl + "/fail").catch(() => {});
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
