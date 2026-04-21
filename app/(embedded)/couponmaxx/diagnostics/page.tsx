'use client';

import { useState, useEffect, useCallback } from 'react';
import { Banner, BlockStack, Card, Page, Spinner, Text, InlineStack } from '@shopify/polaris';

function useShop(): string | null {
  const [shop, setShop] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const direct = p.get('shop') ?? p.get('shopDomain') ?? null;
    if (direct) { setShop(direct); return; }
    // Try decoding id_token to extract shop domain
    const token = p.get('id_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const dest: string = payload.dest || payload.iss || '';
        const m = dest.match(/https?:\/\/([^/]+)/);
        if (m) setShop(m[1]);
      } catch {}
    }
  }, []);
  return shop;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HealthData = {
  shopDomain: string;
  theme: { name: string; compatibility: 'full' | 'partial' | 'unknown' };
  lastCartEvent: string | null;
  lastCouponFailed: string | null;
  lastRecoveryOffered: string | null;
  recoveryEnabled: boolean;
  invalidRuleEnabled: boolean;
  lastPixelEvent: string | null;
  pixelEventsToday: number;
  lastSessionPing: string | null;
  cartEventsToday: number;
  recoveryEventsToday: number;
  shopState: {
    isActive: boolean;
    hasToken: boolean;
    hasPixelId: boolean;
    installedAt: string | null;
    updatedAt: string | null;
  };
  lastClaim: {
    code: string | null;
    occurredAt: string | null;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Same fetcher pattern as analytics/page.tsx — appends id_token from URL
async function fetcher(url: string) {
  let enrichedUrl = url;
  if (typeof window !== 'undefined') {
    const pageParams = new URLSearchParams(window.location.search);
    const idToken = pageParams.get('id_token');
    if (idToken) {
      const parsed = new URL(url, window.location.origin);
      if (!parsed.searchParams.has('id_token')) {
        parsed.searchParams.set('id_token', idToken);
        enrichedUrl = parsed.pathname + '?' + parsed.searchParams.toString();
      }
    }
  }
  const res = await fetch(enrichedUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusDot(iso: string | null): { color: string; label: string } {
  if (!iso) return { color: '#EF4444', label: 'Never' };
  const age = Date.now() - new Date(iso).getTime();
  if (age < 5 * 60 * 1000) return { color: '#16A34A', label: timeAgo(iso) };
  if (age < 60 * 60 * 1000) return { color: '#F59E0B', label: timeAgo(iso) };
  return { color: '#EF4444', label: timeAgo(iso) };
}

function boolDot(ok: boolean): { color: string; label: string } {
  return ok
    ? { color: '#16A34A', label: 'Yes' }
    : { color: '#EF4444', label: 'No' };
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function DiagRow({
  label,
  dot,
  detail,
  count,
}: {
  label: string;
  dot: { color: string; label: string };
  detail?: string | null;
  count?: number | null;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 0', borderBottom: '1px solid #F3F4F6',
    }}>
      {/* Status dot */}
      <div style={{
        width: 10, height: 10, borderRadius: '50%',
        background: dot.color, flexShrink: 0,
      }} />
      {/* Label */}
      <div style={{ flex: 1, fontSize: 13, color: '#111827', fontWeight: 500 }}>
        {label}
      </div>
      {/* Detail */}
      <div style={{ fontSize: 12, color: '#6B7280', minWidth: 80, textAlign: 'right' }}>
        {detail ?? dot.label}
      </div>
      {/* Count today */}
      {count != null && (
        <div style={{ fontSize: 12, color: '#6B7280', minWidth: 60, textAlign: 'right' }}>
          {count} today
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DiagnosticsPage() {
  const shop = useShop();
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [firing, setFiring] = useState<'pixel' | 'claim' | null>(null);
  const [fireResult, setFireResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetcher(`/api/couponmaxx/health`);
      setData(res);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const firePixel = async () => {
    if (!shop || firing) return;
    setFiring('pixel');
    setFireResult(null);
    try {
      await fetch('/api/pixel/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: shop,
          eventType: 'page_viewed',
          sessionId: `diag_${Date.now()}`,
          occurredAt: new Date().toISOString(),
          deviceType: null, country: null, data: {},
        }),
      });
      setFireResult('Pixel event fired — refreshing in 3s…');
      setTimeout(load, 3000);
    } catch {
      setFireResult('Pixel fire failed — check console');
    } finally {
      setFiring(null);
    }
  };

  const fireClaim = async () => {
    if (!shop || firing) return;
    setFiring('claim');
    setFireResult(null);
    try {
      const res = await fetch('/api/couponmaxx/cx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: shop,
          sessionId: `diag_${Date.now()}`,
          source: 'checkout_claim',
          cartValue: 5000,
          cartItems: [],
          failedCode: null,
          failureReason: null,
          customerName: null,
          attemptsThisSession: 0,
          device: 'desktop',
        }),
      });
      const json = await res.json();
      if (json.code) {
        setFireResult(`Claim fired → code: ${json.code}`);
      } else {
        setFireResult(`Claim returned: ${json.action ?? JSON.stringify(json)}`);
      }
      setTimeout(load, 3000);
    } catch {
      setFireResult('Claim fire failed — check console');
    } finally {
      setFiring(null);
    }
  };

  return (
    <Page title="Diagnostics">
      <BlockStack gap="400">

        {error && (
          <Banner tone="critical">{error}</Banner>
        )}

        {fireResult && (
          <Banner tone="info" onDismiss={() => setFireResult(null)}>
            {fireResult}
          </Banner>
        )}

        {/* Test buttons */}
        <Card>
          <BlockStack gap="200">
            <Text variant="headingSm" as="h2">Test fire</Text>
            <Text variant="bodySm" tone="subdued" as="p">
              Send a real event end-to-end. Table below refreshes automatically after 3s.
            </Text>
            <InlineStack gap="200">
              <button
                onClick={firePixel}
                disabled={!!firing}
                style={{
                  background: '#0EA5E9', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '7px 14px', fontSize: 13,
                  fontWeight: 500, cursor: firing ? 'not-allowed' : 'pointer',
                  opacity: firing ? 0.6 : 1,
                }}
              >
                {firing === 'pixel' ? 'Firing…' : 'Fire test pixel event'}
              </button>
              <button
                onClick={fireClaim}
                disabled={!!firing}
                style={{
                  background: '#8B5CF6', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '7px 14px', fontSize: 13,
                  fontWeight: 500, cursor: firing ? 'not-allowed' : 'pointer',
                  opacity: firing ? 0.6 : 1,
                }}
              >
                {firing === 'claim' ? 'Firing…' : 'Fire test claim'}
              </button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Status table */}
        <Card>
          <div style={{ marginBottom: 12 }}>
            <Text variant="headingSm" as="h2">Event streams</Text>
            <Text variant="bodySm" tone="subdued" as="p">
              Auto-refreshes every 10s. Green = last 5 min · Yellow = last hour · Red = older or never.
            </Text>
          </div>

          {loading && !data ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
              <Spinner size="small" />
            </div>
          ) : data ? (
            <div>
              {/* Shop state */}
              <DiagRow
                label="Shop installed + active"
                dot={boolDot(data.shopState.isActive)}
                detail={data.shopState.installedAt ? `Installed ${timeAgo(data.shopState.installedAt)}` : 'Unknown'}
              />
              <DiagRow
                label="Has access token"
                dot={boolDot(data.shopState.hasToken)}
              />
              <DiagRow
                label="Has pixel ID"
                dot={boolDot(data.shopState.hasPixelId)}
              />

              {/* Event streams */}
              <DiagRow
                label="Storefront pixel signal"
                dot={
                  data.pixelEventsToday > 0
                    ? { color: '#16A34A', label: `${data.pixelEventsToday} today` }
                    : data.lastPixelEvent && Date.now() - new Date(data.lastPixelEvent).getTime() < 7 * 24 * 60 * 60 * 1000
                    ? { color: '#F59E0B', label: 'No events today' }
                    : { color: '#EF4444', label: 'Never' }
                }
                detail={data.pixelEventsToday > 0 ? `Last: ${timeAgo(data.lastPixelEvent)}` : 'No prod traffic yet'}
              />
              <DiagRow
                label="Pixel events (CheckoutEvent)"
                dot={statusDot(data.lastPixelEvent)}
                detail={timeAgo(data.lastPixelEvent)}
                count={data.pixelEventsToday}
              />
              <DiagRow
                label="Cart events"
                dot={statusDot(data.lastCartEvent)}
                detail={timeAgo(data.lastCartEvent)}
                count={data.cartEventsToday}
              />
              <DiagRow
                label="Session pings"
                dot={statusDot(data.lastSessionPing)}
                detail={timeAgo(data.lastSessionPing)}
              />
              <DiagRow
                label="Recovery events"
                dot={statusDot(data.lastRecoveryOffered)}
                detail={timeAgo(data.lastRecoveryOffered)}
                count={data.recoveryEventsToday}
              />

              {/* Claim */}
              <DiagRow
                label="Last claim code generated"
                dot={statusDot(data.lastClaim.occurredAt)}
                detail={data.lastClaim.code
                  ? `${data.lastClaim.code} · ${timeAgo(data.lastClaim.occurredAt)}`
                  : 'None yet'}
              />

              {/* Config */}
              <DiagRow
                label="Claim button enabled (recovery + invalid rule)"
                dot={boolDot(data.recoveryEnabled && data.invalidRuleEnabled)}
                detail={
                  !data.recoveryEnabled ? 'Recovery off'
                  : !data.invalidRuleEnabled ? 'Invalid rule off'
                  : 'Enabled'
                }
              />
            </div>
          ) : null}
        </Card>

        {/* Last updated */}
        <div style={{ textAlign: 'right', fontSize: 11, color: '#9CA3AF' }}>
          Auto-refresh · last loaded {new Date().toLocaleTimeString()}
        </div>

      </BlockStack>
    </Page>
  );
}
