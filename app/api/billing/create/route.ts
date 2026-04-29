export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";

// Billing disabled — CouponMaxx is free. Dormant for v1.1 reactivation.
// Original implementation in git history at commit b33c3a2 / lib/billing.ts.
export async function GET(req: NextRequest) {
  console.log("[billing/create] GATED — billing disabled, free plan only. shop=%s",
    req.nextUrl.searchParams.get("shop"));
  return NextResponse.json(
    { error: "Billing not enabled. CouponMaxx is currently free." },
    { status: 410 }
  );
}
