export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { ensureShop } from '@/lib/ensure-shop';
import { shopify, sessionStorage } from '@/lib/shopify';
import { Session } from '@shopify/shopify-api';

// Shopify Theme Store IDs → compatibility level
// themeStoreId 0 = custom/unlisted theme
const THEME_COMPAT: Record<number, 'full' | 'partial'> = {
  887: 'full',    // Dawn
  796: 'full',    // Debut
  730: 'full',    // Craft
  779: 'full',    // Refresh
  795: 'full',    // Crave
  829: 'full',    // Studio
  380: 'partial', // Brooklyn
  413: 'partial', // Narrative
  378: 'partial', // Supply
  453: 'partial', // Simple
  766: 'partial', // Colorblock
  843: 'partial', // Sense
  814: 'partial', // Spotlight
};

const THEMES_QUERY = `
  query {
    themes(first: 20, roles: [MAIN]) {
      nodes { id name role themeStoreId }
    }
  }
`;

export async function GET(req: NextRequest) {
  const shopResult = await ensureShop(req);
  if (!shopResult) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { shopId, shopDomain } = shopResult;

  // ── 1. Activity checks ─────────────────────────────────────────────────────

  const [cartEventRes, couponFailedRes, recoveryEventRes, settingsRes] = await Promise.all([
    // Most recent cart event (any type) — confirms extension is active on storefront
    supabase
      .from('CartEvent')
      .select('occurredAt')
      .eq('shopId', shopId)
      .order('occurredAt', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Most recent coupon failure — confirms failure detection is working
    supabase
      .from('CartEvent')
      .select('occurredAt')
      .eq('shopId', shopId)
      .eq('eventType', 'cart_coupon_failed')
      .order('occurredAt', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Most recent recovery offer — confirms end-to-end flow is working
    supabase
      .from('RecoveryEvent')
      .select('occurredAt')
      .eq('shopId', shopId)
      .order('occurredAt', { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Merchant recovery settings
    supabase
      .from('MerchantRecoverySettings')
      .select('enabled, rules')
      .eq('shopId', shopId)
      .maybeSingle(),
  ]);

  const lastCartEvent = cartEventRes.data?.occurredAt ?? null;
  const lastCouponFailed = couponFailedRes.data?.occurredAt ?? null;
  const lastRecoveryOffered = recoveryEventRes.data?.occurredAt ?? null;
  const recoveryEnabled = settingsRes.data?.enabled ?? false;
  const invalidRuleEnabled = settingsRes.data?.rules?.invalid?.enabled ?? false;

  // ── 2. Theme detection ─────────────────────────────────────────────────────

  let theme: { name: string; compatibility: 'full' | 'partial' | 'unknown' } = {
    name: 'Unknown',
    compatibility: 'unknown',
  };

  try {
    const { data: shopRow } = await supabase
      .from('Shop')
      .select('accessToken')
      .eq('shopDomain', shopDomain)
      .eq('isActive', true)
      .maybeSingle();

    if (shopRow?.accessToken) {
      const session = new Session({
        id: `offline_${shopDomain}`,
        shop: shopDomain,
        state: 'offline',
        isOnline: false,
        accessToken: shopRow.accessToken,
      });
      const client = new shopify.clients.Graphql({ session });
      const res = await client.request(THEMES_QUERY);
      const themes = (res.data as any)?.themes?.nodes ?? [];
      const mainTheme = themes[0];
      if (mainTheme) {
        const themeStoreId = mainTheme.themeStoreId ?? 0;
        const compat = THEME_COMPAT[themeStoreId];
        theme = {
          name: mainTheme.name,
          compatibility: compat ?? (themeStoreId === 0 ? 'unknown' : 'partial'),
        };
      }
    }
  } catch (err: any) {
    console.warn('[health] theme detection failed:', err?.message);
    // Non-fatal — return rest of health data without theme info
  }

  return NextResponse.json({
    shopDomain,
    theme,
    lastCartEvent,
    lastCouponFailed,
    lastRecoveryOffered,
    recoveryEnabled,
    invalidRuleEnabled,
  });
}
