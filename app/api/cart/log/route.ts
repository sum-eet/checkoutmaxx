// app/api/cart/log/route.ts
// PHASE 1 ONLY — discovery logging, not production code
// Delete this file entirely when Phase 2 begins

import { NextRequest, NextResponse } from "next/server";
import { appendFileSync } from "fs";
import { join } from "path";

const LOG_FILE = join("/tmp", "cart-events.log");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const text = await req.text();

  let event;
  try {
    event = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: CORS_HEADERS });
  }

  const enriched = { ...event, receivedAt: new Date().toISOString() };

  // Log to Vercel function logs so you can read events in the dashboard
  console.log(`[cart-log] ${enriched.eventType} | shop=${enriched.shopDomain} | session=${enriched.sessionId} | cart=${enriched.cartToken}`);
  if (enriched.payload) {
    console.log(`[cart-log] payload:`, JSON.stringify(enriched.payload));
  }

  try {
    appendFileSync(LOG_FILE, JSON.stringify(enriched) + "\n");
  } catch {
    // /tmp not writable in all environments — events still in Vercel logs above
  }

  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
