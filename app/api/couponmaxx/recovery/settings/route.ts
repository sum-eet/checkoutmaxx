export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShop } from '@/lib/verify-session-token';
import { getShop } from '@/lib/shop';

const DEFAULT_RULES = {
  expired:          { enabled: false, action: 'offer_fallback_code', discount: 10, discountType: 'percentage', expiryMinutes: 15 },
  min_not_met:      { enabled: false, action: 'show_hint_and_suggest', collections: 'all' },
  usage_limit:      { enabled: false, action: 'explanation_only' },
  wrong_collection: { enabled: false, action: 'redirect_collection' },
  invalid:          { enabled: true,  action: 'offer_fallback_code', discount: 10, discountType: 'percentage', expiryMinutes: 15 },
  already_used:     { enabled: false, action: 'explanation_only' },
};

export async function GET(req: NextRequest) {
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 401 });
  const shop = await getShop(shopDomain);
  if (!shop) return NextResponse.json({ error: 'Install required' }, { status: 400 });

  const { data } = await supabase
    .from('MerchantRecoverySettings').select('*').eq('shopId', shop.id).single();

  if (!data) {
    return NextResponse.json({ settings: null });
  }

  return NextResponse.json({
    settings: {
      enabled:            data.enabled ?? false,
      rules:              data.rules ?? DEFAULT_RULES,
      hunterThreshold:    data.hunterThreshold ?? 3,
      hunterAction:       data.hunterAction ?? 'show_nothing',
      highValueThreshold: data.highValueThreshold ?? 20000,
      highValueBoost:     data.highValueBoost ?? 5,
      useCustomerName:    data.useCustomerName ?? true,
      useCartContents:    data.useCartContents ?? true,
    },
  });
}

export async function POST(req: NextRequest) {
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const shop = await getShop(shopDomain);
  if (!shop) return NextResponse.json({ error: 'Install required' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const { settings } = body;
  if (!settings) {
    return NextResponse.json({ error: 'Missing settings' }, { status: 400 });
  }

  const { error } = await supabase
    .from('MerchantRecoverySettings')
    .upsert({
      shopId:             shop.id,
      enabled:            settings.enabled ?? false,
      rules:              settings.rules ?? DEFAULT_RULES,
      hunterThreshold:    settings.hunterThreshold ?? 3,
      hunterAction:       settings.hunterAction ?? 'show_nothing',
      highValueThreshold: settings.highValueThreshold ?? 20000,
      highValueBoost:     settings.highValueBoost ?? 5,
      useCustomerName:    settings.useCustomerName ?? true,
      useCartContents:    settings.useCartContents ?? true,
      updatedAt:          new Date().toISOString(),
    }, { onConflict: 'shopId' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
