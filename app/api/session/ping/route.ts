export const dynamic = 'force-dynamic';
import { type NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { logIngest } from '@/lib/ingest-log';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: CORS });
  }

  waitUntil(processPing(text));
  return NextResponse.json({ ok: true }, { headers: CORS });
}

async function processPing(text: string) {
  const start = Date.now();
  let shopDomain = 'unknown';
  let source = 'unknown';
  try {
    const body = JSON.parse(text);
    const { sessionId, country, device, pageUrl, occurredAt } = body;
    shopDomain = body.shopDomain ?? 'unknown';
    source = body.source ?? 'unknown';

    if (!sessionId || !source || !shopDomain) return;

    const { error } = await supabase.from('SessionPing').insert({
      id: crypto.randomUUID(),
      sessionId,
      source,
      shopDomain,
      country: country ?? null,
      device: device ?? null,
      pageUrl: pageUrl ?? null,
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
    });

    logIngest({
      endpoint: `session-ping-${source}`,
      shopDomain,
      eventType: `${source}_session_started`,
      success: !error,
      latencyMs: Date.now() - start,
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
    });
  } catch (err: any) {
    logIngest({
      endpoint: `session-ping-${source}`,
      shopDomain,
      eventType: `${source}_session_started`,
      success: false,
      latencyMs: Date.now() - start,
      errorCode: null,
      errorMessage: err?.message ?? 'unknown',
    });
  }
}
