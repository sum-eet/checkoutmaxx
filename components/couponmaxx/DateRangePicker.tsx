'use client';

import { useState, useCallback } from 'react';
import { Popover, DatePicker, Button } from '@shopify/polaris';
import { CalendarIcon } from '@shopify/polaris-icons';

export type DateRange = { start: Date; end: Date };

type Props = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  defaultDays?: number;
};

function fmt(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function subDays(d: Date, n: number) {
  return new Date(d.getTime() - n * 86400000);
}

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 12 months', days: 365 },
];

export function DateRangePicker({ value, onChange }: Props) {
  const [popoverActive, setPopoverActive] = useState(false);
  const [{ month, year }, setDate] = useState({
    month: value.start.getMonth(),
    year: value.start.getFullYear(),
  });
  const [selectedDates, setSelectedDates] = useState({
    start: value.start,
    end: value.end,
  });

  const togglePopover = useCallback(() => setPopoverActive((a) => !a), []);
  const closePopover = useCallback(() => setPopoverActive(false), []);

  const rangeMs = value.end.getTime() - value.start.getTime();
  const rangeDays = Math.round(rangeMs / 86400000);
  const preset = PRESETS.find((p) => p.days === rangeDays);
  const label = preset
    ? `${preset.label}  ${fmt(value.start)} – ${fmt(value.end)}`
    : `Custom  ${fmt(value.start)} – ${fmt(value.end)}`;

  const handlePreset = (days: number) => {
    const end = new Date();
    const start = subDays(end, days);
    onChange({ start, end });
    closePopover();
  };

  const handleDatePickerChange = useCallback(({ start, end }: { start: Date; end: Date }) => {
    setSelectedDates({ start, end });
    onChange({ start, end: endOfDay(end) });
  }, [onChange]);

  const activator = (
    <Button
      onClick={togglePopover}
      disclosure={popoverActive ? 'up' : 'down'}
      icon={CalendarIcon}
    >
      {label}
    </Button>
  );

  return (
    <Popover
      active={popoverActive}
      activator={activator}
      onClose={closePopover}
      preferredAlignment="right"
    >
      <Popover.Section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 160 }}>
          {PRESETS.map((p) => {
            const isActive = rangeDays === p.days;
            return (
              <div
                key={p.label}
                role="button"
                tabIndex={0}
                onClick={() => handlePreset(p.days)}
                onKeyDown={(e) => e.key === 'Enter' && handlePreset(p.days)}
                style={{
                  padding: '7px 10px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 13,
                  color: isActive ? '#1D4ED8' : '#374151',
                  background: isActive ? '#EFF6FF' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                {p.label}
                {isActive && <span style={{ fontSize: 11 }}>✓</span>}
              </div>
            );
          })}
        </div>
      </Popover.Section>
      <Popover.Section>
        <DatePicker
          month={month}
          year={year}
          onChange={handleDatePickerChange}
          onMonthChange={(m, y) => setDate({ month: m, year: y })}
          selected={selectedDates}
          allowRange
        />
      </Popover.Section>
    </Popover>
  );
}
