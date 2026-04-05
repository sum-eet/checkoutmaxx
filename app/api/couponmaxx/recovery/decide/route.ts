export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { shopify } from '@/lib/shopify';
import { Session } from '@shopify/shopify-api';

// ── CORS (storefront calls this endpoint directly) ────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ── Types ─────────────────────────────────────────────────────────────────────

type FailureReason =
  | 'expired'
  | 'min_not_met'
  | 'usage_limit'
  | 'wrong_collection'
  | 'invalid'
  | 'already_used';

type CartItem = {
  productTitle: string;
  collectionIds: string[];
  price: number;   // cents
  quantity: number;
};

type RecoveryRequest = {
  shopId: string;          // shop domain
  sessionId: string;
  failedCode: string;
  failureReason: FailureReason;
  cartValue: number;       // cents
  cartItems: CartItem[];
  customerName: string | null;
  attemptsThisSession: number;
  device: 'mobile' | 'desktop';
  source: string | null;
};

type RuleConfig = {
  enabled?: boolean;
  action: string;
  discount?: number;
  discountType?: 'percentage' | 'fixed';
  expiryMinutes?: number;
  collections?: string;
};

type MerchantSettings = {
  enabled: boolean;
  rules: Record<string, RuleConfig>;
  hunterThreshold: number;
  hunterAction: string;
  highValueThreshold: number;
  highValueBoost: number;
  useCustomerName: boolean;
  useCartContents: boolean;
  dailyCodeLimit: number;
};

const DEFAULT_SETTINGS: MerchantSettings = {
  enabled: true,
  rules: {
    expired:          { action: 'offer_fallback_code', discount: 10, discountType: 'percentage', expiryMinutes: 15 },
    min_not_met:      { action: 'show_hint_and_suggest', collections: 'all' },
    usage_limit:      { action: 'explanation_only' },
    wrong_collection: { action: 'redirect_collection' },
    invalid:          { action: 'explanation_only' },
    already_used:     { action: 'explanation_only' },
  },
  hunterThreshold: 3,
  hunterAction: 'show_nothing',
  highValueThreshold: 20000,
  highValueBoost: 5,
  useCustomerName: true,
  useCartContents: true,
  dailyCodeLimit: 50,
};

// ── Failure explanation copy ───────────────────────────────────────────────────

function explainFailure(reason: FailureReason, _code: string): string {
  switch (reason) {
    case 'expired':          return 'That code has expired.';
    case 'min_not_met':      return 'Your cart doesn\u2019t meet the minimum for this code yet.';
    case 'usage_limit':      return 'That code has been fully redeemed.';
    case 'wrong_collection': return 'That code only works on certain products.';
    case 'invalid':          return 'We couldn\u2019t find that code. Check the spelling?';
    case 'already_used':     return 'You\u2019ve already used this code.';
    default:                 return 'That code didn\u2019t work.';
  }
}

// ── Unique code generation ────────────────────────────────────────────────────

function randomAlphanumeric(length: number): string {
  const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function buildCodePrefix(customerName: string | null): string {
  if (customerName) {
    const first = customerName.split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '');
    if (first.length >= 2) return first.slice(0, 8);
  }
  return 'SAVE';
}

async function generateShopifyDiscountCode(
  shopDomain: string,
  accessToken: string,
  customerName: string | null,
  discountValue: number,
  discountType: 'percentage' | 'fixed',
  expiryMinutes: number,
): Promise<string | null> {
  const code = `${buildCodePrefix(customerName)}-${randomAlphanumeric(4)}`;

  const session = new Session({
    id: `offline_${shopDomain}`,
    shop: shopDomain,
    state: '',
    isOnline: false,
    accessToken,
  });

  const client = new shopify.clients.Graphql({ session });

  const endsAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

  // NOTE: requires write_discounts scope on the Shopify app
  const response = await client.query({
    data: {
      query: `mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode { id }
          userErrors { field message }
        }
      }`,
      variables: {
        basicCodeDiscount: {
          title: code,
          code,
          startsAt: new Date().toISOString(),
          endsAt,
          usageLimit: 1,
          customerSelection: { all: true },
          customerGets: {
            value: discountType === 'percentage'
              ? { percentage: discountValue / 100 }
              : { discountAmount: { amount: discountValue / 100, appliesOnEachItem: false } },
            items: { all: true },
          },
        },
      },
    },
  });

  const body = response.body as unknown as {
    data?: {
      discountCodeBasicCreate?: {
        codeDiscountNode?: { id: string };
        userErrors?: { message: string }[];
      };
    };
  };

  const errors = body?.data?.discountCodeBasicCreate?.userErrors;
  if (errors && errors.length > 0) {
    console.error('[recovery/decide] Shopify discount error:', errors);
    return null;
  }

  return code;
}

