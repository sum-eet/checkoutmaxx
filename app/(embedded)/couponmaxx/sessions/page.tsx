'use client';

import { useState, useEffect, useCallback } from 'react';
import { Banner, BlockStack, Card, Page, Spinner, Text, Badge } from '@shopify/polaris';
import { fetcher } from '@/lib/admin-fetch';

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

type TimelineEvent = {
  source: 'cart' | 'checkout';
  eventType: string;
  couponCode?: string | null;
  discountCode?: string | null;
  couponFailReason?: string | null;
  errorMessage?: string | null;
  cartValue?: number | null;
  totalPrice?: number | null;
  lineItems?: any[] | null;
  occurredAt: string;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  const codes = attempts.map(a => a.code ?? '?');
  if (codes.length <= 3) return codes.join(', ');
  return codes.slice(0, 3).join(', ') + ` +${codes.length - 3}`;
}

const EVENT_LABELS: Record<string, string> = {
  page_viewed: 'Page viewed',
  cart_viewed: 'Cart viewed',
  product_viewed: 'Product viewed',
  product_added_to_cart: 'Added to cart',
  product_removed_from_cart: 'Removed from cart',
  cart_drawer_opened: 'Cart opened',
  cart_drawer_closed: 'Cart closed',
  cart_checkout_clicked: 'Checkout clicked',
  checkout_started: 'Checkout started',
  checkout_completed: 'Order completed',
  cart_coupon_applied: '✓ Coupon applied',
  checkout_coupon_applied: '✓ Coupon applied',
  cart_coupon_recovered: '✓ Coupon recovered',
  cart_coupon_failed: '✗ Coupon rejected',
  checkout_coupon_failed: '✗ Coupon rejected',
  checkout_discount_code_applied: '✓ Discount applied',
  checkout_discount_code_rejected: '✗ Discount rejected',
  alert_displayed: '✗ Alert shown',
  cart_atc_clicked: 'Add-to-cart clicked',
  cart_page_hidden: 'Left cart page',
};

function eventDotColor(eventType: string): string {
  if (eventType.includes('applied') || eventType.includes('completed') || eventType.includes('recovered')) return '#16A34A';
  if (eventType.includes('failed') || eventType.includes('rejected') || eventType === 'alert_displayed') return '#EF4444';
  if (eventType === 'checkout_started' || eventType === 'cart_checkout_clicked') return '#2563EB';
  return '#9CA3AF';
}

function eventDetail(ev: TimelineEvent): string | null {
  const code = ev.couponCode || ev.discountCode;
  const parts: string[] = [];
  if (code) parts.push(code);
  if (ev.couponFailReason && ev.couponFailReason !== 'rejected') parts.push(ev.couponFailReason);
  if (ev.errorMessage) parts.push(ev.errorMessage);
  if (ev.cartValue) parts.push('cart ' + fmtCart(ev.cartValue));
  if (ev.totalPrice) parts.push('total $' + Number(ev.totalPrice).toFixed(2));
  return parts.length ? parts.join(' · ') : null;
}

function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (!events.length) {
    return <Text tone="subdued" as="p">No events found for this session.</Text>;
  }
  return (
    <div>
      {events.map((ev, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, paddingBottom: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: eventDotColor(ev.eventType), marginTop: 4 }} />
            {i < events.length - 1 && <div style={{ width: 1, flex: 1, background: '#E5E7EB', marginTop: 3 }} />}
          </div>
          <div style={{ paddingBottom: 4 }}>
            <div style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>
              {EVENT_LABELS[ev.eventType] ?? ev.eventType}
              <span style={{ fontWeight: 400, color: '#9CA3AF', marginLeft: 6, fontSize: 11 }}>{fmtTime(ev.occurredAt)}</span>
            </div>
            {eventDetail(ev) && (
              <div style={{ fontSize: 12, color: '#6B7280', fontFamily: 'monospace', marginTop: 2 }}>
                {eventDetail(ev)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CartContents({ items }: { items: any[] | null }) {
  return (
    <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #E5E7EB' }}>
      <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cart contents</div>
      {!items ? (
        <div style={{ fontSize: 13, color: '#9CA3AF' }}>
          — <span style={{ fontStyle: 'italic' }}>No line-item snapshot captured in this session.</span>
        </div>
      ) : (
        items.map((item: any, i: number) => (
          <div key={i} style={{ fontSize: 13, color: '#374151', paddingBottom: 4 }}>
            {item.quantity != null ? `${item.quantity}× ` : ''}{item.productTitle ?? 'Unknown product'}
            {item.price != null && <span style={{ color: '#6B7280' }}> — ${(item.price / 100).toFixed(2)}</span>}
          </div>
        ))
      )}
    </div>
  );
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailEvents, setDetailEvents] = useState<TimelineEvent[]>([]);
  const [cartContents, setCartContents] = useState<any[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

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

  async function openDetail(sessionId: string) {
    setSelectedId(sessionId);
    setDetailEvents([]);
    setCartContents(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetcher(`/api/couponmaxx/sessions/${sessionId}`);
      setDetailEvents(res.events ?? []);
      setCartContents(res.cartContents ?? null);
    } catch (e: any) {
      setDetailError(e?.message ?? 'Failed to load');
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setSelectedId(null);
    setDetailEvents([]);
    setCartContents(null);
  }

  return (
    <>
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
                        <tr
                          key={s.sessionId}
                          onClick={() => openDetail(s.sessionId)}
                          style={{
                            borderBottom: '1px solid #F3F4F6',
                            cursor: 'pointer',
                            background: selectedId === s.sessionId ? '#F0F9FF' : undefined,
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = '#F9FAFB'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = selectedId === s.sessionId ? '#F0F9FF' : ''; }}
                        >
                          <td style={{ padding: '8px 10px', color: '#374151', whiteSpace: 'nowrap' }}>{fmt(s.startedAt)}</td>
                          <td style={{ padding: '8px 10px', color: '#6B7280' }}>
                            {[s.device, s.country].filter(Boolean).join(' · ') || '—'}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#374151' }}>{fmtCart(s.cartValue)}</td>
                          <td style={{ padding: '8px 10px', color: '#374151', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {productsCell(s.lineItems)}
                          </td>
                          <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12 }}>
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

      {selectedId && (
        <>
          <div
            onClick={closeDetail}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100 }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 440,
            background: '#fff', zIndex: 101, overflowY: 'auto',
            boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', padding: '24px 24px 40px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <Text variant="headingMd" as="h3">Session timeline</Text>
              <button
                onClick={closeDetail}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#6B7280', lineHeight: 1, padding: '0 4px' }}
              >×</button>
            </div>

            {detailLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                <Spinner size="small" />
              </div>
            ) : detailError ? (
              <Banner tone="critical">{detailError}</Banner>
            ) : (
              <>
                <CartContents items={cartContents} />
                <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Events</div>
                <TimelineList events={detailEvents} />
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
