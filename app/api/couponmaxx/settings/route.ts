export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShop } from '@/lib/verify-session-token';
import { getShop } from '@/lib/shop';

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
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 401 });
  const shop = await getShop(shopDomain);
  if (!shop) return NextResponse.json({ error: 'Install required' }, { status: 400 });

  const { data: shopRow } = await supabase.from('Shop').select('id, notificationSettings, notificationEmail, slackChannelName, slackWebhookUrl')
    .eq('id', shop.id).single();
  if (!shopRow) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const settings = (shopRow as Record<string, unknown>).notificationSettings ?? DEFAULT_SETTINGS;
  return NextResponse.json({
    settings,
    email: (shopRow as Record<string, unknown>).notificationEmail ?? null,
    slack: {
      connected: !!((shopRow as Record<string, unknown>).slackWebhookUrl),
      channel: (shopRow as Record<string, unknown>).slackChannelName ?? null,
    },
  });
}

export async function POST(req: NextRequest) {
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const shop = await getShop(shopDomain);
  if (!shop) return NextResponse.json({ error: 'Install required' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const { settings, email } = body;

  const update: Record<string, unknown> = {};
  if (settings) update.notificationSettings = settings;
  if (email) update.notificationEmail = email;

  const { error } = await supabase.from('Shop').update(update).eq('id', shop.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
