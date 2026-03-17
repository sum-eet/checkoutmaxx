'use client';

import { useState, useCallback } from 'react';
import { Popover, DatePicker, Button, Select, InlineStack } from '@shopify/polaris';
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
  { label: 'Today', value: '0' },
  { label: 'Yesterday', value: '1' },
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 14 days', value: '14' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'Custom range', value: 'custom' },
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

function getActivePresetValue(range: DateRange): string {
  for (const p of PRESETS) {
    if (p.value === 'custom') continue;
    const r = getPresetRange(Number(p.value));
    if (Math.abs(r.start.getTime() - range.start.getTime()) < 60000 &&
        Math.abs(r.end.getTime() - range.end.getTime()) < 60000) {
      return p.value;
    }
  }
  return 'custom';
}

export function DateRangePicker({ value, onChange }: Props) {
  const [customPopoverActive, setCustomPopoverActive] = useState(false);
  const [pending, setPending] = useState<DateRange>({ start: value.start, end: value.end });
  const [{ month, year }, setDate] = useState({
    month: value.start.getMonth(),
    year: value.start.getFullYear(),
  });

  const activePreset = getActivePresetValue(value);

  const handleSelectChange = useCallback((selected: string) => {
    if (selected === 'custom') {
      setPending({ start: value.start, end: value.end });
      setDate({ month: value.start.getMonth(), year: value.start.getFullYear() });
      setCustomPopoverActive(true);
    } else {
      onChange(getPresetRange(Number(selected)));
    }
  }, [value, onChange]);

  const handleApply = useCallback(() => {
    onChange(pending);
    setCustomPopoverActive(false);
  }, [onChange, pending]);

  const closePopover = useCallback(() => setCustomPopoverActive(false), []);

  const customLabel = activePreset === 'custom'
    ? `${fmtShort(value.start)} – ${fmtShort(value.end)}`
    : 'Custom range';

  const customActivator = (
    <Button
      icon={CalendarIcon}
      onClick={() => {
        setPending({ start: value.start, end: value.end });
        setDate({ month: value.start.getMonth(), year: value.start.getFullYear() });
        setCustomPopoverActive(true);
      }}
      disclosure={customPopoverActive ? 'up' : 'down'}
      variant={activePreset === 'custom' ? 'primary' : 'secondary'}
    >
      {customLabel}
    </Button>
  );

  return (
    <InlineStack gap="200" blockAlign="center">
      <Select
        label="Date range"
        labelInline
        options={PRESETS.filter((p) => p.value !== 'custom')}
        value={activePreset === 'custom' ? '' : activePreset}
        onChange={handleSelectChange}
        placeholder={activePreset === 'custom' ? 'Presets' : undefined}
      />

      <Popover
        active={customPopoverActive}
        activator={customActivator}
        onClose={closePopover}
        preferredAlignment="right"
        sectioned={false}
      >
        <div style={{ padding: 16, width: 320 }}>
          <div style={{ fontSize: 13, color: '#374151', fontWeight: 500, marginBottom: 10 }}>
            {fmtLong(pending.start)} – {fmtLong(pending.end)}
          </div>
          <DatePicker
            month={month}
            year={year}
            onChange={({ start, end }) => {
              setPending({ start: startOfDay(start), end: endOfDay(end) });
            }}
            onMonthChange={(m, y) => setDate({ month: m, year: y })}
            selected={{ start: pending.start, end: pending.end }}
            allowRange
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <Button onClick={closePopover}>Cancel</Button>
            <Button variant="primary" onClick={handleApply}>Apply</Button>
          </div>
        </div>
      </Popover>
    </InlineStack>
  );
}
