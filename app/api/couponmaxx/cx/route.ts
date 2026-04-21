export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { shopify } from '@/lib/shopify';
import { Session } from '@shopify/shopify-api';
import { getShop } from '@/lib/shop';

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
  failedCode?: string;     // optional — absent for checkout_claim flow
  failureReason?: FailureReason;
  cartValue: number;       // cents
  cartItems: CartItem[];
  customerName: string | null;
  attemptsThisSession: number;
  device: 'mobile' | 'desktop' | 'unknown';
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
  displayStyle: 'minimal' | 'warm' | 'green';
};

const DEFAULT_SETTINGS: MerchantSettings = {
  enabled: true,
  rules: {
    expired:          { action: 'offer_fallback_code', discount: 10, discountType: 'percentage', expiryMinutes: 15 },
    min_not_met:      { action: 'show_hint_and_suggest', collections: 'all' },
    usage_limit:      { action: 'explanation_only' },
    wrong_collection: { action: 'redirect_collection' },
    invalid:          { action: 'offer_fallback_code', discount: 10, discountType: 'percentage', expiryMinutes: 15 },
    already_used:     { action: 'explanation_only' },
  },
  hunterThreshold: 3,
  hunterAction: 'show_nothing',
  highValueThreshold: 20000,
  highValueBoost: 5,
  useCustomerName: true,
  useCartContents: true,
  dailyCodeLimit: 50,
  displayStyle: 'minimal',
};

// ── Failure explanation copy ───────────────────────────────────────────────────

function explainFailure(reason: FailureReason, _code: string): string {
  switch (reason) {
    case 'expired':          return 'That code has expired.';
    case 'min_not_met':      return 'Your cart doesn\u2019t meet the minimum for this code yet.';
    case 'usage_limit':      return 'That code has been fully redeemed.';
    case 'wrong_collection': return 'That code only works on certain products.';
    case 'invalid':          return 'That code didn\u2019t work.';
    case 'already_used':     return 'You\u2019ve already used this code.';
    default:                 return 'That code didn\u2019t work.';
  }
}

// ── Admin API: resolve actual failure reason ──────────────────────────────────

