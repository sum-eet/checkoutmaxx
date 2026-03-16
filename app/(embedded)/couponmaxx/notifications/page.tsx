'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { Banner, Spinner } from '@shopify/polaris';
import { useShop } from '@/hooks/useShop';
import { Toggle } from '@/components/couponmaxx/Toggle';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Alert = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  body: string | null;
  occurredAt: string;
  isRead: boolean;
  isDismissed: boolean;
};

type NotificationsResponse = {
  summary: {
    unreadCount: number;
    criticalCount: number;
    warningCount: number;
  };
  alerts: Alert[];
};

type ChannelSettings = {
  critical: boolean;
  warning: boolean;
  info: boolean;
};

type Settings = {
  brokenCoupon: { enabled: boolean; threshold: number; attempts: number };
  cvrDrop: { enabled: boolean; dropPct: number; minutes: number };
  productRestricted: { enabled: boolean };
  zombieCodeSpike: { enabled: boolean };
  couponDegraded: { enabled: boolean; threshold: number };
  stepDropout: { enabled: boolean };
  abandonedAfterFail: { enabled: boolean };
  cartRecoveries: { enabled: boolean };
  newTrafficSource: { enabled: boolean };
  channels: {
    slack: ChannelSettings;
    email: ChannelSettings;
  };
  digest: { enabled: boolean; hour: number; ampm: 'AM' | 'PM' };
};

type SettingsResponse = {
  settings: Settings;
  email: string | null;
  slack: { connected: boolean; channel: string | null };
};

type FilterType = 'All' | 'Critical' | 'Warnings' | 'Info' | 'Dismissed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
});

function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay >= 1) return `${diffDay}d ago`;
  if (diffHr >= 1) return `${diffHr}h ago`;
  if (diffMin >= 1) return `${diffMin}m ago`;
  return 'just now';
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#EF4444',
  warning: '#F59E0B',
  info: '#0EA5E9',
};

const DEFAULT_SETTINGS: Settings = {
  brokenCoupon: { enabled: true, threshold: 10, attempts: 10 },
  cvrDrop: { enabled: true, dropPct: 40, minutes: 30 },
  productRestricted: { enabled: true },
  zombieCodeSpike: { enabled: true },
  couponDegraded: { enabled: true, threshold: 50 },
  stepDropout: { enabled: true },
  abandonedAfterFail: { enabled: true },
  cartRecoveries: { enabled: true },
  newTrafficSource: { enabled: false },
  channels: {
    slack: { critical: true, warning: true, info: false },
    email: { critical: true, warning: false, info: false },
  },
  digest: { enabled: true, hour: 9, ampm: 'AM' },
};

// ---------------------------------------------------------------------------
// Alert row
// ---------------------------------------------------------------------------

