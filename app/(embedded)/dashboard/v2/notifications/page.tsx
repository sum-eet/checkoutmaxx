'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Page,
  Layout,
  Card,
  Text,
  InlineStack,
  BlockStack,
  Tabs,
  EmptyState,
  Banner,
  SkeletonBodyText,
  Button,
} from '@shopify/polaris';
import { useShop } from '@/hooks/useShop';
import { DateRangeSelector, type DateRange } from '@/components/monitor/DateRangeSelector';

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86400000);
}
const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Alert = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  body: string;
  occurredAt: string;
  isRead: boolean;
  isDismissed: boolean;
  linkType: 'overview' | 'discounts' | 'cart' | null;
  linkCode: string | null;
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const hours = diff / 3600000;
  if (hours < 1) return `${Math.round(diff / 60000)} minutes ago`;
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  if (hours < 48) return `Yesterday at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ` at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
}

function linkPath(alert: Alert): string {
  if (alert.linkType === 'overview') return '/dashboard/v2/overview';
  if (alert.linkType === 'discounts') return '/dashboard/v2/discounts';
  if (alert.linkType === 'cart') return '/dashboard/v2/cart';
  return '#';
}

const TAB_SEVERITY = ['all', 'critical', 'warning', 'info', 'dismissed'];

export default function NotificationsPage() {
  const shop = useShop();
  const now = new Date();
  const [range, setRange] = useState<DateRange>({ start: subDays(now, 7), end: now });
  const [activeTab, setActiveTab] = useState(0);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const severity = TAB_SEVERITY[activeTab];
  const rangeQuery = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
  const url = shop
    ? `/api/v2/notifications?shop=${shop}&${rangeQuery}&severity=${severity === 'dismissed' ? 'all' : severity}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, { refreshInterval: 60000 });

  const summary = data?.summary;
  const rawAlerts: Alert[] = data?.alerts ?? [];

  // Apply client-side dismiss filter
  let alerts = rawAlerts.filter((a) => !dismissed.has(a.id));
  if (severity === 'dismissed') {
    alerts = rawAlerts.filter((a) => dismissed.has(a.id));
  }

  async function markAsRead(alertId: string) {
    // Optimistic update
    mutate(
      (curr: typeof data) => ({
        ...curr,
        alerts: (curr?.alerts ?? []).map((a: Alert) =>
          a.id === alertId ? { ...a, isRead: true } : a
        ),
      }),
      false
    );

    try {
      const res = await fetch(`/api/v2/notifications/${alertId}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop }),
      });
      if (!res.ok) {
        mutate(); // revert
      }
    } catch {
      mutate(); // revert on network error
    }
  }

  async function markAllAsRead() {
    const unread = rawAlerts.filter((a) => !a.isRead);
    for (const alert of unread) {
      await markAsRead(alert.id);
    }
  }

  function dismissAlert(id: string) {
    setDismissed((prev) => new Set([...Array.from(prev), id]));
  }

  const tabs = [
    { id: 'all', content: 'All' },
    { id: 'critical', content: 'Critical' },
    { id: 'warning', content: 'Warnings' },
    { id: 'info', content: 'Info' },
    { id: 'dismissed', content: 'Dismissed' },
  ];

  return (
    <Page
      title="Notifications"
      primaryAction={<DateRangeSelector value={range} onChange={setRange} />}
    >
      {error && (
        <Banner tone="critical" title="Failed to load notifications">
          <p>Please refresh the page.</p>
        </Banner>
      )}

      <Layout>
        {/* Summary strip */}
        <Layout.Section>
          <InlineStack align="space-between" blockAlign="center">
            {summary && (
              <Text as="p" tone="subdued" variant="bodySm">
                {summary.unread} unread  ·  {summary.critical} critical  ·  {summary.warnings} warnings
              </Text>
            )}
            {summary && summary.unread > 0 && (
              <Button variant="plain" size="slim" onClick={markAllAsRead}>
                Mark all as read
              </Button>
            )}
          </InlineStack>
        </Layout.Section>

        {/* Tabs + list */}
        <Layout.Section>
          <Card>
            <Tabs
              tabs={tabs}
              selected={activeTab}
              onSelect={setActiveTab}
            >
              {isLoading ? (
                <div style={{ padding: 16 }}>
                  <SkeletonBodyText lines={5} />
                </div>
              ) : alerts.length === 0 ? (
                <div style={{ padding: 16 }}>
                  <EmptyState heading="No alerts in this period" image="">
                    <p>Alerts fire when conversion drops, coupons fail, or anomalies are detected.</p>
                  </EmptyState>
                </div>
              ) : (
                <div>
                  {alerts.map((alert) => {
                    const dotColor =
                      alert.severity === 'critical' ? '#d82c0d' :
                      alert.severity === 'warning' ? '#b98900' : '#2c6ecb';
                    const borderColor = !alert.isRead ? dotColor : 'transparent';

                    return (
                      <div
                        key={alert.id}
                        onClick={() => !alert.isRead && markAsRead(alert.id)}
                        style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid #f4f6f8',
                          borderLeft: `3px solid ${borderColor}`,
                          background: alert.isRead ? '#fff' : '#fafbfd',
                          cursor: alert.isRead ? 'default' : 'pointer',
                          display: 'flex',
                          gap: 12,
                          alignItems: 'flex-start',
                        }}
                      >
                        {/* Severity dot */}
                        <span style={{
                          width: 10, height: 10, borderRadius: '50%',
                          background: dotColor, flexShrink: 0, marginTop: 4,
                        }} />

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: alert.isRead ? 400 : 600, color: '#202223' }}>
                                {alert.title}
                              </div>
                              <div style={{ fontSize: 13, color: '#6d7175', marginTop: 2 }}>
                                {alert.body}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                              <span style={{ fontSize: 12, color: '#6d7175', whiteSpace: 'nowrap' }}>
                                {formatTimestamp(alert.occurredAt)}
                              </span>
                              {alert.linkType && (
                                <a
                                  href={linkPath(alert)}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ fontSize: 13, color: '#2c6ecb', textDecoration: 'none', whiteSpace: 'nowrap' }}
                                >
                                  View →
                                </a>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); dismissAlert(alert.id); }}
                                style={{
                                  border: 'none', background: 'none', cursor: 'pointer',
                                  color: '#6d7175', fontSize: 16, padding: '0 4px',
                                }}
                                title="Dismiss"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
