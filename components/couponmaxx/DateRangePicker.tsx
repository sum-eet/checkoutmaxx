'use client';

import { useState, useCallback } from 'react';
import { Popover, Button, OptionList, DatePicker, BlockStack, InlineStack } from '@shopify/polaris';
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

const PRESETS: { label: string; value: string; days: number }[] = [
  { label: 'Today', value: '0', days: 0 },
  { label: 'Yesterday', value: '1', days: 1 },
  { label: 'Last 7 days', value: '7', days: 7 },
  { label: 'Last 14 days', value: '14', days: 14 },
  { label: 'Last 30 days', value: '30', days: 30 },
  { label: 'Last 90 days', value: '90', days: 90 },
];

function getPresetRange(days: number): DateRange {
  const now = new Date();
  if (days === 0) return { start: startOfDay(now), end: endOfDay(now) };
  if (days === 1) {
    const y = subDays(now, 1);
    return { start: startOfDay(y), end: endOfDay(y) };
  }
  return { start: startOfDay(subDays(now, days)), end: endOfDay(now) };
}

function matchPreset(range: DateRange): string | null {
  for (const p of PRESETS) {
    const r = getPresetRange(p.days);
    if (Math.abs(r.start.getTime() - range.start.getTime()) < 60000 &&
        Math.abs(r.end.getTime() - range.end.getTime()) < 60000) {
      return p.value;
    }
  }
  return null;
}

export function DateRangePicker({ value, onChange }: Props) {
  const [active, setActive] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [pending, setPending] = useState<DateRange>(value);
  const [{ month, year }, setDate] = useState({
    month: value.start.getMonth(),
    year: value.start.getFullYear(),
  });

  const matched = matchPreset(value);
  const presetLabel = PRESETS.find(p => p.value === matched)?.label;
  const buttonLabel = presetLabel
    ? `${presetLabel} (${fmtShort(value.start)} – ${fmtShort(value.end)})`
    : `${fmtShort(value.start)} – ${fmtShort(value.end)}`;

  const handleOpen = useCallback(() => {
    setShowCalendar(false);
    setPending(value);
    setDate({ month: value.start.getMonth(), year: value.start.getFullYear() });
    setActive(true);
  }, [value]);

  const handlePresetSelect = useCallback((selected: string[]) => {
    const val = selected[0];
    if (val === 'custom') {
      setShowCalendar(true);
      return;
    }
    setShowCalendar(false);
    onChange(getPresetRange(Number(val)));
    setActive(false);
  }, [onChange]);

  const handleApply = useCallback(() => {
    onChange(pending);
    setActive(false);
  }, [onChange, pending]);

  const activator = (
    <Button icon={CalendarIcon} onClick={handleOpen} disclosure>
      {buttonLabel}
    </Button>
  );

  return (
    <Popover
      active={active}
      activator={activator}
      onClose={() => setActive(false)}
      preferredAlignment="left"
      fluidContent
    >
      <div style={{ display: 'flex', minWidth: showCalendar ? 420 : 200 }}>
        {/* Left: Presets */}
        <div style={{
          borderRight: showCalendar ? '1px solid var(--p-color-border-subdued)' : 'none',
          minWidth: 160,
        }}>
          <OptionList
            onChange={handlePresetSelect}
            options={[
              ...PRESETS.map(p => ({ label: p.label, value: p.value })),
              { label: 'Custom range...', value: 'custom' },
            ]}
            selected={matched ? [matched] : showCalendar ? ['custom'] : []}
          />
        </div>

        {/* Right: Calendar (only when custom is selected) */}
        {showCalendar && (
          <div style={{ padding: 12 }}>
            <BlockStack gap="300">
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--p-color-text)' }}>
                {fmtShort(pending.start)} – {fmtShort(pending.end)}
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
              <InlineStack gap="200" align="end">
                <Button onClick={() => setShowCalendar(false)}>Back</Button>
                <Button variant="primary" onClick={handleApply}>Apply</Button>
              </InlineStack>
            </BlockStack>
          </div>
        )}
      </div>
    </Popover>
  );
}
