'use client';

import { useState, useCallback } from 'react';
import { Popover, DatePicker, Button, InlineStack } from '@shopify/polaris';
import { CalendarIcon } from '@shopify/polaris-icons';

export type DateRange = { start: Date; end: Date };

type Props = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  defaultDays?: number;
};

function fmtShort(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtLong(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function subDays(d: Date, n: number) {
  return new Date(d.getTime() - n * 86400000);
}

// Use UTC boundaries so "Last 7 days" sends exact UTC day range regardless of browser timezone.
function startOfDay(d: Date): Date {
  return new Date(d.toISOString().slice(0, 10) + 'T00:00:00.000Z');
}

function endOfDay(d: Date): Date {
  return new Date(d.toISOString().slice(0, 10) + 'T23:59:59.999Z');
}

const PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Yesterday', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

function getPresetRange(days: number): DateRange {
  const now = new Date();
  if (days === 0) return { start: startOfDay(now), end: endOfDay(now) };
  if (days === 1) {
    const yesterday = subDays(now, 1);
    return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
  }
  return { start: startOfDay(subDays(now, days)), end: endOfDay(now) };
}

function getActivePresetDays(range: DateRange): number | null {
  for (const p of PRESETS) {
    const r = getPresetRange(p.days);
    if (Math.abs(r.start.getTime() - range.start.getTime()) < 60000 &&
        Math.abs(r.end.getTime() - range.end.getTime()) < 60000) {
      return p.days;
    }
  }
  return null;
}

export function DateRangePicker({ value, onChange }: Props) {
  const [popoverActive, setPopoverActive] = useState(false);
  const [pending, setPending] = useState<DateRange>({ start: value.start, end: value.end });
  const [{ month, year }, setDate] = useState({
    month: value.start.getMonth(),
    year: value.start.getFullYear(),
  });

  const openPopover = useCallback(() => {
    setPending({ start: value.start, end: value.end });
    setDate({ month: value.start.getMonth(), year: value.start.getFullYear() });
    setPopoverActive(true);
  }, [value]);

  const closePopover = useCallback(() => setPopoverActive(false), []);

  const handleApply = useCallback(() => {
    onChange(pending);
    closePopover();
  }, [onChange, pending, closePopover]);

  const handlePreset = useCallback((days: number) => {
    const range = getPresetRange(days);
    onChange(range);
    closePopover();
  }, [onChange, closePopover]);

  // Build button label
  const activeDays = getActivePresetDays(value);
  const preset = PRESETS.find((p) => p.days === activeDays);
  const presetLabel = preset ? preset.label : 'Custom';
  const dateLabel = `${fmtShort(value.start)} – ${fmtShort(value.end)}`;
  const buttonLabel = `${presetLabel}  ${dateLabel}`;

  const activator = (
    <Button
      icon={CalendarIcon}
      onClick={openPopover}
      disclosure={popoverActive ? 'up' : 'down'}
    >
      {buttonLabel}
    </Button>
  );

  return (
    <Popover
      active={popoverActive}
      activator={activator}
      onClose={closePopover}
      preferredAlignment="right"
      sectioned={false}
    >
      <div style={{ display: 'flex', width: 680, height: 460, overflow: 'hidden' }}>
        {/* Left: preset list */}
        <div style={{
          width: 200,
          borderRight: '1px solid #E5E7EB',
          padding: '8px 0',
          flexShrink: 0,
          overflowY: 'auto',
        }}>
          {PRESETS.map((p) => {
            const previewRange = getPresetRange(p.days);
            const isActive = activeDays === p.days;
            return (
              <div
                key={p.label}
                role="button"
                tabIndex={0}
                onClick={() => handlePreset(p.days)}
                onKeyDown={(e) => e.key === 'Enter' && handlePreset(p.days)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: isActive ? '#F4F4F4' : 'transparent',
                  borderLeft: isActive ? '3px solid #202223' : '3px solid transparent',
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <div style={{
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 400,
                  color: '#202223',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  {p.label}
                  {isActive && <span style={{ fontSize: 12 }}>✓</span>}
                </div>
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                  {fmtShort(previewRange.start)} – {fmtShort(previewRange.end)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: header + buttons (fixed) + calendar (scrollable) */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Range header + action buttons — always visible */}
          <div style={{ padding: '14px 16px 10px', flexShrink: 0, borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 10 }}>
              {fmtLong(pending.start)} → {fmtLong(pending.end)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={closePopover}>Cancel</Button>
              <Button variant="primary" onClick={handleApply}>Apply</Button>
            </div>
          </div>

          {/* Calendar — scrollable */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px' }}>
            <DatePicker
              month={month}
              year={year}
              onChange={({ start, end }) => {
                setPending({ start: startOfDay(start), end: endOfDay(end) });
              }}
              onMonthChange={(m, y) => setDate({ month: m, year: y })}
              selected={{ start: pending.start, end: pending.end }}
              allowRange
              multiMonth
            />
          </div>
        </div>
      </div>
    </Popover>
  );
}
