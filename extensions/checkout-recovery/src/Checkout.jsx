import {
  reactExtension,
  useApplyDiscountCodeChange,
  useShop,
  useSettings,
  useInstructions,
  InlineStack,
  Text,
  Button,
  Banner,
  View,
} from '@shopify/ui-extensions-react/checkout';
import { useState, useEffect, useRef } from 'react';

export default reactExtension(
  'purchase.checkout.reductions.render-after',
  () => <CheckoutRecovery />,
);

function CheckoutRecovery() {
  const { myshopifyDomain } = useShop();
  const settings = useSettings();
  const instructions = useInstructions();
  const applyDiscount = useApplyDiscountCodeChange();

  const discountCode = String(settings.discount_code || '').trim().toUpperCase();
  const discountLabel = String(settings.discount_label || '').trim();

  // State: idle | applying | success | failed
  const [state, setState] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    console.log('[CMX Checkout] MOUNTED — shop:', myshopifyDomain, '| code:', discountCode || '(none)');
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    console.log('[CMX Checkout] state →', state);
  }, [state]);

  // Success state is terminal — no auto-dismiss

  const canUpdate = instructions?.discounts?.canUpdateDiscountCodes;
  console.log('[CMX Checkout] canUpdateDiscountCodes:', canUpdate, '| state:', state);

  async function handleClaim() {
    if (!discountCode) {
      console.warn('[CMX Checkout] claim: no discount_code configured in settings');
      setErrorMsg('No coupon available right now.');
      setState('failed');
      return;
    }
    console.log('[CMX Checkout] claim clicked, applying:', discountCode);
    setState('applying');
    try {
      const result = await applyDiscount({ type: 'addDiscountCode', code: discountCode });
      console.log('[CMX Checkout] apply result:', result);
      if (!mountedRef.current) return;
      if (result.type === 'success') {
        setState('success');
      } else {
        setErrorMsg("That coupon couldn't be applied.");
        setState('failed');
      }
    } catch (err) {
      console.warn('[CMX Checkout] apply threw:', err);
      if (!mountedRef.current) return;
      setErrorMsg("Couldn't apply coupon. Try again.");
      setState('failed');
    }
  }

  // ── Render ──

  if (state === 'success') {
    return (
      <Banner tone="success">
        <Text>
          ✓ {discountCode} applied{discountLabel ? ' — ' + discountLabel : ''}
        </Text>
      </Banner>
    );
  }

  if (state === 'failed') {
    return (
      <Banner tone="warning">
        <Text>{errorMsg}</Text>
      </Banner>
    );
  }

  return (
    <View border="base" cornerRadius="base" padding="base">
      <InlineStack spacing="tight" blockAlignment="center" inlineAlignment="space-between">
        <Text size="small" tone="subdued">Looking for a discount?</Text>
        <Button
          kind="plain"
          appearance="monochrome"
          onPress={handleClaim}
          loading={state === 'applying'}
          disabled={state === 'applying'}
        >
          Claim
        </Button>
      </InlineStack>
    </View>
  );
}
