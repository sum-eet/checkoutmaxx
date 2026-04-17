'use client';

import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  FormLayout,
  InlineStack,
  Link,
  Page,
  Select,
  Text,
  TextField,
} from '@shopify/polaris';
import { SaveBar } from '@shopify/app-bridge-react';
import { useShop } from '@/hooks/useShop';
import { Toggle } from '@/components/couponmaxx/Toggle';
import { LoadingBar } from '@/components/couponmaxx/LoadingBar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiscountType = 'percentage' | 'fixed';

type RuleConfig = {
  enabled: boolean;
  action: string;
  discount?: number;
  discountType?: DiscountType;
  expiryMinutes?: number;
  collections?: string;
};

type DisplayStyle = 'minimal' | 'warm' | 'green';

type RecoverySettings = {
  enabled: boolean;
  displayStyle: DisplayStyle;
  rules: {
    expired: RuleConfig;
    min_not_met: RuleConfig;
    usage_limit: RuleConfig;
    wrong_collection: RuleConfig;
    invalid: RuleConfig;
    already_used: RuleConfig;
  };
  hunterThreshold: number;
  hunterAction: string;
  highValueThreshold: number;
  highValueBoost: number;
  useCustomerName: boolean;
  useCartContents: boolean;
};

const DEFAULT_SETTINGS: RecoverySettings = {
  enabled: false,
  displayStyle: 'minimal',
  rules: {
    expired:          { enabled: false, action: 'offer_fallback_code', discount: 10, discountType: 'percentage', expiryMinutes: 15 },
    min_not_met:      { enabled: false, action: 'show_hint_and_suggest', collections: 'all' },
    usage_limit:      { enabled: false, action: 'explanation_only' },
    wrong_collection: { enabled: false, action: 'redirect_collection' },
    invalid:          { enabled: true,  action: 'offer_fallback_code', discount: 10, discountType: 'percentage', expiryMinutes: 15 },
    already_used:     { enabled: false, action: 'explanation_only' },
  },
  hunterThreshold: 3,
  hunterAction: 'show_nothing',
  highValueThreshold: 20000,
  highValueBoost: 5,
  useCustomerName: true,
  useCartContents: true,
};

const ACTION_OPTIONS = [
  { label: 'Offer fallback code',          value: 'offer_fallback_code' },
  { label: 'Offer smaller discount',       value: 'offer_smaller_discount' },
  { label: 'Show hint only',               value: 'show_hint_only' },
  { label: 'Show hint + product suggestion', value: 'show_hint_and_suggest' },
  { label: 'Redirect to correct collection', value: 'redirect_collection' },
  { label: 'Show explanation only',        value: 'explanation_only' },
  { label: 'Show nothing',                 value: 'show_nothing' },
];

const HUNTER_ACTION_OPTIONS = [
  { label: "Show nothing — don't reward hunting", value: 'show_nothing' },
  { label: 'Show explanation only',               value: 'explanation_only' },
];

const FAILURE_LABELS: Record<string, string> = {
  expired:          'Expired code',
  min_not_met:      'Minimum not met',
  usage_limit:      'Usage limit reached',
  wrong_collection: 'Wrong collection',
  invalid:          'Unknown / invalid code',
  already_used:     'Already used by customer',
};

// ---------------------------------------------------------------------------
// Health check types + component
// ---------------------------------------------------------------------------

type HealthData = {
  shopDomain: string;
  theme: { name: string; compatibility: 'full' | 'partial' | 'unknown' };
  lastCartEvent: string | null;
  lastCouponFailed: string | null;
  lastRecoveryOffered: string | null;
  recoveryEnabled: boolean;
  invalidRuleEnabled: boolean;
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isRecent(iso: string | null, thresholdMs = 24 * 60 * 60 * 1000): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < thresholdMs;
}

