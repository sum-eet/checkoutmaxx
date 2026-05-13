"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Checkbox,
  Select,
  ChoiceList,
  TextField,
  Banner,
} from "@shopify/polaris";
import { PlusGateBanner } from "@/components/checkoutlens/PlusGateBanner";
import { RecoveryStatsSidebar } from "@/components/checkoutlens/recovery/RecoveryStatsSidebar";
import { fetcher } from "@/lib/admin-fetch";

interface RuleState {
  enabled: boolean;
  threshold: string;
  codeStrategy: string;
  staticCode: string;
  generatedPercent: string;
  expiryMinutes: string;
  allowStacking: boolean;
}

const EXPIRY_OPTIONS = [
  { label: "15 minutes", value: "15" },
  { label: "1 hour", value: "60" },
  { label: "6 hours", value: "360" },
  { label: "24 hours", value: "1440" },
];

const THRESHOLD_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({
  label: `${n}`,
  value: `${n}`,
}));

export default function RecoveryPage() {
  const [isPlus, setIsPlus] = useState<boolean | null>(null);
  const [rule, setRule] = useState<RuleState>({
    enabled: false,
    threshold: "2",
    codeStrategy: "generated",
    staticCode: "",
    generatedPercent: "10",
    expiryMinutes: "60",
    allowStacking: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const savedRef = useRef<RuleState | null>(null);
  const isDirty = JSON.stringify(rule) !== JSON.stringify(savedRef.current);

  useEffect(() => {
    fetcher("/api/checkoutlens/recovery/rule")
      .then((data: { isPlus: boolean; rule: any }) => {
        console.log("[PRD-2:RecoveryPage] loaded isPlus=%s rule=%o", data.isPlus, data.rule);
        setIsPlus(data.isPlus);
        if (data.rule) {
          const r: RuleState = {
            enabled: data.rule.enabled,
            threshold: String(data.rule.threshold),
            codeStrategy: data.rule.codeStrategy,
            staticCode: data.rule.staticCode ?? "",
            generatedPercent: String(data.rule.generatedPercent ?? 10),
            expiryMinutes: String(data.rule.expiryMinutes),
            allowStacking: data.rule.allowStacking,
          };
          setRule(r);
          savedRef.current = r;
        } else {
          savedRef.current = rule;
        }
      })
      .catch((err: Error) => {
        console.error("[PRD-2:RecoveryPage] load error", err.message);
        setIsPlus(false);
        savedRef.current = rule;
      })
      .finally(() => setLoading(false));
  }, []);

  // Show/hide App Bridge save bar
  useEffect(() => {
    if (!savedRef.current) return;
    const bar = (window as any).shopify?.saveBar;
    if (!bar) return;
    if (isDirty) {
      bar.show("recovery-rule-savebar");
    } else {
      bar.hide("recovery-rule-savebar");
    }
  }, [isDirty]);

  async function save() {
    setSaving(true);
    setErrorMsg(null);
    console.log("[PRD-2:RecoveryPage] saving rule=%o", rule);
    try {
      const data = await fetcher("/api/checkoutlens/recovery/rule", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: rule.enabled,
          threshold: Number(rule.threshold),
          codeStrategy: rule.codeStrategy,
          staticCode: rule.staticCode || null,
          generatedPercent: Number(rule.generatedPercent),
          expiryMinutes: Number(rule.expiryMinutes),
          allowStacking: rule.allowStacking,
        }),
      });
      console.log("[PRD-2:RecoveryPage] saved ruleId=%s", data.rule?.id);
      savedRef.current = { ...rule };
      (window as any).shopify?.toast?.show("Recovery rule saved");
    } catch (err: any) {
      console.error("[PRD-2:RecoveryPage] save error", err.message);
      setErrorMsg("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (savedRef.current) setRule({ ...savedRef.current });
  }

  const update = useCallback(
    (patch: Partial<RuleState>) => setRule((r) => ({ ...r, ...patch })),
    []
  );

  if (loading) {
    return (
      <Page title="Coupon Recovery" backAction={{ url: "/" }}>
        <Layout>
          <Layout.Section>
            <Card>
              <Text as="p" tone="subdued">Loading…</Text>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const disabled = !isPlus;

  return (
    <Page title="Coupon Recovery" backAction={{ url: "/" }}>
      <Layout>
        <Layout.Section>
          {!isPlus && <PlusGateBanner />}
          {errorMsg && (
            <Banner tone="critical" onDismiss={() => setErrorMsg(null)}>
              <Text as="p">{errorMsg}</Text>
            </Banner>
          )}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Recovery rule</Text>
                <Badge tone={rule.enabled ? "success" : undefined}>
                  {rule.enabled ? "Active" : "Off"}
                </Badge>
              </InlineStack>

              <Checkbox
                label="Enable recovery"
                checked={rule.enabled}
                onChange={(v) => update({ enabled: v })}
                disabled={disabled}
              />

              <Select
                label="Trigger after this many failed attempts"
                options={THRESHOLD_OPTIONS}
                value={rule.threshold}
                onChange={(v) => update({ threshold: v })}
                disabled={disabled}
              />

              <ChoiceList
                title="Recovery code source"
                choices={[
                  { label: "Use a discount code I created in Shopify", value: "static" },
                  { label: "Auto-generate a unique code per shopper", value: "generated" },
                ]}
                selected={[rule.codeStrategy]}
                onChange={([v]) => update({ codeStrategy: v })}
                disabled={disabled}
              />

              {rule.codeStrategy === "static" && (
                <TextField
                  label="Discount code"
                  autoComplete="off"
                  value={rule.staticCode}
                  onChange={(v) => update({ staticCode: v.toUpperCase() })}
                  disabled={disabled}
                  helpText="Must match an active discount in Shopify Admin. Stacking follows your discount settings there."
                />
              )}

              {rule.codeStrategy === "generated" && (
                <TextField
                  label="Discount %"
                  type="number"
                  suffix="%"
                  autoComplete="off"
                  value={rule.generatedPercent}
                  onChange={(v) => update({ generatedPercent: v })}
                  disabled={disabled}
                  min={1}
                  max={50}
                />
              )}

              <Select
                label="Code expires after"
                options={EXPIRY_OPTIONS}
                value={rule.expiryMinutes}
                onChange={(v) => update({ expiryMinutes: v })}
                disabled={disabled}
              />

              {rule.codeStrategy === "generated" && (
                <Checkbox
                  label="Allow stacking with other automatic discounts"
                  helpText="When off, the recovery code replaces any active site-wide discount on the cart. When on, it combines with order, product, and shipping discounts per Shopify's combination rules."
                  checked={rule.allowStacking}
                  onChange={(v) => update({ allowStacking: v })}
                  disabled={disabled}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <RecoveryStatsSidebar />
          </Card>
        </Layout.Section>
      </Layout>

      {/* App Bridge Save Bar — rendered as a custom element, managed via window.shopify.saveBar */}
      <ui-save-bar id="recovery-rule-savebar">
        <button
          variant="primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={discard}>Discard</button>
      </ui-save-bar>
    </Page>
  );
}
