import {
  reactExtension,
  useApplyDiscountCodeChange,
  useShop,
  useSettings,
  useInstructions,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Banner,
  Divider,
  Spinner,
} from '@shopify/ui-extensions-react/checkout';
import { useState, useEffect, useCallback, useRef } from 'react';

const DEFAULT_APP_URL = 'https://couponmaxx.vercel.app';

// Module-level session ID — checkout extensions have no sessionStorage
let _sessionId = '';
function getSessionId() {
  if (!_sessionId) {
    _sessionId = 'co_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }
  return _sessionId;
}

export default reactExtension(
  'purchase.checkout.reductions.render-after',
  () => <CheckoutRecovery />,
);

function CheckoutRecovery() {
  const { myshopifyDomain } = useShop();
  const settings = useSettings();
  const instructions = useInstructions();
  const applyDiscount = useApplyDiscountCodeChange();

  const appUrl = ((settings.app_url || DEFAULT_APP_URL) + '').replace(/\/$/, '');

  // State machine: idle | claiming | applying | recovery | success
  const [state, setState] = useState('idle');
  const [inputCode, setInputCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [discountLabel, setDiscountLabel] = useState('');
  const [successCode, setSuccessCode] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Auto-dismiss success after 5s
  useEffect(() => {
    if (state !== 'success') return;
    const t = setTimeout(() => {
      if (mountedRef.current) setState('idle');
    }, 5000);
    return () => clearTimeout(t);
  }, [state]);

  // Don't render on accelerated checkouts (Apple Pay, Google Pay, etc.)
  const canUpdate = instructions?.discounts?.canUpdateDiscountCodes !== false;
  if (!canUpdate) {
    console.log('[CMX Checkout] canUpdateDiscountCodes is false — hiding extension');
    return null;
  }

  async function callApi(payload) {
    const res = await fetch(`${appUrl}/api/couponmaxx/cx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('API ' + res.status);
    return res.json();
  }

  async function handleClaim() {
    console.log('[CMX Checkout] claim clicked, shop:', myshopifyDomain);
    setState('claiming');
    try {
      const data = await callApi({
        shopId: myshopifyDomain,
        sessionId: getSessionId(),
        failedCode: '',
        failureReason: 'invalid',
        cartValue: 0,
        cartItems: [],
        customerName: null,
        attemptsThisSession: 0,
        device: 'unknown',
        source: 'checkout_claim',
      });
      console.log('[CMX Checkout] claim API:', data);
      if (!mountedRef.current) return;

      if (data.action === 'show_code' && data.code) {
        const result = await applyDiscount({ type: 'addDiscountCode', code: data.code });
        console.log('[CMX Checkout] claim apply result:', result);
        if (!mountedRef.current) return;
        if (result.type === 'success') {
          setSuccessCode(data.code);
          setDiscountLabel(data.discountLabel || '');
          setState('success');
        } else {
          // Auto-apply failed — show code for manual use
          setRecoveryCode(data.code);
          setDiscountLabel(data.discountLabel || '');
          setState('recovery');
        }
      } else {
        setState('idle');
      }
    } catch (err) {
      console.warn('[CMX Checkout] claim error:', err);
      if (mountedRef.current) setState('idle');
    }
  }

  async function handleApply() {
    const code = inputCode.trim().toUpperCase();
    if (!code) return;
    console.log('[CMX Checkout] applying code:', code);
    setState('applying');

    // Try applying the code via Shopify's API
    const result = await applyDiscount({ type: 'addDiscountCode', code });
    console.log('[CMX Checkout] apply result:', result);
    if (!mountedRef.current) return;

    if (result.type === 'success') {
      setSuccessCode(code);
      setDiscountLabel('');
      setInputCode('');
      setState('success');
      return;
    }

    // Code failed — get recovery suggestion
    try {
      const data = await callApi({
        shopId: myshopifyDomain,
        sessionId: getSessionId(),
        failedCode: code,
        failureReason: 'invalid',
        cartValue: 0,
        cartItems: [],
        customerName: null,
        attemptsThisSession: 1,
        device: 'unknown',
        source: 'checkout',
      });
      console.log('[CMX Checkout] recovery API:', data);
      if (!mountedRef.current) return;

      if (data.action === 'show_code' && data.code) {
        setRecoveryCode(data.code);
        setDiscountLabel(data.discountLabel || '');
        setState('recovery');
      } else {
        setState('idle');
      }
    } catch (err) {
      console.warn('[CMX Checkout] recovery fetch error:', err);
      if (mountedRef.current) setState('idle');
    }
  }

  async function handleApplyRecovery() {
    console.log('[CMX Checkout] applying recovery code:', recoveryCode);
    const result = await applyDiscount({ type: 'addDiscountCode', code: recoveryCode });
    console.log('[CMX Checkout] recovery apply result:', result);
    if (!mountedRef.current) return;
    if (result.type === 'success') {
      setSuccessCode(recoveryCode);
      setDiscountLabel(discountLabel);
      setRecoveryCode('');
      setState('success');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (state === 'success') {
    return (
      <Banner tone="success">
        <Text>
          ✓ {successCode} applied{discountLabel ? ' — ' + discountLabel : ''}
        </Text>
      </Banner>
    );
  }

  if (state === 'recovery') {
    return (
      <BlockStack spacing="tight">
        <Banner tone="warning">
          <BlockStack spacing="extraTight">
            <Text>That code didn't work — try this instead:</Text>
            <InlineStack spacing="tight" blockAlignment="center">
              <Text>{recoveryCode}</Text>
              {discountLabel ? <Text tone="subdued">· {discountLabel}</Text> : null}
            </InlineStack>
          </BlockStack>
        </Banner>
        <Button variant="primary" onPress={handleApplyRecovery}>
          Apply {recoveryCode}
        </Button>
      </BlockStack>
    );
  }

  if (state === 'claiming') {
    return (
      <InlineStack spacing="tight" blockAlignment="center">
        <Spinner size="small" />
        <Text tone="subdued">Finding your discount…</Text>
      </InlineStack>
    );
  }

  // Idle / applying state
  return (
    <BlockStack spacing="tight">
      <InlineStack spacing="tight" blockAlignment="center">
        <Text tone="subdued">Looking for a coupon?</Text>
        <Button variant="secondary" onPress={handleClaim}>
          Claim it →
        </Button>
      </InlineStack>
      <Divider />
      <InlineStack spacing="tight" blockAlignment="center">
        <TextField
          label="Discount code"
          labelHidden
          placeholder="Enter a discount code"
          value={inputCode}
          onChange={setInputCode}
          disabled={state === 'applying'}
        />
        <Button
          variant="secondary"
          onPress={handleApply}
          loading={state === 'applying'}
          disabled={!inputCode.trim() || state === 'applying'}
        >
          Apply
        </Button>
      </InlineStack>
    </BlockStack>
  );
}
