export const dynamic = "force-dynamic";
export const maxDuration = 10;
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function withTimeout<T>(thenable: PromiseLike<T>, ms: number): Promise<T> {
  return Promise.race([
    Promise.resolve(thenable),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

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

  const [supabaseCheck, lastCartEvent, lastCheckoutEvent, recentFailures, lastCartPing, lastCheckoutPing] =
    await Promise.allSettled([
      withTimeout(supabase.from("Shop").select("id").limit(1), 5000),
      withTimeout(
        supabase
          .from("CartEvent")
          .select("occurredAt")
          .order("occurredAt", { ascending: false })
          .limit(1)
          .maybeSingle(),
        5000
      ),
      withTimeout(
        supabase
          .from("CheckoutEvent")
          .select("occurredAt")
          .order("occurredAt", { ascending: false })
          .limit(1)
          .maybeSingle(),
        5000
      ),
      withTimeout(
        supabase
          .from("IngestLog")
          .select("*", { count: "exact", head: true })
          .eq("success", false)
          .gte("occurredAt", oneHourAgo),
        5000
      ),
      withTimeout(
        supabase
          .from("SessionPing")
          .select("occurredAt")
          .eq("source", "cart")
          .order("occurredAt", { ascending: false })
          .limit(1)
          .maybeSingle(),
        5000
      ),
      withTimeout(
        supabase
          .from("SessionPing")
          .select("occurredAt")
          .eq("source", "checkout")
          .order("occurredAt", { ascending: false })
          .limit(1)
          .maybeSingle(),
        5000
      ),
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

  // Check 5: Last session pings
  const lastCartPingTime =
    lastCartPing.status === "fulfilled"
      ? (lastCartPing.value.data?.occurredAt ?? null)
      : null;

  const lastCheckoutPingTime =
    lastCheckoutPing.status === "fulfilled"
      ? (lastCheckoutPing.value.data?.occurredAt ?? null)
      : null;

  // Status logic based on session ping recency
  const cartPingStale = !lastCartPingTime || lastCartPingTime < oneHourAgo;
  const checkoutPingStale = !lastCheckoutPingTime || lastCheckoutPingTime < oneHourAgo;
  const tooManyFailures = failureCount > 5;

  let status: "ok" | "degraded" | "down";
  if (cartPingStale && checkoutPingStale) {
    status = "down";
  } else if (cartPingStale || checkoutPingStale || tooManyFailures) {
    status = "degraded";
  } else {
    status = "ok";
  }

  return NextResponse.json(
    {
      status,
      checks: {
        supabase: true,
        lastCartEvent: lastCart ? timeAgo(lastCart) : "no data",
        lastCheckoutEvent: lastCheckout ? timeAgo(lastCheckout) : "no data",
        recentFailures: failureCount,
        lastCartSessionPing: lastCartPingTime ?? null,
        lastCheckoutSessionPing: lastCheckoutPingTime ?? null,
      },
      timestamp: now.toISOString(),
    },
    { status: 200 }
  );
}
