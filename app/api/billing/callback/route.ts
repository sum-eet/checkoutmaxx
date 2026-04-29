export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";

// Billing disabled — CouponMaxx is free. Dormant for v1.1 reactivation.
// Original implementation in git history at commit b33c3a2 / lib/billing.ts.
export async function GET(req: NextRequest) {
  console.log("[billing/callback] GATED — billing disabled, redirect to sessions. shop=%s",
    req.nextUrl.searchParams.get("shop"));
  return NextResponse.redirect(new URL("/couponmaxx/sessions", req.url));
}