function RecoveryStatusCard({ shop }: { shop: string }) {
  const { data, isLoading } = useSWR<HealthData>(
    shop ? `/api/couponmaxx/health?shop=${shop}` : null,
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 30000, revalidateOnFocus: true }
  );

  if (isLoading || !data) {
    return (
      <Card>
        <Text as="p" tone="subdued">Checking recovery status…</Text>
      </Card>
    );
  }

  const cartActive = isRecent(data.lastCartEvent);
  const neverActive = !data.lastCartEvent;
  const compatLabel = data.theme.compatibility === 'full'
    ? 'Fully Compatible'
    : data.theme.compatibility === 'partial'
    ? 'Partial Support — test to verify'
    : 'Custom Theme — test to verify';
  const compatTone = data.theme.compatibility === 'full' ? 'success' : 'warning';

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" variant="headingMd">Smart Recovery Status</Text>
          <Button
            size="slim"
            url={`https://${data.shopDomain}/cart`}
            target="_blank"
          >
            Open storefront cart
          </Button>
        </InlineStack>

        {neverActive && (
          <Banner tone="warning">
            <p>
              <strong>Extension may not be active.</strong> Go to{' '}
              <Link url={`https://${data.shopDomain}/admin/themes/current/editor`} target="_blank">
                Shopify Admin → Online Store → Themes → Customize
              </Link>{' '}
              → App Embeds and enable CouponMaxx.
            </p>
          </Banner>
        )}

        {!data.invalidRuleEnabled && data.recoveryEnabled && (
          <Banner tone="critical">
            <p>
              <strong>Invalid code recovery is disabled.</strong> Customers entering fake or expired
              codes will see no suggestion. Enable the &quot;Unknown / invalid code&quot; rule below.
            </p>
          </Banner>
        )}

        <BlockStack gap="200">
          {/* Theme */}
          <InlineStack gap="200" blockAlign="center">
            <Box minWidth="140px">
              <Text as="p" tone="subdued" variant="bodySm">Theme</Text>
            </Box>
            <Text as="p" variant="bodySm">{data.theme.name}</Text>
            <Badge tone={compatTone}>{compatLabel}</Badge>
          </InlineStack>

          {/* Cart Monitor */}
          <InlineStack gap="200" blockAlign="center">
            <Box minWidth="140px">
              <Text as="p" tone="subdued" variant="bodySm">Cart Monitor</Text>
            </Box>
            <Badge tone={cartActive ? 'success' : neverActive ? 'critical' : 'warning'}>
              {neverActive ? 'Never seen' : cartActive ? 'Active' : 'Inactive'}
            </Badge>
            <Text as="p" tone="subdued" variant="bodySm">{timeAgo(data.lastCartEvent)}</Text>
          </InlineStack>

          {/* Coupon failures */}
          <InlineStack gap="200" blockAlign="center">
            <Box minWidth="140px">
              <Text as="p" tone="subdued" variant="bodySm">Coupon Failures</Text>
            </Box>
            <Badge tone={data.lastCouponFailed ? 'success' : 'info'}>
              {data.lastCouponFailed ? 'Detected' : 'None yet'}
            </Badge>
            {data.lastCouponFailed && (
              <Text as="p" tone="subdued" variant="bodySm">{timeAgo(data.lastCouponFailed)}</Text>
            )}
            {!data.lastCouponFailed && (
              <Text as="p" tone="subdued" variant="bodySm">
                Apply a fake coupon on your cart to test
              </Text>
            )}
          </InlineStack>

          {/* Recovery offers */}
          <InlineStack gap="200" blockAlign="center">
            <Box minWidth="140px">
              <Text as="p" tone="subdued" variant="bodySm">Recovery Offers</Text>
            </Box>
            <Badge tone={data.lastRecoveryOffered ? 'success' : 'info'}>
              {data.lastRecoveryOffered ? 'Working' : 'None yet'}
            </Badge>
            {data.lastRecoveryOffered && (
              <Text as="p" tone="subdued" variant="bodySm">{timeAgo(data.lastRecoveryOffered)}</Text>
            )}
            {!data.lastRecoveryOffered && (
              <Text as="p" tone="subdued" variant="bodySm">
                Will show after first failure is handled
              </Text>
            )}
          </InlineStack>

          {/* Invalid rule */}
          <InlineStack gap="200" blockAlign="center">
            <Box minWidth="140px">
              <Text as="p" tone="subdued" variant="bodySm">Invalid Rule</Text>
            </Box>
            <Badge tone={data.invalidRuleEnabled ? 'success' : 'critical'}>
              {data.invalidRuleEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </InlineStack>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Setup guide card
// ---------------------------------------------------------------------------

const LIQUID_SNIPPET = `{% comment %}CouponMaxx Recovery Hook{% endcomment %}
{% for dc in cart.discount_codes %}
  {% unless dc.applicable %}
    <div data-cmx-failed-code="{{ dc.code | escape }}"
         data-cmx-cart-value="{{ cart.total_price }}"
         style="display:none" aria-hidden="true"></div>
  {% endunless %}
{% endfor %}`;

function SetupGuideCard() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(LIQUID_SNIPPET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text as="p" variant="headingMd">100% Detection Setup</Text>
            <Text as="p" tone="subdued">
              Paste this snippet into your cart template for guaranteed detection on any theme.
            </Text>
          </BlockStack>
          <Button size="slim" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy snippet'}
          </Button>
        </InlineStack>

        <Box
          background="bg-surface-secondary"
          padding="300"
          borderRadius="200"
        >
          <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace' }}>
            {LIQUID_SNIPPET}
          </pre>
        </Box>

        <BlockStack gap="100">
          <Text as="p" variant="bodySm" fontWeight="semibold">Where to paste it</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Admin → Online Store → Themes → Edit code → find your cart template file → paste near the discount code input.
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            • <strong>Dawn / Sense / Craft:</strong> <code>sections/cart-drawer.liquid</code> — after the discount input block
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            • <strong>Debut / Brooklyn:</strong> <code>snippets/cart-template.liquid</code> — after <code>.cart__discount-error</code>
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            • <strong>Other themes:</strong> any file that renders the cart discount form — paste near the coupon <code>&lt;input&gt;</code>
          </Text>
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function ruleNeedsDiscount(action: string) {
  return action === 'offer_fallback_code' || action === 'offer_smaller_discount';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ title }: { title: string }) {
  return (
    <Box paddingBlockStart="400" paddingBlockEnd="200">
      <Text as="p" variant="headingSm" tone="subdued">{title}</Text>
      <Divider />
    </Box>
  );
}

function RuleRow({
  failureKey,
  rule,
  onChange,
}: {
  failureKey: string;
  rule: RuleConfig;
  onChange: (key: string, rule: RuleConfig) => void;
}) {
  const showDiscountFields = ruleNeedsDiscount(rule.action);

  return (
    <Box paddingBlockEnd="400">
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {FAILURE_LABELS[failureKey] ?? failureKey}
          </Text>
          <Toggle
            checked={rule.enabled ?? false}
            onChange={(v) => onChange(failureKey, { ...rule, enabled: v })}
          />
        </InlineStack>
        {rule.enabled && (
          <FormLayout>
            <FormLayout.Group condensed>
              <Select
                label="Action"
                options={ACTION_OPTIONS}
                value={rule.action}
                onChange={(v) => onChange(failureKey, { ...rule, action: v })}
              />
              {showDiscountFields && (
                <TextField
                  label="Discount %"
                  type="number"
                  value={String(rule.discount ?? 10)}
                  min={1}
                  max={50}
                  suffix="%"
                  autoComplete="off"
                  onChange={(v) => onChange(failureKey, { ...rule, discount: parseInt(v, 10) || 10 })}
                />
              )}
              {showDiscountFields && (
                <TextField
                  label="Expires (min)"
                  type="number"
                  value={String(rule.expiryMinutes ?? 15)}
                  min={5}
                  max={60}
                  suffix="min"
                  autoComplete="off"
                  onChange={(v) => onChange(failureKey, { ...rule, expiryMinutes: parseInt(v, 10) || 15 })}
                />
              )}
            </FormLayout.Group>
          </FormLayout>
        )}
      </BlockStack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Style previews (inline HTML)
// ---------------------------------------------------------------------------

const STYLE_PREVIEWS: Record<DisplayStyle, { label: string; html: string }> = {
  minimal: {
    label: 'Minimal',
    html: `<div style="font-size:13px;color:#c44;line-height:1.5">
      <span>That code expired — try this one:</span>
      <span style="display:inline-flex;align-items:center;gap:4px;margin-left:6px;padding:3px 10px;background:#2a7;color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:600;font-family:monospace;letter-spacing:0.5px">SAVE-7X92</span>
      <span style="display:block;margin-top:4px;font-size:11px;color:#888">10% off · valid 15 min</span>
    </div>`,
  },
  warm: {
    label: 'Warm banner',
    html: `<div style="padding:10px 14px;background:#fef9ef;border:1px solid #f0dda0;border-radius:8px;font-size:13px;color:#5c4813;line-height:1.5">
      <span>That code expired — try this one:</span>
      <span style="display:inline-flex;align-items:center;gap:4px;margin-left:6px;padding:3px 10px;background:#1a1a1a;color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:600;font-family:monospace;letter-spacing:0.5px">SAVE-7X92</span>
      <span style="display:block;margin-top:4px;font-size:11px;color:#9a8453">10% off · valid 15 min</span>
    </div>`,
  },
  green: {
    label: 'Green success',
    html: `<div style="padding:10px 14px;background:#f0faf4;border:1px solid #b8e6c8;border-radius:8px;font-size:13px;color:#1a5c32;line-height:1.5">
      <span>That code expired — try this one:</span>
      <span style="display:inline-flex;align-items:center;gap:4px;margin-left:6px;padding:3px 10px;background:#1a1a1a;color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:600;font-family:monospace;letter-spacing:0.5px">SAVE-7X92</span>
      <span style="display:block;margin-top:4px;font-size:11px;color:#5a9a6e">10% off · valid 15 min</span>
    </div>`,
  },
};

function StylePicker({
  value,
  onChange,
}: {
  value: DisplayStyle;
  onChange: (v: DisplayStyle) => void;
}) {
  return (
    <BlockStack gap="300">
      {(Object.keys(STYLE_PREVIEWS) as DisplayStyle[]).map((key) => {
        const selected = key === value;
        return (
          <Box
            key={key}
            padding="300"
            borderRadius="200"
            borderWidth="025"
            borderColor={selected ? 'border-info' : 'border'}
            background={selected ? 'bg-surface-info' : 'bg-surface'}
          >
            <div
              onClick={() => onChange(key)}
              style={{ cursor: 'pointer' }}
            >
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="bodyMd" fontWeight={selected ? 'semibold' : 'regular'}>
                  {STYLE_PREVIEWS[key].label}
                  {key === 'minimal' ? ' (default)' : ''}
                </Text>
                {selected && <Text as="p" tone="magic" variant="bodySm">Selected</Text>}
              </InlineStack>
              <Box paddingBlockStart="200">
                <div dangerouslySetInnerHTML={{ __html: STYLE_PREVIEWS[key].html }} />
              </Box>
            </div>
          </Box>
        );
      })}
    </BlockStack>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SmartRecoverySettings() {
  const shop = useShop();
  const apiUrl = shop ? `/api/couponmaxx/recovery/settings?shop=${shop}` : null;

  const { data, isLoading, error } = useSWR(apiUrl, fetcher, { revalidateOnFocus: false });

  const [settings, setSettings] = useState<RecoverySettings>(DEFAULT_SETTINGS);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (data?.settings) {
      setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    }
  }, [data]);

  const update = useCallback(<K extends keyof RecoverySettings>(key: K, value: RecoverySettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaveSuccess(false);
  }, []);

  const updateRule = useCallback((failureKey: string, rule: RuleConfig) => {
    setSettings((prev) => ({
      ...prev,
      rules: { ...prev.rules, [failureKey]: rule },
    }));
    setDirty(true);
    setSaveSuccess(false);
  }, []);

  const handleSave = useCallback(async () => {
    if (!shop) return;
    setSaving(true);
    try {
      const res = await fetch('/api/couponmaxx/recovery/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop, settings }),
      });
      if (res.ok) {
        setDirty(false);
        setSaveSuccess(true);
      }
    } finally {
      setSaving(false);
    }
  }, [shop, settings]);

  const handleDiscard = useCallback(() => {
    if (data?.settings) {
      setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    } else {
      setSettings(DEFAULT_SETTINGS);
    }
    setDirty(false);
    setSaveSuccess(false);
  }, [data]);

  const isFirstVisit = !isLoading && !error && !data?.settings;

  return (
    <Page title="Smart Recovery Settings">
      <LoadingBar loading={isLoading} />

      <SaveBar id="smart-recovery-save-bar" open={dirty}>
        <button variant="primary" onClick={handleSave} loading={saving ? '' : undefined}>
          Save
        </button>
        <button onClick={handleDiscard}>Discard</button>
      </SaveBar>

      <BlockStack gap="400">

        {/* ── Recovery health check ──────────────────────────────────────── */}
        {shop && <RecoveryStatusCard shop={shop} />}

        {/* ── Setup guide ───────────────────────────────────────────────── */}
        <SetupGuideCard />

        {isFirstVisit && (
          <Banner tone="info">
            Smart Recovery is ready to go. When a customer&apos;s coupon fails, we&apos;ll show
            them a helpful message and optionally offer a recovery code. Review the default
            settings below or turn it on now.
          </Banner>
        )}

        {saveSuccess && (
          <Banner tone="success" onDismiss={() => setSaveSuccess(false)}>
            Settings saved.
          </Banner>
        )}

        {error && (
          <Banner tone="critical">Failed to load settings. Please refresh.</Banner>
        )}

        {/* ── Master toggle ─────────────────────────────────────────────── */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <Text as="p" variant="headingMd">Smart Recovery</Text>
                <Text as="p" tone="subdued">
                  When a coupon fails, show a recovery offer to help the customer complete
                  their purchase.
                </Text>
              </BlockStack>
              <Toggle
                checked={settings.enabled}
                onChange={(v) => update('enabled', v)}
              />
            </InlineStack>
          </BlockStack>
        </Card>

        {/* ── Rules ─────────────────────────────────────────────────────── */}
        <Card>
          <BlockStack gap="200">
            <Text as="p" variant="headingMd">Recovery Rules</Text>
            <Text as="p" tone="subdued">
              Each failure type can have its own recovery action.
            </Text>

            <SectionHeader title="RULES" />

            {(Object.keys(settings.rules) as Array<keyof RecoverySettings['rules']>).map((key) => (
              <RuleRow
                key={key}
                failureKey={key}
                rule={settings.rules[key]}
                onChange={updateRule}
              />
            ))}
          </BlockStack>
        </Card>

        {/* ── Advanced ──────────────────────────────────────────────────── */}
        <Card>
          <BlockStack gap="400">
            <Text as="p" variant="headingMd">Advanced</Text>

            <SectionHeader title="SERIAL COUPON HUNTER PROTECTION" />
            <FormLayout>
              <FormLayout.Group condensed>
                <TextField
                  label="Max failed attempts per session"
                  type="number"
                  value={String(settings.hunterThreshold)}
                  min={1}
                  max={10}
                  autoComplete="off"
                  helpText="After this many failed attempts, switch to the action below."
                  onChange={(v) => update('hunterThreshold', parseInt(v, 10) || 3)}
                />
                <Select
                  label="Action after threshold"
                  options={HUNTER_ACTION_OPTIONS}
                  value={settings.hunterAction}
                  onChange={(v) => update('hunterAction', v)}
                />
              </FormLayout.Group>
            </FormLayout>

            <SectionHeader title="HIGH-VALUE CART PROTECTION" />
            <FormLayout>
              <FormLayout.Group condensed>
                <TextField
                  label="Cart minimum ($)"
                  type="number"
                  value={String(Math.round(settings.highValueThreshold / 100))}
                  min={0}
                  prefix="$"
                  autoComplete="off"
                  helpText="Boost recovery discount for carts above this value."
                  onChange={(v) =>
                    update('highValueThreshold', (parseInt(v, 10) || 200) * 100)
                  }
                />
                <TextField
                  label="Discount boost (pp)"
                  type="number"
                  value={String(settings.highValueBoost)}
                  min={0}
                  max={20}
                  suffix="pp"
                  autoComplete="off"
                  helpText="Added to the base discount for high-value carts (e.g. 15% → 20%)."
                  onChange={(v) => update('highValueBoost', parseInt(v, 10) || 5)}
                />
              </FormLayout.Group>
            </FormLayout>
          </BlockStack>
        </Card>

        {/* ── Personalization ───────────────────────────────────────────── */}
        <Card>
          <BlockStack gap="400">
            <Text as="p" variant="headingMd">Personalization</Text>

            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <Text as="p" variant="bodyMd">Use customer&apos;s first name</Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  Only available for logged-in customers.
                </Text>
              </BlockStack>
              <Toggle
                checked={settings.useCustomerName}
                onChange={(v) => update('useCustomerName', v)}
              />
            </InlineStack>

            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <Text as="p" variant="bodyMd">Reference cart contents</Text>
                <Text as="p" tone="subdued" variant="bodySm">
                  &ldquo;15% off your HydroPitcher&rdquo; vs &ldquo;15% off&rdquo;
                </Text>
              </BlockStack>
              <Toggle
                checked={settings.useCartContents}
                onChange={(v) => update('useCartContents', v)}
              />
            </InlineStack>
          </BlockStack>
        </Card>

        {/* ── Display Style ─────────────────────────────────────────────── */}
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="headingMd">Display Style</Text>
            <Text as="p" tone="subdued">
              How the recovery message looks on your cart page.
            </Text>
            <StylePicker
              value={settings.displayStyle}
              onChange={(v) => update('displayStyle', v)}
            />
          </BlockStack>
        </Card>

        {/* Save button (bottom) */}
        <InlineStack align="end">
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            disabled={!dirty}
          >
            Save settings
          </Button>
        </InlineStack>

      </BlockStack>
    </Page>
  );
}
