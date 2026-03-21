'use client';

import { useState, useCallback } from 'react';
import { Popover, Button } from '@shopify/polaris';
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
function fmtMonthYear(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function sameDay(a: Date, b: Date) {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}
function inRange(d: Date, start: Date, end: Date) {
  const ds = d.toISOString().slice(0, 10);
  return ds >= start.toISOString().slice(0, 10) && ds <= end.toISOString().slice(0, 10);
}
function subDays(d: Date, n: number) {
  return new Date(d.getTime() - n * 86400000);
}
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
    const y = subDays(now, 1);
    return { start: startOfDay(y), end: endOfDay(y) };
  }
  return { start: startOfDay(subDays(now, days)), end: endOfDay(now) };
}

function matchPreset(range: DateRange): number | null {
  for (const p of PRESETS) {
    const r = getPresetRange(p.days);
    if (Math.abs(r.start.getTime() - range.start.getTime()) < 60000 &&
        Math.abs(r.end.getTime() - range.end.getTime()) < 60000) {
      return p.days;
    }
  }
  return null;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

// Compact calendar grid component
function MiniCalendar({
  month, year, range, selectingStart,
  onDayClick, onPrevMonth, onNextMonth,
}: {
  month: number; year: number; range: DateRange; selectingStart: boolean;
  onDayClick: (d: Date) => void; onPrevMonth: () => void; onNextMonth: () => void;
}) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const today = new Date();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const cellStyle = {
    width: 32, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, borderRadius: 4, cursor: 'pointer', transition: 'background 0.1s',
  };

  return (
    <div style={{ width: 240 }}>
      {/* Month nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <button onClick={onPrevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6d7175', padding: '2px 6px' }}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtMonthYear(new Date(year, month))}</span>
        <button onClick={onNextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6d7175', padding: '2px 6px' }}>›</button>
      </div>
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 32px)', gap: 1, marginBottom: 2 }}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
          <div key={d} style={{ ...cellStyle, fontSize: 11, color: '#8c9196', cursor: 'default', fontWeight: 500 }}>{d}</div>
        ))}
      </div>
      {/* Days grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 32px)', gap: 1 }}>
        {days.map((day, i) => {
          if (day === null) return <div key={`e${i}`} style={cellStyle} />;
          const d = new Date(year, month, day);
          const isStart = sameDay(d, range.start);
          const isEnd = sameDay(d, range.end);
          const isInRange = inRange(d, range.start, range.end);
          const isToday = sameDay(d, today);
          const isFuture = d > today;

          let bg = 'transparent';
          let color = '#202223';
          let fontWeight: number | string = 400;

          if (isStart || isEnd) { bg = '#202223'; color = '#fff'; fontWeight = 600; }
          else if (isInRange) { bg = '#EDEEEF'; }
          if (isToday && !isStart && !isEnd) { fontWeight = 700; }
          if (isFuture) { color = '#c9cccf'; }

          return (
            <div
              key={day}
              onClick={() => !isFuture && onDayClick(d)}
              style={{ ...cellStyle, background: bg, color, fontWeight, cursor: isFuture ? 'default' : 'pointer' }}
              onMouseEnter={(e) => { if (!isFuture && !isStart && !isEnd) (e.target as HTMLElement).style.background = '#f1f1f1'; }}
              onMouseLeave={(e) => { if (!isStart && !isEnd) (e.target as HTMLElement).style.background = isInRange ? '#E4EFFE' : 'transparent'; }}
            >
              {day}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({ value, onChange }: Props) {
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<'presets' | 'calendar'>('presets');
  const [pending, setPending] = useState<DateRange>(value);
  const [selectingStart, setSelectingStart] = useState(true);
  const [viewMonth, setViewMonth] = useState(value.start.getMonth());
  const [viewYear, setViewYear] = useState(value.start.getFullYear());

  const matched = matchPreset(value);
  const buttonLabel = `${fmtShort(value.start)} – ${fmtShort(value.end)}`;

  const handleOpen = useCallback(() => {
    setMode('presets');
    setPending(value);
    setSelectingStart(true);
    setViewMonth(value.start.getMonth());
    setViewYear(value.start.getFullYear());
    setActive(true);
  }, [value]);

  const handlePresetClick = useCallback((days: number) => {
    onChange(getPresetRange(days));
    setActive(false);
  }, [onChange]);

  const handleDayClick = useCallback((d: Date) => {
    if (selectingStart) {
      setPending({ start: startOfDay(d), end: endOfDay(d) });
      setSelectingStart(false);
    } else {
      const start = d < pending.start ? startOfDay(d) : pending.start;
      const end = d < pending.start ? pending.end : endOfDay(d);
      setPending({ start, end });
      setSelectingStart(true);
    }
  }, [selectingStart, pending]);

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
    >
      <div style={{ display: 'flex', padding: '8px 0' }}>
        {/* Left: Presets */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 160,
          borderRight: mode === 'calendar' ? '1px solid #e1e3e5' : 'none',
        }}>
          {PRESETS.map(p => (
            <button
              key={p.days}
              onClick={() => handlePresetClick(p.days)}
              style={{
                background: matched === p.days ? '#F1F1F1' : 'transparent',
                border: 'none',
                padding: '8px 16px',
                fontSize: 13,
                textAlign: 'left',
                cursor: 'pointer',
                color: '#202223',
                fontWeight: matched === p.days ? 600 : 400,
              }}
              onMouseEnter={(e) => (e.target as HTMLElement).style.background = '#F6F6F7'}
              onMouseLeave={(e) => (e.target as HTMLElement).style.background = matched === p.days ? '#F1F1F1' : 'transparent'}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setMode(mode === 'calendar' ? 'presets' : 'calendar')}
            style={{
              background: mode === 'calendar' ? '#F1F1F1' : 'transparent',
              border: 'none',
              padding: '8px 16px',
              fontSize: 13,
              textAlign: 'left',
              cursor: 'pointer',
              color: '#202223',
              fontWeight: mode === 'calendar' ? 600 : 400,
            }}
            onMouseEnter={(e) => (e.target as HTMLElement).style.background = '#F6F6F7'}
            onMouseLeave={(e) => (e.target as HTMLElement).style.background = mode === 'calendar' ? '#F1F1F1' : 'transparent'}
          >
            Custom range...
          </button>
        </div>

        {/* Right: Calendar (side-by-side with presets) */}
        {mode === 'calendar' && (
          <div style={{ padding: '4px 16px 8px' }}>
            <div style={{ fontSize: 12, color: '#6d7175', marginBottom: 8 }}>
              {selectingStart ? 'Select start date' : 'Select end date'}: {fmtShort(pending.start)} – {fmtShort(pending.end)}
            </div>
            <MiniCalendar
              month={viewMonth}
              year={viewYear}
              range={pending}
              selectingStart={selectingStart}
              onDayClick={handleDayClick}
              onPrevMonth={() => {
                if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
                else setViewMonth(viewMonth - 1);
              }}
              onNextMonth={() => {
                if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
                else setViewMonth(viewMonth + 1);
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button
                onClick={() => setMode('presets')}
                style={{ padding: '6px 12px', fontSize: 12, background: '#fff', border: '1px solid #c9cccf', borderRadius: 6, cursor: 'pointer' }}
              >
                Back
              </button>
              <button
                onClick={handleApply}
                style={{ padding: '6px 12px', fontSize: 12, background: '#202223', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>
    </Popover>
  );
}
