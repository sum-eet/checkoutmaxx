export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getShopFromRequest } from "@/lib/verify-session-token";

const DEFAULT_SETTINGS = {
  brokenCoupon:       { enabled: true,  threshold: 10, attempts: 10 },
  cvrDrop:            { enabled: true,  dropPct: 40, minutes: 30 },
  productRestricted:  { enabled: true },
  zombieCodeSpike:    { enabled: true },
  couponDegraded:     { enabled: true,  threshold: 50 },
  stepDropout:        { enabled: true },
  abandonedAfterFail: { enabled: true },
  cartRecoveries:     { enabled: true },
  newTrafficSource:   { enabled: false },
  channels: {
    slack: { critical: true, warning: true, info: false },
    email: { critical: true, warning: false, info: false },
  },
  digest: {
    enabled: true,
    hour: 9,
    ampm: 'AM',
  },
};

export async function GET(req: NextRequest) {
  const shopDomain = getShopFromRequest(req);
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase.from('Shop').select('id, notificationSettings, notificationEmail, slackChannelName, slackWebhookUrl')
    .eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const settings = (shop as Record<string, unknown>).notificationSettings ?? DEFAULT_SETTINGS;
  return NextResponse.json({
    settings,
    email: (shop as Record<string, unknown>).notificationEmail ?? null,
    slack: {
      connected: !!((shop as Record<string, unknown>).slackWebhookUrl),
      channel: (shop as Record<string, unknown>).slackChannelName ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { shop: shopDomain, settings, email } = body;
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (settings) update.notificationSettings = settings;
  if (email) update.notificationEmail = email;

  const { error } = await supabase.from('Shop').update(update).eq('id', shop.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
