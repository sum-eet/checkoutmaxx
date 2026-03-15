'use client';

import { useState, useCallback, useOptimistic, startTransition } from 'react';
import useSWR, { mutate } from 'swr';
import {
  Page, Layout, Card, Text, InlineStack, BlockStack,
  Badge, Button, Divider, SkeletonBodyText, EmptyState,
} from '@shopify/polaris';
import { useShop } from '@/hooks/useShop';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Alert = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  body: string;
  occurredAt: string;
  isRead: boolean;
  isDismissed: boolean;
};

type NotifData = {
  alerts: Alert[];
  unreadCount: number;
  criticalCount: number;
  warningCount: number;
};

type Tab = 'all' | 'critical' | 'warning' | 'info' | 'dismissed' | 'settings';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#d72c0d',
  warning: '#916a00',
  info: '#378ADD',
};

const SEVERITY_TONES: Record<string, 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Settings config — describes what alert types exist and how they are routed
const ALERT_SETTINGS = [
  { key: 'cart_abandoned', label: 'Cart abandoned', description: 'Fires when a session ends without checkout', channels: ['Email', 'Slack'] },
  { key: 'high_value_abandoned', label: 'High-value cart abandoned', description: 'Cart value above $150 abandons', channels: ['Email', 'Slack'] },
  { key: 'coupon_error', label: 'Coupon error', description: 'A discount code fails to apply', channels: ['Slack'] },
  { key: 'checkout_slow', label: 'Slow checkout load', description: 'Checkout load time exceeds 5 s', channels: ['Slack'] },
  { key: 'spike_abandonment', label: 'Abandonment spike', description: 'Hourly abandonment rate climbs > 20% above normal', channels: ['Email', 'Slack'] },
];

