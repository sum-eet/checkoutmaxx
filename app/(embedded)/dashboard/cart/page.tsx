'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import {
  Page,
  Layout,
  Card,
  Text,
  DataTable,
  Badge,
  Tabs,
  Banner,
  Spinner,
  BlockStack,
  InlineStack,
  Box,
  Modal,
  EmptyState,
  Button,
} from '@shopify/polaris';
import { RefreshIcon } from '@shopify/polaris-icons';
import { useShop } from '@/hooks/useShop';

// ── Types ─────────────────────────────────────────────────────────────────────

type CouponAttempt = {
  code: string;
  success: boolean;
  recovered: boolean;
  discountAmount: number | null;
};

type CartSession = {
  sessionId: string;
  cartToken: string;
  firstSeen: string;
  lastSeen: string;
  cartValue: number | null;
  startingCartValue: number | null;
  cartItemCount: number | null;
  lineItems: any[];
  couponsAttempted: CouponAttempt[];
  checkedOut: boolean;
  orderCompleted: boolean;
  checkoutEvents: { eventType: string; occurredAt: string }[];
  country: string | null;
};

type TimelineEvent = {
  source: 'cart' | 'checkout';
  eventType: string;
  occurredAt: string;
  label: string;
  detail: string | null;
  isPositive: boolean | null;
};

type CouponStat = {
  code: string;
  attempts: number;
  successes: number;
  recoveries: number;
  avgCartValue: number | null;
  lastSeen: string;
};

