'use client';

import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  FormLayout,
  InlineStack,
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

type RecoverySettings = {
  enabled: boolean;
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
  rules: {
    expired:          { enabled: false, action: 'offer_fallback_code', discount: 10, discountType: 'percentage', expiryMinutes: 15 },
    min_not_met:      { enabled: false, action: 'show_hint_and_suggest', collections: 'all' },
    usage_limit:      { enabled: false, action: 'explanation_only' },
    wrong_collection: { enabled: false, action: 'redirect_collection' },
    invalid:          { enabled: false, action: 'explanation_only' },
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
// Recovery preview
// ---------------------------------------------------------------------------

function RecoveryPreview({ settings }: { settings: RecoverySettings }) {
  const [scenario, setScenario] = useState<keyof RecoverySettings['rules']>('expired');
  const rule = settings.rules[scenario];
  const showsCode = ruleNeedsDiscount(rule.action);
  const customerLabel = settings.useCustomerName ? 'SARAH' : 'SAVE';

  return (
    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center">
          <Text as="p" variant="bodyMd" fontWeight="semibold">Preview for:</Text>
          <Select
            label=""
            labelHidden
            options={Object.entries(FAILURE_LABELS).map(([k, v]) => ({ label: v, value: k }))}
            value={scenario}
            onChange={(v) => setScenario(v as keyof RecoverySettings['rules'])}
          />
        </InlineStack>
        <Box
          background="bg-surface"
          padding="400"
          borderRadius="200"
          borderWidth="025"
          borderColor="border"
        >
          {rule.action === 'show_nothing' ? (
            <Text as="p" tone="subdued">
              [Shopify default error — no recovery shown]
            </Text>
          ) : (
            <BlockStack gap="100">
              <Text as="p" tone="caution" fontWeight="medium">
                {scenario === 'expired' && 'That code has expired.'}
                {scenario === 'min_not_met' && "This code needs a higher cart total. You're at $34.00."}
                {scenario === 'usage_limit' && 'That code has been fully redeemed.'}
                {scenario === 'wrong_collection' && 'That code only works on certain products.'}
                {scenario === 'invalid' && "We couldn't find that code. Check the spelling?"}
                {scenario === 'already_used' && "You've already used this code."}
              </Text>
              {rule.action !== 'explanation_only' && (
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p">
                    {(rule.action === 'offer_fallback_code' || rule.action === 'offer_smaller_discount')
                      ? "Here's one that works:"
                      : rule.action === 'show_hint_and_suggest'
                      ? 'Add a bit more to unlock this discount.'
                      : rule.action === 'redirect_collection'
                      ? 'Browse the qualifying products to use this discount.'
                      : null}
                  </Text>
                  {showsCode && (
                    <Box
                      background="bg-fill-info-secondary"
                      padding="100"
                      paddingInline="300"
                      borderRadius="100"
                      borderWidth="025"
                      borderColor="border-info"
                    >
                      <Text as="p" tone="magic" fontWeight="medium">
                        {customerLabel}-7X92
                      </Text>
                    </Box>
                  )}
                </InlineStack>
              )}
              {showsCode && rule.discount && (
                <Text as="p" tone="subdued" variant="bodySm">
                  {rule.discount}% off · expires in {rule.expiryMinutes ?? 15} min
                </Text>
              )}
            </BlockStack>
          )}
        </Box>
      </BlockStack>
    </Box>
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

        {/* ── Preview ───────────────────────────────────────────────────── */}
        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="headingMd">Preview</Text>
            <Text as="p" tone="subdued">
              A mock of what the customer would see for each failure type with your
              current settings.
            </Text>
            <RecoveryPreview settings={settings} />
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
