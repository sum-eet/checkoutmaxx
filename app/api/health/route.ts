export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`;
  return `${Math.round(seconds / 3600)} hours ago`;
}

export async function GET() {
  const now = new Date();
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  const [supabaseCheck, lastCartEvent, lastCheckoutEvent, recentFailures] =
    await Promise.allSettled([
      supabase.from("Shop").select("id").limit(1),
      supabase
        .from("CartEvent")
        .select("occurredAt")
        .order("occurredAt", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("CheckoutEvent")
        .select("occurredAt")
        .order("occurredAt", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("IngestLog")
        .select("*", { count: "exact", head: true })
        .eq("success", false)
        .gte("occurredAt", oneHourAgo),
    ]);

  // Check 1: Can we reach Supabase?
  const supabaseOk =
    supabaseCheck.status === "fulfilled" && !supabaseCheck.value.error;

  if (!supabaseOk) {
    return NextResponse.json(
      {
        status: "down",
        checks: { supabase: false },
        timestamp: now.toISOString(),
      },
      { status: 503 }
    );
  }

  // Check 2: Last CartEvent timestamp
  const lastCart =
    lastCartEvent.status === "fulfilled"
      ? (lastCartEvent.value.data?.occurredAt ?? null)
      : null;

  // Check 3: Last CheckoutEvent timestamp
  const lastCheckout =
    lastCheckoutEvent.status === "fulfilled"
      ? (lastCheckoutEvent.value.data?.occurredAt ?? null)
      : null;

  // Check 4: Recent IngestLog failures
  const failureCount =
    recentFailures.status === "fulfilled"
      ? (recentFailures.value.count ?? 0)
      : 0;

  // Degraded conditions
  const cartStale = lastCart ? lastCart < thirtyMinAgo : false;
  const tooManyFailures = failureCount > 5;

  const isDegraded = cartStale || tooManyFailures;
  const status = isDegraded ? "degraded" : "ok";

  return NextResponse.json(
    {
      status,
      checks: {
        supabase: true,
        lastCartEvent: lastCart ? timeAgo(lastCart) : "no data",
        lastCheckoutEvent: lastCheckout ? timeAgo(lastCheckout) : "no data",
        recentFailures: failureCount,
      },
      timestamp: now.toISOString(),
    },
    { status: 200 }
  );
}
