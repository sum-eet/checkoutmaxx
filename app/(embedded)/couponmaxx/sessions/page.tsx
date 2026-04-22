'use client';

import { useState, useEffect, useCallback } from 'react';
import { Banner, BlockStack, Card, Page, Spinner, Text, Badge } from '@shopify/polaris';

type CouponAttempt = { code: string | null; success: boolean | null; at: string };

type LineItem = {
  productTitle: string | null;
  quantity: number | null;
  price: number | null;
};

type Session = {
  sessionId: string;
  startedAt: string;
  lastSeenAt: string;
  device: string | null;
  country: string | null;
  cartValue: number;
  lineItems: LineItem[];
  couponAttempts: CouponAttempt[];
  reachedCheckout: boolean;
  completed: boolean;
};

import { fetcher } from '@/lib/admin-fetch';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtCart(cents: number): string {
  if (!cents) return '—';
  return '$' + (cents / 100).toFixed(2);
}

function statusBadge(s: Session): JSX.Element {
  if (s.completed) return <Badge tone="success">Completed</Badge>;
  if (s.reachedCheckout) return <Badge tone="info">Checkout started</Badge>;
  return <Badge tone="warning">Abandoned</Badge>;
}

function productsCell(items: LineItem[]): string {
  if (!items?.length) return '—';
  const titles = items.map(i => i.productTitle).filter(Boolean) as string[];
  if (!titles.length) return `${items.length} item${items.length > 1 ? 's' : ''}`;
  const head = titles.slice(0, 2).join(', ');
  const extra = titles.length > 2 ? ` +${titles.length - 2}` : '';
  return head + extra;
}

function attemptsCell(attempts: CouponAttempt[]): string {
  if (!attempts.length) return '—';
  const firstCode = attempts[0].code ?? '?';
  if (attempts.length === 1) return firstCode;
  return `${firstCode} +${attempts.length - 1}`;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetcher('/api/couponmaxx/sessions');
      setSessions(res.sessions ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Page title="Sessions (last 7 days)">
      <BlockStack gap="400">
        {error && <Banner tone="critical">{error}</Banner>}

        <Card>
          <BlockStack gap="300">
            <Text variant="headingSm" as="h2">Cart sessions</Text>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                <Spinner size="small" />
              </div>
            ) : !sessions.length ? (
              <Text tone="subdued" as="p">No sessions in the last 7 days.</Text>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                      {['Started', 'Device / Country', 'Cart value', 'Products', 'Coupon attempts', 'Status'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#6B7280', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map(s => (
                      <tr key={s.sessionId} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '8px 10px', color: '#374151', whiteSpace: 'nowrap' }}>{fmt(s.startedAt)}</td>
                        <td style={{ padding: '8px 10px', color: '#6B7280' }}>
                          {[s.device, s.country].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#374151' }}>{fmtCart(s.cartValue)}</td>
                        <td style={{ padding: '8px 10px', color: '#374151', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {productsCell(s.lineItems)}
                        </td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>
                          {attemptsCell(s.couponAttempts)}
                        </td>
                        <td style={{ padding: '8px 10px' }}>{statusBadge(s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
