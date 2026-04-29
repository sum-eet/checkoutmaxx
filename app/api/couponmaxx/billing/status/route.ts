export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

// Billing disabled — CouponMaxx is free. Returns static free-plan response.
// Defensive fallback in case any client still calls this endpoint.
export async function GET() {
  console.log('[CMX billing/status] GATED — returning static free plan response');
  return NextResponse.json({
    plan: 'free',
    status: null,
    subscriptionId: null,
    trialEndsAt: null,
  });
}