function AlertRow({
  alert,
  dismissed,
  onRead,
  onDismiss,
}: {
  alert: Alert;
  dismissed: boolean;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const color = SEVERITY_COLOR[alert.severity] ?? '#0EA5E9';
  const [hoverX, setHoverX] = useState(false);

  return (
    <div
      onClick={() => onRead(alert.id)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 16px',
        borderLeft: `3px solid ${color}`,
        background: alert.isRead ? '#FFFFFF' : '#FAFAFA',
        cursor: 'pointer',
        borderBottom: '1px solid #F3F4F6',
        transition: 'background 0.15s',
      }}
    >
      {/* Dot */}
      <div style={{
        width: 8, height: 8, borderRadius: '50%', background: color,
        flexShrink: 0, marginTop: 4,
      }} />

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#111827', marginBottom: 2 }}>
          {alert.title}
        </div>
        {alert.body && (
          <div style={{ fontSize: 12, color: '#6B7280', lineHeight: '1.4' }}>
            {alert.body}
          </div>
        )}
      </div>

      {/* Timestamp */}
      <div style={{ fontSize: 11, color: '#9CA3AF', flexShrink: 0, paddingTop: 2 }}>
        {timeAgo(alert.occurredAt)}
      </div>

      {/* Dismiss */}
      {!dismissed && (
        <button
          onClick={(e) => { e.stopPropagation(); onDismiss(alert.id); }}
          onMouseEnter={() => setHoverX(true)}
          onMouseLeave={() => setHoverX(false)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 14, color: hoverX ? '#EF4444' : '#9CA3AF',
            padding: '0 2px', flexShrink: 0, lineHeight: 1,
            transition: 'color 0.15s',
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Alerts
// ---------------------------------------------------------------------------

function AlertsTab({ shopDomain }: { shopDomain: string }) {
  const { data, error, isLoading, mutate } = useSWR<NotificationsResponse>(
    shopDomain ? `/api/couponmaxx/notifications?shop=${shopDomain}` : null,
    fetcher,
    { refreshInterval: 30000 },
  );

  const [filter, setFilter] = useState<FilterType>('All');
  const [localRead, setLocalRead] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const handleMarkAllRead = async () => {
    if (!data) return;
    const unread = data.alerts.filter((a) => !a.isRead && !dismissed.has(a.id));
    const ids = unread.map((a) => a.id);
    setLocalRead((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    // fire off read requests in parallel (best effort)
    await Promise.allSettled(
      ids.map((id) =>
        fetch(`/api/couponmaxx/notifications/${id}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop: shopDomain }),
        }),
      ),
    );
    mutate();
  };

  const handleRead = useCallback(async (id: string) => {
    setLocalRead((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    await fetch(`/api/couponmaxx/notifications/${id}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop: shopDomain }),
    });
  }, [shopDomain]);

  const handleDismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spinner size="small" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 20 }}>
        <Banner tone="critical">Failed to load notifications. Please refresh.</Banner>
      </div>
    );
  }

  const alerts = data.alerts.map((a) => ({
    ...a,
    isRead: a.isRead || localRead.has(a.id),
  }));

  const unreadCount = alerts.filter((a) => !a.isRead && !dismissed.has(a.id)).length;

  const filteredAlerts = alerts.filter((a) => {
    if (filter === 'Dismissed') return dismissed.has(a.id);
    if (dismissed.has(a.id)) return false;
    if (filter === 'All') return true;
    if (filter === 'Critical') return a.severity === 'critical';
    if (filter === 'Warnings') return a.severity === 'warning';
    if (filter === 'Info') return a.severity === 'info';
    return true;
  });

  const FILTERS: FilterType[] = ['All', 'Critical', 'Warnings', 'Info', 'Dismissed'];

  return (
    <div>
      {/* Summary bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <span style={{ fontSize: 12, color: '#6B7280' }}>
          <strong style={{ color: '#111827' }}>{unreadCount}</strong> unread
          {' · '}
          <strong style={{ color: '#111827' }}>{data.summary.criticalCount}</strong> critical
          {' · '}
          <strong style={{ color: '#111827' }}>{data.summary.warningCount}</strong> warnings
        </span>
        <button
          onClick={handleMarkAllRead}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: '#0EA5E9', padding: 0,
          }}
        >
          Mark all read
        </button>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 12, padding: '4px 10px', borderRadius: 16, cursor: 'pointer',
                background: active ? '#EFF6FF' : '#FFFFFF',
                border: `1px solid ${active ? '#BFDBFE' : '#D1D5DB'}`,
                color: active ? '#1D4ED8' : '#374151',
                fontWeight: active ? 500 : 400,
                transition: 'all 0.15s',
              }}
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* Alert list */}
      <div style={{
        background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8,
        overflow: 'hidden',
      }}>
        {filteredAlerts.length === 0 ? (
          <div style={{
            padding: 40, textAlign: 'center', color: '#6B7280', fontSize: 13,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: '#F3F4F6',
              margin: '0 auto 12px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 18,
            }}>
              🔔
            </div>
            Alerts fire automatically when anomalies are detected.
          </div>
        ) : (
          filteredAlerts.map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              dismissed={dismissed.has(alert.id)}
              onRead={handleRead}
              onDismiss={handleDismiss}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Settings
// ---------------------------------------------------------------------------

function SettingsTab({ shopDomain }: { shopDomain: string }) {
  const { data, error, isLoading } = useSWR<SettingsResponse>(
    shopDomain ? `/api/couponmaxx/settings?shop=${shopDomain}` : null,
    fetcher,
  );

  // Local settings state (initialised from API)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [email, setEmail] = useState<string>('');
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackChannel, setSlackChannel] = useState<string | null>(null);

  // Save status states
  const [triggerSaved, setTriggerSaved] = useState(false);
  const [triggerError, setTriggerError] = useState(false);
  const [channelSaved, setChannelSaved] = useState(false);
  const [channelError, setChannelError] = useState(false);
  const [digestSaved, setDigestSaved] = useState(false);
  const [digestError, setDigestError] = useState(false);

  // Seed state from API once loaded
  useEffect(() => {
    if (!data) return;
    setSettings(data.settings as Settings);
    setEmail(data.email ?? '');
    setEmailDraft(data.email ?? '');
    setSlackConnected(data.slack.connected);
    setSlackChannel(data.slack.channel);
  }, [data]);

  const updateSetting = <K extends keyof Settings>(
    key: K,
    patch: Partial<Settings[K]>,
  ) => {
    setSettings((prev) => ({
      ...prev,
      [key]: { ...(prev[key] as object), ...patch },
    }));
  };

  const updateChannel = (
    channel: 'slack' | 'email',
    patch: Partial<ChannelSettings>,
  ) => {
    setSettings((prev) => ({
      ...prev,
      channels: {
        ...prev.channels,
        [channel]: { ...prev.channels[channel], ...patch },
      },
    }));
  };

  const saveTriggers = async () => {
    setTriggerSaved(false);
    setTriggerError(false);
    try {
      const res = await fetch('/api/couponmaxx/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: shopDomain, settings }),
      });
      if (!res.ok) throw new Error('Failed');
      setTriggerSaved(true);
      setTimeout(() => setTriggerSaved(false), 3000);
    } catch {
      setTriggerError(true);
      setTimeout(() => setTriggerError(false), 3000);
    }
  };

  const saveChannels = async () => {
    setChannelSaved(false);
    setChannelError(false);
    const resolvedEmail = editingEmail ? emailDraft : email;
    try {
      const res = await fetch('/api/couponmaxx/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: shopDomain, settings, email: resolvedEmail }),
      });
      if (!res.ok) throw new Error('Failed');
      if (editingEmail) { setEmail(emailDraft); setEditingEmail(false); }
      setChannelSaved(true);
      setTimeout(() => setChannelSaved(false), 3000);
    } catch {
      setChannelError(true);
      setTimeout(() => setChannelError(false), 3000);
    }
  };

  const saveDigest = async () => {
    setDigestSaved(false);
    setDigestError(false);
    try {
      const res = await fetch('/api/couponmaxx/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: shopDomain, settings }),
      });
      if (!res.ok) throw new Error('Failed');
      setDigestSaved(true);
      setTimeout(() => setDigestSaved(false), 3000);
    } catch {
      setDigestError(true);
      setTimeout(() => setDigestError(false), 3000);
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spinner size="small" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <Banner tone="critical">Failed to load settings. Please refresh.</Banner>
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    border: '1px solid #D1D5DB', borderRadius: 6, padding: '4px 8px',
    fontSize: 13, color: '#111827', width: 64, outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: '#111827',
  };

  const descStyle: React.CSSProperties = {
    fontSize: 12, color: '#6B7280', marginTop: 2,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    padding: '12px 0', borderBottom: '1px solid #F3F4F6',
  };

  const thresholdRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, marginTop: 6,
    fontSize: 12, color: '#6B7280', flexWrap: 'wrap',
  };

  const saveBtnStyle: React.CSSProperties = {
    background: '#0EA5E9', color: '#FFFFFF', border: 'none',
    borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 500,
    cursor: 'pointer',
  };

  // ---- Trigger rows definition ----
  type TriggerRow =
    | { key: 'brokenCoupon'; label: string; desc: string; kind: 'brokenCoupon' }
    | { key: 'cvrDrop'; label: string; desc: string; kind: 'cvrDrop' }
    | { key: 'productRestricted'; label: string; desc: string; kind: 'simple' }
    | { key: 'zombieCodeSpike'; label: string; desc: string; kind: 'simple' }
    | { key: 'couponDegraded'; label: string; desc: string; kind: 'couponDegraded' }
    | { key: 'stepDropout'; label: string; desc: string; kind: 'simple' }
    | { key: 'abandonedAfterFail'; label: string; desc: string; kind: 'simple' }
    | { key: 'cartRecoveries'; label: string; desc: string; kind: 'simple' }
    | { key: 'newTrafficSource'; label: string; desc: string; kind: 'simple' };

  const triggerRows: TriggerRow[] = [
    { key: 'brokenCoupon', label: 'Broken coupon', desc: 'Fires when a code gets many failures rapidly', kind: 'brokenCoupon' },
    { key: 'cvrDrop', label: 'CVR drop', desc: 'Checkout conversion drops sharply from baseline', kind: 'cvrDrop' },
    { key: 'productRestricted', label: 'Product-restricted coupon', desc: 'Code succeeds on some products but fails on others', kind: 'simple' },
    { key: 'zombieCodeSpike', label: 'Zombie code spike', desc: 'Unknown codes being tried repeatedly', kind: 'simple' },
    { key: 'couponDegraded', label: 'Coupon degraded', desc: 'Code success rate is getting low', kind: 'couponDegraded' },
    { key: 'stepDropout', label: 'Step dropout spike', desc: 'Unusual dropout at a checkout step', kind: 'simple' },
    { key: 'abandonedAfterFail', label: 'Abandoned after failure', desc: 'Customers leaving after a failed code', kind: 'simple' },
    { key: 'cartRecoveries', label: 'Cart recoveries', desc: 'Customers are adding items to unlock threshold discounts', kind: 'simple' },
    { key: 'newTrafficSource', label: 'New traffic source', desc: "A UTM source we haven't seen before", kind: 'simple' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ---- Sub-section 1: Alert triggers ---- */}
      <div style={{
        background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8, padding: 20,
      }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>Alert triggers</div>
          <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>
            Choose which events send a notification
          </div>
        </div>

        {triggerRows.map((row) => {
          const s = settings[row.key] as { enabled: boolean } & Record<string, unknown>;
          return (
            <div key={row.key} style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <div style={{ paddingTop: 2 }}>
                <Toggle
                  checked={s.enabled}
                  onChange={(v) => updateSetting(row.key, { enabled: v } as Partial<Settings[typeof row.key]>)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={labelStyle}>{row.label}</div>
                <div style={descStyle}>{row.desc}</div>

                {row.kind === 'brokenCoupon' && s.enabled && (
                  <div style={thresholdRowStyle}>
                    Fire when success rate drops below
                    <input
                      type="number"
                      value={(settings.brokenCoupon.threshold)}
                      onChange={(e) => updateSetting('brokenCoupon', { threshold: Number(e.target.value) })}
                      style={inputStyle}
                      min={0} max={100}
                    />
                    % after
                    <input
                      type="number"
                      value={(settings.brokenCoupon.attempts)}
                      onChange={(e) => updateSetting('brokenCoupon', { attempts: Number(e.target.value) })}
                      style={inputStyle}
                      min={1}
                    />
                    attempts
                  </div>
                )}

                {row.kind === 'cvrDrop' && s.enabled && (
                  <div style={thresholdRowStyle}>
                    Fire when CVR drops
                    <input
                      type="number"
                      value={(settings.cvrDrop.dropPct)}
                      onChange={(e) => updateSetting('cvrDrop', { dropPct: Number(e.target.value) })}
                      style={inputStyle}
                      min={1} max={100}
                    />
                    % below baseline for
                    <input
                      type="number"
                      value={(settings.cvrDrop.minutes)}
                      onChange={(e) => updateSetting('cvrDrop', { minutes: Number(e.target.value) })}
                      style={inputStyle}
                      min={1}
                    />
                    minutes
                  </div>
                )}

                {row.kind === 'couponDegraded' && s.enabled && (
                  <div style={thresholdRowStyle}>
                    Fire when success rate drops below
                    <input
                      type="number"
                      value={(settings.couponDegraded.threshold)}
                      onChange={(e) => updateSetting('couponDegraded', { threshold: Number(e.target.value) })}
                      style={inputStyle}
                      min={0} max={100}
                    />
                    %
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 16, gap: 12 }}>
          {triggerSaved && <span style={{ fontSize: 13, color: '#16A34A' }}>Settings saved</span>}
          {triggerError && <span style={{ fontSize: 13, color: '#EF4444' }}>Save failed — please try again</span>}
          <button onClick={saveTriggers} style={saveBtnStyle}>Save</button>
        </div>
      </div>

      {/* ---- Sub-section 2: Notification channels ---- */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Slack card */}
        <div style={{
          background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8, padding: 20,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 12 }}>Slack</div>

          {slackConnected ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A' }} />
                <span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>Connected</span>
              </div>
              {slackChannel && (
                <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>
                  #{slackChannel}
                </div>
              )}
              <button
                onClick={() => { setSlackConnected(false); setSlackChannel(null); }}
                style={{
                  background: 'none', border: '1px solid #D1D5DB', borderRadius: 6,
                  padding: '4px 10px', fontSize: 12, color: '#6B7280', cursor: 'pointer',
                }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#D1D5DB' }} />
                <span style={{ fontSize: 13, color: '#6B7280' }}>Not connected</span>
              </div>
              {/* Slack OAuth — server-side redirect handles client_id + redirect_uri */}
              <a
                href={`/api/couponmaxx/slack/auth?shop=${shopDomain}`}
                style={{
                  display: 'inline-block', background: '#0EA5E9', color: '#FFFFFF',
                  borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                Connect Slack
              </a>
            </div>
          )}

          {/* Per-severity channel toggles */}
          <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(['critical', 'warning', 'info'] as const).map((sev) => (
              <div key={sev} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#374151', textTransform: 'capitalize' }}>
                  {sev === 'warning' ? 'Warnings' : sev.charAt(0).toUpperCase() + sev.slice(1)}
                </span>
                <Toggle
                  checked={settings.channels.slack[sev]}
                  onChange={(v) => updateChannel('slack', { [sev]: v })}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Email card */}
        <div style={{
          background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8, padding: 20,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 12 }}>Email</div>

          <div style={{ marginBottom: 16 }}>
            {editingEmail ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="email"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  placeholder="you@example.com"
                  style={{
                    ...inputStyle, width: 'auto', flex: 1,
                  }}
                />
                <button
                  onClick={() => setEditingEmail(false)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 12, color: '#6B7280', padding: '4px 6px',
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: email ? '#111827' : '#9CA3AF' }}>
                  {email || 'No email set'}
                </span>
                <button
                  onClick={() => { setEditingEmail(true); setEmailDraft(email); }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 12, color: '#0EA5E9', padding: 0,
                  }}
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {/* Per-severity channel toggles */}
          <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(['critical', 'warning', 'info'] as const).map((sev) => (
              <div key={sev} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#374151', textTransform: 'capitalize' }}>
                  {sev === 'warning' ? 'Warnings' : sev.charAt(0).toUpperCase() + sev.slice(1)}
                </span>
                <Toggle
                  checked={settings.channels.email[sev]}
                  onChange={(v) => updateChannel('email', { [sev]: v })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Save channels button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        {channelSaved && <span style={{ fontSize: 13, color: '#16A34A' }}>Settings saved</span>}
        {channelError && <span style={{ fontSize: 13, color: '#EF4444' }}>Save failed — please try again</span>}
        <button onClick={saveChannels} style={saveBtnStyle}>Save channels</button>
      </div>

      {/* ---- Sub-section 3: Weekly digest ---- */}
      <div style={{
        background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8, padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>Weekly digest</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>
              A summary email sent every Monday morning
            </div>
          </div>
          <Toggle
            checked={settings.digest.enabled}
            onChange={(v) => updateSetting('digest', { enabled: v })}
          />
        </div>

        {settings.digest.enabled && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#374151' }}>
              <span>Every Monday at</span>
              <select
                value={settings.digest.hour}
                onChange={(e) => updateSetting('digest', { hour: Number(e.target.value) })}
                style={{
                  border: '1px solid #D1D5DB', borderRadius: 6, padding: '4px 8px',
                  fontSize: 13, color: '#111827', background: '#FFFFFF',
                }}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <span>:00</span>
              <select
                value={settings.digest.ampm}
                onChange={(e) => updateSetting('digest', { ampm: e.target.value as 'AM' | 'PM' })}
                style={{
                  border: '1px solid #D1D5DB', borderRadius: 6, padding: '4px 8px',
                  fontSize: 13, color: '#111827', background: '#FFFFFF',
                }}
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>
              Sending in your store timezone
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 16, gap: 12 }}>
          {digestSaved && <span style={{ fontSize: 13, color: '#16A34A' }}>Settings saved</span>}
          {digestError && <span style={{ fontSize: 13, color: '#EF4444' }}>Save failed — please try again</span>}
          <button onClick={saveDigest} style={saveBtnStyle}>Save digest settings</button>
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function NotificationsPageInner() {
  const shopDomain = useShop();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'alerts' | 'settings'>('alerts');
  const [slackBanner, setSlackBanner] = useState<'connected' | 'error' | null>(null);

  useEffect(() => {
    const slack = searchParams.get('slack');
    const error = searchParams.get('error');
    if (slack === 'connected') setSlackBanner('connected');
    else if (error === 'slack_oauth_failed') setSlackBanner('error');
  }, [searchParams]);

  const tabStyle = (tab: 'alerts' | 'settings'): React.CSSProperties => ({
    fontSize: 14,
    fontWeight: activeTab === tab ? 500 : 400,
    color: activeTab === tab ? '#111827' : '#6B7280',
    borderBottom: activeTab === tab ? '2px solid #0EA5E9' : '2px solid transparent',
    background: 'none',
    border: 'none',
    borderBottomStyle: 'solid',
    borderBottomWidth: 2,
    borderBottomColor: activeTab === tab ? '#0EA5E9' : 'transparent',
    cursor: 'pointer',
    padding: '10px 4px',
    marginRight: 20,
  });

  return (
    <div style={{ background: '#F1F1F1', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>

        {/* Page header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#111827', margin: 0, marginBottom: 4 }}>
            Notifications
          </h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
            Alerts when something needs your attention. Configure triggers and channels in Settings.
          </p>
        </div>

        {/* Slack OAuth banners */}
        {slackBanner === 'connected' && (
          <div style={{ marginBottom: 16 }}>
            <Banner
              tone="success"
              onDismiss={() => setSlackBanner(null)}
            >
              Slack connected successfully.
            </Banner>
          </div>
        )}
        {slackBanner === 'error' && (
          <div style={{ marginBottom: 16 }}>
            <Banner
              tone="critical"
              onDismiss={() => setSlackBanner(null)}
            >
              Slack connection failed. Please try again.
            </Banner>
          </div>
        )}

        {/* Tab bar */}
        <div style={{
          borderBottom: '1px solid #E3E3E3',
          marginBottom: 20,
          display: 'flex',
        }}>
          <button style={tabStyle('alerts')} onClick={() => setActiveTab('alerts')}>
            Alerts
          </button>
          <button style={tabStyle('settings')} onClick={() => setActiveTab('settings')}>
            Settings
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'alerts' ? (
          <AlertsTab shopDomain={shopDomain} />
        ) : (
          <SettingsTab shopDomain={shopDomain} />
        )}
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense>
      <NotificationsPageInner />
    </Suspense>
  );
}