// ── Rate-limit check ──────────────────────────────────────────────────────────

async function isRateLimited(shopId: string, sessionId: string, dailyLimit: number): Promise<boolean> {
  // Max 1 code per session per 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: sessionCount } = await supabase
    .from('RecoveryEvent')
    .select('*', { count: 'exact', head: true })
    .eq('sessionId', sessionId)
    .eq('recoveryAction', 'show_code')
    .gte('createdAt', tenMinutesAgo);

  if ((sessionCount ?? 0) >= 1) return true;

  // Daily store limit
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: dailyCount } = await supabase
    .from('RecoveryEvent')
    .select('*', { count: 'exact', head: true })
    .eq('shopId', shopId)
    .eq('recoveryAction', 'show_code')
    .gte('createdAt', todayStart.toISOString());

  return (dailyCount ?? 0) >= dailyLimit;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: RecoveryRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS_HEADERS });
  }

  const { shopId: shopDomain, sessionId, failedCode, failureReason,
          cartValue, cartItems, customerName, attemptsThisSession, device, source } = body;

  if (!shopDomain || !sessionId || !failedCode || !failureReason) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: CORS_HEADERS });
  }

  // Load shop
  const { data: shop } = await supabase
    .from('Shop')
    .select('id, accessToken')
    .eq('shopDomain', shopDomain)
    .eq('isActive', true)
    .single();

  if (!shop) {
    return NextResponse.json({ error: 'Shop not found' }, { status: 404, headers: CORS_HEADERS });
  }

  // Load merchant recovery settings (or use defaults)
  const { data: settingsRow } = await supabase
    .from('MerchantRecoverySettings')
    .select('*')
    .eq('shopId', shop.id)
    .single();

  const settings: MerchantSettings = settingsRow
    ? {
        enabled:           settingsRow.enabled ?? DEFAULT_SETTINGS.enabled,
        rules:             settingsRow.rules ?? DEFAULT_SETTINGS.rules,
        hunterThreshold:   settingsRow.hunterThreshold ?? DEFAULT_SETTINGS.hunterThreshold,
        hunterAction:      settingsRow.hunterAction ?? DEFAULT_SETTINGS.hunterAction,
        highValueThreshold: settingsRow.highValueThreshold ?? DEFAULT_SETTINGS.highValueThreshold,
        highValueBoost:    settingsRow.highValueBoost ?? DEFAULT_SETTINGS.highValueBoost,
        useCustomerName:   settingsRow.useCustomerName ?? DEFAULT_SETTINGS.useCustomerName,
        useCartContents:   settingsRow.useCartContents ?? DEFAULT_SETTINGS.useCartContents,
        dailyCodeLimit:    settingsRow.dailyCodeLimit ?? DEFAULT_SETTINGS.dailyCodeLimit,
      }
    : DEFAULT_SETTINGS;

  // Smart recovery off
  if (!settings.enabled) {
    return NextResponse.json(
      { action: 'show_nothing' },
      { headers: CORS_HEADERS },
    );
  }

  const line1 = explainFailure(failureReason, failedCode);
  const recoveryId = crypto.randomUUID();

  // Serial hunter protection
  if (attemptsThisSession >= settings.hunterThreshold) {
    await supabase.from('RecoveryEvent').insert({
      id: recoveryId,
      shopId: shop.id,
      sessionId,
      failedCode,
      failureReason,
      recoveryAction: 'show_nothing',
      cartValueAtFailure: cartValue,
      customerName: settings.useCustomerName ? customerName : null,
      attemptsThisSession,
      device,
    });
    return NextResponse.json(
      { action: 'show_nothing', line1, line2: null, code: null,
        discount: null, expiresInMinutes: null, productSuggestion: null, recoveryId },
      { headers: CORS_HEADERS },
    );
  }

  // Get rule for this failure reason
  const rule: RuleConfig = settings.rules[failureReason] ?? { action: 'explanation_only' };

  // Rule is individually disabled — show explanation only, no recovery
  if (rule.enabled === false) {
    await supabase.from('RecoveryEvent').insert({
      id: recoveryId,
      shopId: shop.id,
      sessionId,
      failedCode,
      failureReason,
      recoveryAction: 'show_hint',
      cartValueAtFailure: cartValue,
      customerName: settings.useCustomerName ? customerName : null,
      attemptsThisSession,
      device,
    });
    return NextResponse.json({
      action: 'show_hint',
      line1,
      line2: null,
      code: null,
      discount: null,
      expiresInMinutes: null,
      productSuggestion: null,
      recoveryId,
    }, { headers: CORS_HEADERS });
  }

  // High-value cart boost
  let effectiveDiscount = rule.discount ?? 10;
  if (cartValue >= settings.highValueThreshold && rule.discount !== undefined) {
    effectiveDiscount = Math.min(effectiveDiscount + settings.highValueBoost, 50);
  }

  const displayName = settings.useCustomerName && customerName
    ? customerName.split(/\s+/)[0]
    : null;

  const firstItemTitle = settings.useCartContents && cartItems.length > 0
    ? cartItems[0].productTitle
    : null;

  // ── Handle each action ───────────────────────────────────────────────────────

  if (rule.action === 'offer_fallback_code' || rule.action === 'offer_smaller_discount') {
    const discountType = (rule.discountType ?? 'percentage') as 'percentage' | 'fixed';
    const expiryMinutes = rule.expiryMinutes ?? 15;

    // Rate limit check
    const limited = await isRateLimited(shop.id, sessionId, settings.dailyCodeLimit);

    let recoveryCode: string | null = null;
    if (!limited) {
      try {
        recoveryCode = await generateShopifyDiscountCode(
          shopDomain,
          shop.accessToken,
          settings.useCustomerName ? customerName : null,
          effectiveDiscount,
          discountType,
          expiryMinutes,
        );
      } catch (err) {
        console.error('[recovery/decide] Code generation failed:', (err as Error).message);
      }
    }

    const discountLabel = discountType === 'percentage'
      ? `${effectiveDiscount}% off`
      : `$${(effectiveDiscount / 100).toFixed(2)} off`;

    const line2 = recoveryCode
      ? `Here\u2019s one that works:`
      : (displayName
          ? `Sorry ${displayName}, that code isn\u2019t working right now.`
          : `That code isn\u2019t working right now.`);

    const recoveryAction = recoveryCode ? 'show_code' : 'show_hint';

    await supabase.from('RecoveryEvent').insert({
      id: recoveryId,
      shopId: shop.id,
      sessionId,
      failedCode,
      failureReason,
      recoveryAction,
      recoveryCode,
      discountValue: effectiveDiscount,
      discountType,
      cartValueAtFailure: cartValue,
      customerName: settings.useCustomerName ? customerName : null,
      attemptsThisSession,
      device,
    });

    return NextResponse.json({
      action: recoveryAction,
      line1,
      line2,
      code: recoveryCode,
      discount: { type: discountType, value: effectiveDiscount },
      discountLabel,
      expiresInMinutes: expiryMinutes,
      productSuggestion: null,
      recoveryId,
    }, { headers: CORS_HEADERS });
  }

  if (rule.action === 'show_hint_and_suggest') {
    const cartDollars = (cartValue / 100).toFixed(2);
    const line2 = firstItemTitle
      ? `Add a bit more to unlock this discount \u2014 like another ${firstItemTitle}.`
      : `Add more to your cart to unlock this discount.`;

    await supabase.from('RecoveryEvent').insert({
      id: recoveryId,
      shopId: shop.id,
      sessionId,
      failedCode,
      failureReason,
      recoveryAction: 'show_upsell',
      cartValueAtFailure: cartValue,
      customerName: settings.useCustomerName ? customerName : null,
      attemptsThisSession,
      device,
    });

    return NextResponse.json({
      action: 'show_upsell',
      line1: `This code needs a higher cart total. You\u2019re at $${cartDollars}.`,
      line2,
      code: null,
      discount: null,
      expiresInMinutes: null,
      productSuggestion: null,
      recoveryId,
    }, { headers: CORS_HEADERS });
  }

  if (rule.action === 'redirect_collection') {
    await supabase.from('RecoveryEvent').insert({
      id: recoveryId,
      shopId: shop.id,
      sessionId,
      failedCode,
      failureReason,
      recoveryAction: 'show_hint',
      cartValueAtFailure: cartValue,
      customerName: settings.useCustomerName ? customerName : null,
      attemptsThisSession,
      device,
    });

    return NextResponse.json({
      action: 'show_hint',
      line1: 'That code only works on certain products.',
      line2: 'Browse the qualifying products to use this discount.',
      code: null,
      discount: null,
      expiresInMinutes: null,
      productSuggestion: null,
      recoveryId,
    }, { headers: CORS_HEADERS });
  }

  // explanation_only / show_nothing / fallthrough
  const finalAction = rule.action === 'show_nothing' ? 'show_nothing' : 'show_hint';

  await supabase.from('RecoveryEvent').insert({
    id: recoveryId,
    shopId: shop.id,
    sessionId,
    failedCode,
    failureReason,
    recoveryAction: finalAction,
    cartValueAtFailure: cartValue,
    customerName: settings.useCustomerName ? customerName : null,
    attemptsThisSession,
    device,
  });

  return NextResponse.json({
    action: finalAction,
    line1: finalAction === 'show_nothing' ? null : line1,
    line2: null,
    code: null,
    discount: null,
    expiresInMinutes: null,
    productSuggestion: null,
    recoveryId,
  }, { headers: CORS_HEADERS });
}
