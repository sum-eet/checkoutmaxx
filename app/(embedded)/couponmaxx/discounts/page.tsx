'use client';

import { useState, useEffect, useCallback } from 'react';
import { Banner, BlockStack, Card, Page, Spinner, Text, InlineStack, Badge } from '@shopify/polaris';

type ClaimRow = {
  id: string;
  recoveryCode: string | null;
  failureReason: string | null;
  source: string | null;
  cartValueAtFailure: number | null;
  discountValue: number | null;
  discountType: string | null;
  device: string | null;
  createdAt: string;
};

type ClaimsData = {
  counts: { today: number; week: number; cartViewsToday: number; cartViewsHour: number };
  recent: ClaimRow[];
};

import { fetcher } from '@/lib/admin-fetch';

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtCart(cents: number | null): string {
  if (cents == null) return '—';
  return '$' + (cents / 100).toFixed(2);
}

function fmtDiscount(value: number | null, type: string | null): string {
  if (value == null) return '—';
  if (type === 'percentage') return `${value}%`;
  return '$' + (value / 100).toFixed(2);
}

export default function DiscountsPage() {
  const [data, setData] = useState<ClaimsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetcher('/api/couponmaxx/claims');
      setData(res);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Page title="Discounts">
      <BlockStack gap="400">
        {error && <Banner tone="critical">{error}</Banner>}

        {/* KPI tiles */}
        <InlineStack gap="400">
          <div style={{ flex: 1 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="p">Claims today</Text>
                <Text variant="heading2xl" as="p">
                  {loading ? '—' : String(data?.counts.today ?? 0)}
                </Text>
              </BlockStack>
            </Card>
          </div>
          <div style={{ flex: 1 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="p">Claims this week</Text>
                <Text variant="heading2xl" as="p">
                  {loading ? '—' : String(data?.counts.week ?? 0)}
                </Text>
              </BlockStack>
            </Card>
          </div>
          <div style={{ flex: 1 }}>
            <Card>
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="p">Cart views today</Text>
                <Text variant="heading2xl" as="p">
                  {loading ? '—' : String(data?.counts.cartViewsToday ?? 0)}
                </Text>
                <Text variant="bodySm" tone="subdued" as="p">
                  +{data?.counts.cartViewsHour ?? 0} in last hour
                </Text>
              </BlockStack>
            </Card>
          </div>
        </InlineStack>

        {/* Recent claims table */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingSm" as="h2">Recent claims (last 50)</Text>
            {loading && !data ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                <Spinner size="small" />
              </div>
            ) : !data?.recent.length ? (
              <Text tone="subdued" as="p">No claims yet.</Text>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                      {['Time', 'Code', 'Source', 'Device', 'Cart value', 'Discount'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#6B7280', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '8px 10px', color: '#374151', whiteSpace: 'nowrap' }}>{fmt(r.createdAt)}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 600 }}>{r.recoveryCode ?? '—'}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <Badge tone={r.source === 'checkout_claim' ? 'info' : 'new'}>
                            {r.source ?? '—'}
                          </Badge>
                        </td>
                        <td style={{ padding: '8px 10px', color: '#6B7280' }}>{r.device ?? '—'}</td>
                        <td style={{ padding: '8px 10px', color: '#374151' }}>{fmtCart(r.cartValueAtFailure)}</td>
                        <td style={{ padding: '8px 10px', color: '#374151' }}>{fmtDiscount(r.discountValue, r.discountType)}</td>
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