async function resolveFailureReason(
  shopDomain: string,
  accessToken: string,
  code: string,
  cartValue: number,
): Promise<FailureReason> {
  try {
    const session = new Session({
      id: `offline_${shopDomain}`,
      shop: shopDomain,
      state: '',
      isOnline: false,
      accessToken,
    });

    const client = new shopify.clients.Graphql({ session });

    const LOOKUP_QUERY = `query lookupDiscount($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        codeDiscount {
          ... on DiscountCodeBasic {
            status
            endsAt
            usageLimit
            asyncUsageCount
            appliesOncePerCustomer
            minimumRequirement {
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal { amount }
              }
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            customerGets {
              items {
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts { __typename }
                ... on DiscountCollections { __typename }
              }
            }
          }
          ... on DiscountCodeBxgy {
            status
            endsAt
            usageLimit
            asyncUsageCount
            appliesOncePerCustomer
          }
          ... on DiscountCodeFreeShipping {
            status
            endsAt
            usageLimit
            asyncUsageCount
            appliesOncePerCustomer
          }
        }
      }
    }`;

    const response = await client.request(LOOKUP_QUERY, {
      variables: { code },
    });

    const discount = (response.data as any)?.codeDiscountNodeByCode?.codeDiscount;

    // Code doesn't exist at all
    if (!discount) return 'invalid';

    const { status, endsAt, usageLimit, asyncUsageCount, appliesOncePerCustomer, minimumRequirement } = discount;

    // Shopify status: ACTIVE | EXPIRED | SCHEDULED
    if (status === 'EXPIRED') return 'expired';
    if (endsAt && new Date(endsAt) < new Date()) return 'expired';

    // Usage limit exhausted
    if (usageLimit !== null && asyncUsageCount >= usageLimit) return 'usage_limit';

    // Minimum cart value not met
    if (minimumRequirement?.greaterThanOrEqualToSubtotal) {
      const minCents = Math.round(
        parseFloat(minimumRequirement.greaterThanOrEqualToSubtotal.amount) * 100,
      );
      if (cartValue < minCents) return 'min_not_met';
    }

    // Product/collection restriction (items not allItems)
    const items = discount.customerGets?.items;
    if (items && items.allItems === false) return 'wrong_collection';

    // Per-customer limit — we can't check server-side without customer ID,
    // but if appliesOncePerCustomer and code is otherwise valid, assume already_used
    if (appliesOncePerCustomer) return 'already_used';

    // Code exists and looks valid — treat as invalid (conditions mismatch)
    return 'invalid';
  } catch (err) {
    console.error('[recovery/decide] Admin API lookup failed:', (err as Error).message);
    return 'invalid';
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

  const CREATE_MUTATION = `mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

  // NOTE: requires write_discounts scope on the Shopify app
  let response: any;
  try {
    response = await client.request(CREATE_MUTATION, {
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
    });
  } catch (err: any) {
    // GraphQL-level errors (missing scope, auth failure) throw here
    console.error('[recovery/decide] Shopify API error creating discount:', err.message);
    return null;
  }

  const result = (response.data as any)?.discountCodeBasicCreate;

  const userErrors = result?.userErrors as { field: string; message: string }[] | undefined;
  if (userErrors && userErrors.length > 0) {
    console.error('[recovery/decide] Shopify discount userErrors:', userErrors);
    return null;
  }

  // Verify the discount was actually created
  if (!result?.codeDiscountNode?.id) {
    console.error('[recovery/decide] Discount created but no ID returned — likely scope issue');
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

  if (!shopDomain || !sessionId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: CORS_HEADERS });
  }

  // ── Checkout Claim path: no failed code, generate proactively ─────────────
  const isClaim = source === 'checkout_claim' || !failedCode;
  if (isClaim) {
    const shop = await getShop(shopDomain);

    if (!shop) {
      console.log(`[CMX:claim] shop_not_found shop=${shopDomain}`);
      return NextResponse.json({ error: 'Shop not found' }, { status: 404, headers: CORS_HEADERS });
    }

    const { data: settingsRow } = await supabase
      .from('MerchantRecoverySettings')
      .select('*')
      .eq('shopId', shop.id)
      .single();

    const claimSettings: MerchantSettings = settingsRow
      ? { ...DEFAULT_SETTINGS, ...settingsRow }
      : DEFAULT_SETTINGS;

    if (!claimSettings.enabled) {
      console.log(`[CMX:claim] show_nothing reason=recovery_disabled shop=${shopDomain}`);
      return NextResponse.json({ action: 'show_nothing' }, { headers: CORS_HEADERS });
    }

    const invalidRule: RuleConfig = claimSettings.rules['invalid'] ?? { action: 'offer_fallback_code', discount: 10, discountType: 'percentage', expiryMinutes: 15 };

    if (!invalidRule.enabled || invalidRule.action !== 'offer_fallback_code') {
      console.log(`[CMX:claim] show_nothing reason=invalid_rule_disabled shop=${shopDomain}`);
      return NextResponse.json({ action: 'show_nothing' }, { headers: CORS_HEADERS });
    }

    const limited = await isRateLimited(shop.id, sessionId, claimSettings.dailyCodeLimit);
    if (limited) {
      console.log(`[CMX:claim] show_nothing reason=rate_limited shop=${shopDomain} session=${sessionId}`);
      return NextResponse.json({ action: 'show_nothing' }, { headers: CORS_HEADERS });
    }

    const claimCode = await generateShopifyDiscountCode(
      shopDomain,
      shop.accessToken,
      claimSettings.useCustomerName ? customerName : null,
      invalidRule.discount ?? 10,
      (invalidRule.discountType ?? 'percentage') as 'percentage' | 'fixed',
      invalidRule.expiryMinutes ?? 15,
    );

    if (!claimCode) {
      console.log(`[CMX:claim] show_nothing reason=code_gen_failed shop=${shopDomain}`);
      return NextResponse.json({ action: 'show_nothing' }, { headers: CORS_HEADERS });
    }

    const discountLabel = (invalidRule.discountType ?? 'percentage') === 'percentage'
      ? `${invalidRule.discount ?? 10}% off`
      : `$${((invalidRule.discount ?? 10) / 100).toFixed(2)} off`;

    const claimEventId = crypto.randomUUID();
    await supabase.from('RecoveryEvent').insert({
      id: claimEventId,
      shopId: shop.id,
      sessionId,
      failedCode: '',
      failureReason: 'invalid',
      recoveryAction: 'show_code',
      recoveryCode: claimCode,
      discountValue: invalidRule.discount ?? 10,
      discountType: invalidRule.discountType ?? 'percentage',
      cartValueAtFailure: cartValue,
      customerName: claimSettings.useCustomerName ? customerName : null,
      attemptsThisSession: 0,
      device,
      source: 'checkout_claim',
    });

    console.log('[CMX] checkout_claim: generated code', claimCode, 'for shop', shopDomain);

    return NextResponse.json({
      action: 'show_code',
      code: claimCode,
      discount: { type: invalidRule.discountType ?? 'percentage', value: invalidRule.discount ?? 10 },
      discountLabel,
      expiresInMinutes: invalidRule.expiryMinutes ?? 15,
      recoveryId: claimEventId,
    }, { headers: CORS_HEADERS });
  }

  // Load shop
  const shop = await getShop(shopDomain);

  if (!shop) {
    return NextResponse.json({ error: 'Shop not found' }, { status: 404, headers: CORS_HEADERS });
  }

  // Override client-supplied failure reason with ground truth from Admin API
  const resolvedReason = await resolveFailureReason(
    shopDomain,
    shop.accessToken,
    failedCode,
    cartValue,
  );

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
        displayStyle:      settingsRow.displayStyle ?? DEFAULT_SETTINGS.displayStyle,
      }
    : DEFAULT_SETTINGS;

  // Smart recovery off
  if (!settings.enabled) {
    return NextResponse.json(
      { action: 'show_nothing' },
      { headers: CORS_HEADERS },
    );
  }

  const recoveryId = crypto.randomUUID();

  // Serial hunter protection
  if (attemptsThisSession >= settings.hunterThreshold) {
    await supabase.from('RecoveryEvent').insert({
      id: recoveryId,
      shopId: shop.id,
      sessionId,
      failedCode,
      failureReason: resolvedReason,
      recoveryAction: 'show_nothing',
      cartValueAtFailure: cartValue,
      customerName: settings.useCustomerName ? customerName : null,
      attemptsThisSession,
      device,
    });
    return NextResponse.json(
      { action: 'show_nothing', recoveryId, _resolvedReason: resolvedReason },
      { headers: CORS_HEADERS },
    );
  }

  // Get rule for this failure reason
  const rule: RuleConfig = settings.rules[resolvedReason] ?? { action: 'explanation_only' };

  // Rule is individually disabled — show explanation only, no recovery
  if (rule.enabled === false) {
    await supabase.from('RecoveryEvent').insert({
      id: recoveryId,
      shopId: shop.id,
      sessionId,
      failedCode,
      failureReason: resolvedReason,
      recoveryAction: 'show_hint',
      cartValueAtFailure: cartValue,
      customerName: settings.useCustomerName ? customerName : null,
      attemptsThisSession,
      device,
    });
    return NextResponse.json({
      action: 'show_hint',
      recoveryId,
      displayStyle: settings.displayStyle,
      _resolvedReason: resolvedReason,
    }, { headers: CORS_HEADERS });
  }

  // High-value cart boost
  let effectiveDiscount = rule.discount ?? 10;
  if (cartValue >= settings.highValueThreshold && rule.discount !== undefined) {
    effectiveDiscount = Math.min(effectiveDiscount + settings.highValueBoost, 50);
  }

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

    const recoveryAction = recoveryCode ? 'show_code' : 'show_hint';

    await supabase.from('RecoveryEvent').insert({
      id: recoveryId,
      shopId: shop.id,
      sessionId,
      failedCode,
      failureReason: resolvedReason,
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
      code: recoveryCode,
      discount: { type: discountType, value: effectiveDiscount },
      discountLabel,
      expiresInMinutes: expiryMinutes,
      recoveryId,
      displayStyle: settings.displayStyle,
      _resolvedReason: resolvedReason,
    }, { headers: CORS_HEADERS });
  }

  if (rule.action === 'show_hint_and_suggest') {
    await supabase.from('RecoveryEvent').insert({
      id: recoveryId,
      shopId: shop.id,
      sessionId,
      failedCode,
      failureReason: resolvedReason,
      recoveryAction: 'show_upsell',
      cartValueAtFailure: cartValue,
      customerName: settings.useCustomerName ? customerName : null,
      attemptsThisSession,
      device,
    });

    return NextResponse.json({
      action: 'show_hint',
      recoveryId,
      displayStyle: settings.displayStyle,
      _resolvedReason: resolvedReason,
    }, { headers: CORS_HEADERS });
  }

  if (rule.action === 'redirect_collection') {
    await supabase.from('RecoveryEvent').insert({
      id: recoveryId,
      shopId: shop.id,
      sessionId,
      failedCode,
      failureReason: resolvedReason,
      recoveryAction: 'show_hint',
      cartValueAtFailure: cartValue,
      customerName: settings.useCustomerName ? customerName : null,
      attemptsThisSession,
      device,
    });

    return NextResponse.json({
      action: 'show_hint',
      recoveryId,
      displayStyle: settings.displayStyle,
      _resolvedReason: resolvedReason,
    }, { headers: CORS_HEADERS });
  }

  // explanation_only / show_nothing / fallthrough
  const finalAction = rule.action === 'show_nothing' ? 'show_nothing' : 'show_hint';

  await supabase.from('RecoveryEvent').insert({
    id: recoveryId,
    shopId: shop.id,
    sessionId,
    failedCode,
    failureReason: resolvedReason,
    recoveryAction: finalAction,
    cartValueAtFailure: cartValue,
    customerName: settings.useCustomerName ? customerName : null,
    attemptsThisSession,
    device,
  });

  return NextResponse.json({
    action: finalAction,
    recoveryId,
    displayStyle: settings.displayStyle,
    _resolvedReason: resolvedReason,
  }, { headers: CORS_HEADERS });
}