function AlertRow({ alert, onDismiss, onRead }: {
  alert: Alert;
  onDismiss: (id: string) => void;
  onRead: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 0',
        borderBottom: '1px solid #f4f6f8',
        opacity: alert.isDismissed ? 0.45 : 1,
      }}
      onClick={() => !alert.isRead && onRead(alert.id)}
    >
      {/* Severity stripe */}
      <div style={{
        width: 3,
        borderRadius: 2,
        alignSelf: 'stretch',
        background: SEVERITY_COLORS[alert.severity] ?? '#888780',
        flexShrink: 0,
      }} />

      {/* Unread dot */}
      <div style={{ paddingTop: 5, flexShrink: 0, width: 8 }}>
        {!alert.isRead && !alert.isDismissed && (
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: SEVERITY_COLORS[alert.severity] }} />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: alert.isRead ? 400 : 600, color: '#202223' }}>{alert.title}</span>
          <Badge tone={SEVERITY_TONES[alert.severity]}>{alert.severity}</Badge>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#6d7175', lineHeight: 1.4 }}>{alert.body}</p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9fa1a4' }}>{timeAgo(alert.occurredAt)}</p>
      </div>

      {/* Dismiss */}
      {!alert.isDismissed && (
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(alert.id); }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#9fa1a4',
            fontSize: 18, lineHeight: 1, padding: '2px 4px', flexShrink: 0,
          }}
          title="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  const shop = useShop();
  const [tab, setTab] = useState<Tab>('all');

  const swrKey = shop ? `/api/v3/notifications?shop=${shop}` : null;
  const { data, isLoading } = useSWR<NotifData>(swrKey, fetcher, { revalidateOnFocus: false });

  const alerts: Alert[] = data?.alerts ?? [];

  // Optimistic read/dismiss state
  const [localOverrides, setLocalOverrides] = useState<Record<string, Partial<Alert>>>({});

  const mergedAlerts: Alert[] = alerts.map((a) => ({ ...a, ...(localOverrides[a.id] ?? {}) }));

  const handleRead = useCallback(async (id: string) => {
    setLocalOverrides((prev) => ({ ...prev, [id]: { ...prev[id], isRead: true } }));
    await fetch(`/api/v3/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({ shop }) });
    mutate(swrKey);
  }, [shop, swrKey]);

  const handleDismiss = useCallback(async (id: string) => {
    setLocalOverrides((prev) => ({ ...prev, [id]: { ...prev[id], isDismissed: true, isRead: true } }));
    await fetch(`/api/v3/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({ shop }) });
    mutate(swrKey);
  }, [shop, swrKey]);

  const handleMarkAllRead = useCallback(async () => {
    const unread = mergedAlerts.filter((a) => !a.isRead && !a.isDismissed);
    const overrides: Record<string, Partial<Alert>> = {};
    unread.forEach((a) => { overrides[a.id] = { isRead: true }; });
    setLocalOverrides((prev) => ({ ...prev, ...overrides }));
    await Promise.all(unread.map((a) =>
      fetch(`/api/v3/notifications/${a.id}/read`, { method: 'POST', body: JSON.stringify({ shop }) })
    ));
    mutate(swrKey);
  }, [mergedAlerts, shop, swrKey]);

  const unreadCount = mergedAlerts.filter((a) => !a.isRead && !a.isDismissed).length;
  const criticalCount = mergedAlerts.filter((a) => a.severity === 'critical' && !a.isDismissed).length;
  const warningCount = mergedAlerts.filter((a) => a.severity === 'warning' && !a.isDismissed).length;

  const filtered = mergedAlerts.filter((a) => {
    if (tab === 'all') return !a.isDismissed;
    if (tab === 'critical') return a.severity === 'critical' && !a.isDismissed;
    if (tab === 'warning') return a.severity === 'warning' && !a.isDismissed;
    if (tab === 'info') return a.severity === 'info' && !a.isDismissed;
    if (tab === 'dismissed') return a.isDismissed;
    return false;
  });

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: mergedAlerts.filter((a) => !a.isDismissed).length },
    { key: 'critical', label: 'Critical', count: criticalCount },
    { key: 'warning', label: 'Warnings', count: warningCount },
    { key: 'info', label: 'Info' },
    { key: 'dismissed', label: 'Dismissed' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <Page
      title="Notifications"
      subtitle="Alerts from your checkout funnel"
    >
      <Layout>

        {/* Summary bar */}
        <Layout.Section>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <InlineStack gap="400">
                <Text as="p" variant="bodySm">
                  <span style={{ fontWeight: 600 }}>{unreadCount}</span> unread
                </Text>
                <Text as="p" variant="bodySm" tone="critical">
                  <span style={{ fontWeight: 600 }}>{criticalCount}</span> critical
                </Text>
                <Text as="p" variant="bodySm">
                  <span style={{ fontWeight: 600 }}>{warningCount}</span> warnings
                </Text>
              </InlineStack>
              {unreadCount > 0 && (
                <Button variant="plain" onClick={handleMarkAllRead}>Mark all read</Button>
              )}
            </div>
          </Card>
        </Layout.Section>

        {/* Tab bar */}
        <Layout.Section>
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e1e3e5', paddingBottom: 0, marginBottom: -1 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: tab === t.key ? 600 : 400,
                  color: tab === t.key ? '#202223' : '#6d7175',
                  background: 'none',
                  border: 'none',
                  borderBottom: tab === t.key ? '2px solid #202223' : '2px solid transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span style={{
                    marginLeft: 6,
                    background: t.key === 'critical' ? '#ffd2cc' : '#e4e5e7',
                    color: t.key === 'critical' ? '#d72c0d' : '#202223',
                    borderRadius: 10,
                    padding: '1px 6px',
                    fontSize: 11,
                    fontWeight: 600,
                  }}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </Layout.Section>

        {/* Alert list or Settings tab */}
        <Layout.Section>
          <Card>
            {tab === 'settings' ? (
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Alert settings</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Configure which events trigger alerts and how they are delivered. Channel settings are managed in the Shopify admin.
                </Text>
                <Divider />
                <BlockStack gap="300">
                  {ALERT_SETTINGS.map((setting) => (
                    <div key={setting.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f4f6f8' }}>
                      <div style={{ flex: 1 }}>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">{setting.label}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{setting.description}</Text>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 16 }}>
                        {setting.channels.map((ch) => (
                          <span key={ch} style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            borderRadius: 10,
                            background: ch === 'Slack' ? '#ECE3FC' : '#E3F1FC',
                            color: ch === 'Slack' ? '#5B2EAE' : '#0B5EA5',
                            fontWeight: 600,
                          }}>
                            {ch}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </BlockStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  To enable Slack or email delivery, configure your webhook URL in Settings → Integrations.
                </Text>
              </BlockStack>
            ) : isLoading ? (
              <SkeletonBodyText lines={6} />
            ) : filtered.length === 0 ? (
              <EmptyState heading={tab === 'dismissed' ? 'No dismissed alerts' : 'No alerts'} image="">
                <Text as="p">
                  {tab === 'dismissed'
                    ? 'Alerts you dismiss will appear here.'
                    : 'Alerts will appear here when your checkout funnel triggers them.'}
                </Text>
              </EmptyState>
            ) : (
              <BlockStack gap="0">
                {filtered.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onDismiss={handleDismiss}
                    onRead={handleRead}
                  />
                ))}
              </BlockStack>
            )}
          </Card>
        </Layout.Section>

      </Layout>
    </Page>
  );
}
