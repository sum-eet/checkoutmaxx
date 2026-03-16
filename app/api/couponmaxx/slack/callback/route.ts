export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const code = p.get('code');
  const shopDomain = p.get('state'); // pass shop as state param in OAuth URL

  if (!code || !shopDomain) {
    return NextResponse.redirect(new URL('/couponmaxx/notifications?error=slack_oauth_failed', req.url));
  }

  const { data: shop } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.redirect(new URL('/couponmaxx/notifications?error=shop_not_found', req.url));

  // Exchange code for access token
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/couponmaxx/slack/callback`;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/couponmaxx/notifications?error=slack_not_configured', req.url));
  }

  const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.ok) {
    return NextResponse.redirect(new URL('/couponmaxx/notifications?error=slack_token_exchange_failed', req.url));
  }

  const webhookUrl = tokenData.incoming_webhook?.url;
  const channelName = tokenData.incoming_webhook?.channel ?? '#unknown';

  await supabase.from('Shop').update({
    slackWebhookUrl: webhookUrl,
    slackChannelName: channelName,
  } as Record<string, unknown>).eq('id', shop.id);

  return NextResponse.redirect(new URL('/couponmaxx/notifications?slack=connected', req.url));
}
