export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getShopFromRequest } from '@/lib/verify-session-token';
import { ensureShop } from '@/lib/ensure-shop';

const DEFAULT_RULES = {
  expired:          { enabled: false, action: 'offer_fallback_code', discount: 10, discountType: 'percentage', expiryMinutes: 15 },
  min_not_met:      { enabled: false, action: 'show_hint_and_suggest', collections: 'all' },
  usage_limit:      { enabled: false, action: 'explanation_only' },
  wrong_collection: { enabled: false, action: 'redirect_collection' },
  invalid:          { enabled: false, action: 'explanation_only' },
  already_used:     { enabled: false, action: 'explanation_only' },
};

export async function GET(req: NextRequest) {
  const shopResult = await ensureShop(req);
  if (!shopResult) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  const shop = { id: shopResult.shopId };

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
  const body = await req.json().catch(() => ({}));
  const { shop: shopDomain, settings } = body;

  if (!shopDomain || !settings) {
    return NextResponse.json({ error: 'Missing shop or settings' }, { status: 400 });
  }

  const { data: shop } = await supabase
    .from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

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