type KPIs = {
  cartsOpened: number;
  cartsWithCoupon: number;
  cartsCheckedOut: number;
  recoveredCarts: number;
  recoveredRevenue: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCents(cents: number | null): string {
  if (cents == null) return '—';
  return '$' + (cents / 100).toFixed(2);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function successRate(successes: number, attempts: number): string {
  if (attempts === 0) return '—';
  return Math.round((successes / attempts) * 100) + '%';
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text variant="bodySm" as="p" tone="subdued">{label}</Text>
        <Text variant="headingLg" as="p">{String(value)}</Text>
        {sub && <Text variant="bodySm" as="p" tone="subdued">{sub}</Text>}
      </BlockStack>
    </Card>
  );
}

// ── Coupon Pills ──────────────────────────────────────────────────────────────

function CouponPills({ coupons }: { coupons: CouponAttempt[] }) {
  if (coupons.length === 0) return <Text as="span" tone="subdued">—</Text>;
  return (
    <InlineStack gap="100" wrap>
      {coupons.map((c) => (
        <Badge key={c.code} tone={c.success ? 'success' : 'critical'}>
          {`${c.recovered ? '^ ' : ''}${c.code}${c.success && c.discountAmount ? ` -${formatCents(c.discountAmount)}` : ''}`}
        </Badge>
      ))}
    </InlineStack>
  );
}

// ── Timeline Modal ────────────────────────────────────────────────────────────

function TimelineModal({
  session,
  open,
  onClose,
  shop,
}: {
  session: CartSession | null;
  open: boolean;
  onClose: () => void;
  shop: string;
}) {
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !session) return;
    setLoading(true);
    fetch(`/api/cart/session?shop=${shop}&sessionId=${session.sessionId}`)
      .then((r) => r.json())
      .then((data) => setTimeline(data.timeline ?? []))
      .finally(() => setLoading(false));
  }, [open, session?.sessionId]);

  if (!session) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Session — ${formatTime(session.firstSeen)}`}
      size="large"
    >
      <Modal.Section>
        <BlockStack gap="200">
          <InlineStack gap="400">
            <Text as="p" variant="bodyMd">
              <strong>Cart value:</strong> {formatCents(session.cartValue)}
            </Text>
            <Text as="p" variant="bodyMd">
              <strong>Items:</strong> {session.cartItemCount ?? '—'}
            </Text>
            <Text as="p" variant="bodyMd">
              <strong>Outcome:</strong>{' '}
              {session.orderCompleted
                ? 'Order completed'
                : session.checkedOut
                ? 'Reached checkout'
                : 'Abandoned'}
            </Text>
          </InlineStack>

          {session.lineItems.length > 0 && (
            <Box paddingBlockStart="300">
              <Text variant="headingSm" as="p">Products in cart</Text>
              <BlockStack gap="100">
                {session.lineItems.map((item: any, i: number) => (
                  <Text key={i} as="p" variant="bodySm">
                    {item.productTitle} x{item.quantity} — {formatCents(item.price)}
                  </Text>
                ))}
              </BlockStack>
            </Box>
          )}
        </BlockStack>
      </Modal.Section>

      <Modal.Section>
        <Text variant="headingSm" as="p">Full journey</Text>
        <Box paddingBlockStart="200">
          {loading ? (
            <Spinner size="small" />
          ) : timeline.length === 0 ? (
            <Text as="p" tone="subdued">No events found</Text>
          ) : (
            <BlockStack gap="200">
              {timeline.map((ev, i) => (
                <InlineStack key={i} gap="300" align="start" blockAlign="start">
                  <Box minWidth="50px">
                    <Text variant="bodySm" as="p" tone="subdued">
                      {formatTime(ev.occurredAt)}
                    </Text>
                  </Box>

                  <Badge tone={ev.source === 'checkout' ? 'info' : undefined}>
                    {ev.source === 'checkout' ? 'Checkout' : 'Cart'}
                  </Badge>

                  <BlockStack gap="050">
                    <Text
                      as="p"
                      variant="bodySm"
                      tone={
                        ev.isPositive === true
                          ? 'success'
                          : ev.isPositive === false
                          ? 'critical'
                          : undefined
                      }
                    >
                      {ev.label}
                    </Text>
                    {ev.detail && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {ev.detail}
                      </Text>
                    )}
                  </BlockStack>
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </Box>
      </Modal.Section>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function CartActivityPage() {
  const shop = useShop();
  const [selectedTab, setSelectedTab] = useState(0);
  const [selectedSession, setSelectedSession] = useState<CartSession | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, isLoading, mutate } = useSWR(
    shop ? `/api/cart/all?shop=${shop}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const kpis: KPIs | null = data?.kpis ?? null;
  const sessions: CartSession[] = data?.sessions ?? [];
  const couponStats: CouponStat[] = data?.couponStats ?? [];
  const loading = isLoading;

  function handleRefresh() {
    setRefreshKey((k) => k + 1);
    fetch(`/api/cart/all?shop=${shop}&refresh=1`).then((r) => r.json()).then(() => mutate());
  }

  const tabs = [
    { id: 'sessions', content: 'Cart Sessions' },
    { id: 'coupons', content: 'Coupon Intelligence' },
  ];

  const sessionRows = sessions.map((s) => [
    <Text as="span" variant="bodySm">{formatTime(s.firstSeen)}</Text>,

    <Text as="span" variant="bodySm" tone="subdued">
      {s.country ?? '—'}
    </Text>,

    <Text as="span" variant="bodySm">
      {s.lineItems.length > 0
        ? s.lineItems.map((i: any) => `${i.productTitle} ×${i.quantity}`).join(', ')
        : s.cartItemCount != null && s.cartItemCount > 0
        ? `${s.cartItemCount} item${s.cartItemCount !== 1 ? 's' : ''}`
        : '—'}
    </Text>,

    <Text as="span" variant="bodySm">
      {s.startingCartValue != null ? formatCents(s.startingCartValue) : '—'}
      {s.cartValue != null && s.cartValue !== s.startingCartValue
        ? ` → ${formatCents(s.cartValue)}`
        : ''}
    </Text>,

    <CouponPills coupons={s.couponsAttempted} />,

    s.orderCompleted ? (
      <Badge tone="success">Ordered</Badge>
    ) : s.checkedOut ? (
      <Badge tone="attention">Checkout</Badge>
    ) : (
      <Badge tone="critical">Abandoned</Badge>
    ),

    <span
      style={{ cursor: 'pointer', textDecoration: 'underline', color: '#2c6ecb', fontSize: 13 }}
      onClick={() => {
        setSelectedSession(s);
        setModalOpen(true);
      }}
    >
      View
    </span>,
  ]);

  const couponRows = couponStats.map((c) => [
    <Text as="span" variant="bodySm" fontWeight="semibold">{c.code}</Text>,
    <Text as="span" variant="bodySm">{c.attempts}</Text>,
    <Badge tone={c.successes / c.attempts >= 0.5 ? 'success' : 'critical'}>
      {successRate(c.successes, c.attempts)}
    </Badge>,
    <Text as="span" variant="bodySm">{formatCents(c.avgCartValue)}</Text>,
    c.recoveries > 0 ? (
      <Badge tone="attention">{`${c.recoveries} unlocked after adding items`}</Badge>
    ) : (
      <Text as="span" variant="bodySm" tone="subdued">—</Text>
    ),
    <Text as="span" variant="bodySm" tone="subdued">
      {new Date(c.lastSeen).toLocaleDateString()}
    </Text>,
  ]);

  if (loading) {
    return (
      <Page title="Cart Activity" subtitle="Today's cart sessions — live">
        <Layout>
          <Layout.Section>
            <Card>
              <Box padding="800">
                <InlineStack align="center"><Spinner /></InlineStack>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Cart Activity"
      subtitle="Today's cart sessions — live"
      primaryAction={
        <Button icon={RefreshIcon} onClick={handleRefresh} loading={loading}>
          Refresh
        </Button>
      }
    >
      <Layout>

        <Layout.Section>
          <InlineStack gap="400" wrap>
            <KPICard label="Carts opened" value={kpis?.cartsOpened ?? 0} />
            <KPICard
              label="Coupon attempted"
              value={kpis?.cartsWithCoupon ?? 0}
              sub={
                kpis && kpis.cartsOpened > 0
                  ? `${Math.round((kpis.cartsWithCoupon / kpis.cartsOpened) * 100)}% of carts`
                  : undefined
              }
            />
            <KPICard
              label="Reached checkout"
              value={kpis?.cartsCheckedOut ?? 0}
              sub={
                kpis && kpis.cartsOpened > 0
                  ? `${Math.round((kpis.cartsCheckedOut / kpis.cartsOpened) * 100)}% conversion`
                  : undefined
              }
            />
          </InlineStack>
        </Layout.Section>

        {kpis && kpis.recoveredCarts > 0 && (
          <Layout.Section>
            <Banner tone="success">
              <Text as="p" variant="bodyMd">
                <strong>
                  {kpis.recoveredCarts} customer{kpis.recoveredCarts !== 1 ? 's' : ''}
                </strong>{' '}
                unlocked a discount by adding items after a failed coupon —{' '}
                {formatCents(kpis.recoveredRevenue)} in recovered cart value today.
              </Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box padding="400">

                {selectedTab === 0 && (
                  sessions.length === 0 ? (
                    <EmptyState heading="No cart sessions today yet" image="">
                      <Text as="p">
                        Sessions will appear here as customers interact with their carts.
                      </Text>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text']}
                      headings={['Time', 'Country', 'Products', 'Cart value', 'Coupons', 'Outcome', '']}
                      rows={sessionRows}
                    />
                  )
                )}

                {selectedTab === 1 && (
                  couponStats.length === 0 ? (
                    <EmptyState heading="No coupon data yet" image="">
                      <Text as="p">
                        Coupon attempts will appear here once customers try discount codes.
                      </Text>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={['text', 'numeric', 'text', 'text', 'text', 'text']}
                      headings={['Code', 'Attempts', 'Success rate', 'Avg cart value', 'Unlocked after fail', 'Last used']}
                      rows={couponRows}
                    />
                  )
                )}

              </Box>
            </Tabs>
          </Card>
        </Layout.Section>

      </Layout>

      <TimelineModal
        session={selectedSession}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        shop={shop ?? ''}
      />
    </Page>
  );
}
