"use client";

import { useState, useCallback, useEffect } from "react";
import { Button, Popover, Select, DatePicker } from "@shopify/polaris";

export type PresetKey =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_30d"
  | "last_90d"
  | "month_to_date"
  | "last_month";

export type DateRange = {
  start: Date;
  end: Date;
  preset: PresetKey | "custom";
};

interface DateRangePickerProps {
  value: DateRange;
  onChange: (next: DateRange) => void;
  shopTimezone: string;
}

const PRESET_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 days", value: "last_7d" },
  { label: "Last 30 days", value: "last_30d" },
  { label: "Last 90 days", value: "last_90d" },
  { label: "Month to date", value: "month_to_date" },
  { label: "Last month", value: "last_month" },
  { label: "Custom range", value: "custom" },
] as const;

function nowInTz(tz: string): Date {
  // Use Intl to get wall clock in the shop's timezone, then construct a Date
  // that has those year/month/day values in local time for DatePicker compat.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const p: Record<string, string> = {};
  parts.forEach((pt) => { p[pt.type] = pt.value; });
  // Build as UTC midnight so we don't drift on DST
  return new Date(Date.UTC(parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day)));
}

function startOfMonthInTz(tz: string): Date {
  const d = nowInTz(tz);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function lastMonthRange(tz: string): { start: Date; end: Date } {
  const d = nowInTz(tz);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  return { start, end };
}

export function computePresetRange(preset: PresetKey, tz: string): { start: Date; end: Date } {
  const today = nowInTz(tz);
  switch (preset) {
    case "today":
      return { start: today, end: today };
    case "yesterday": {
      const y = new Date(today);
      y.setUTCDate(y.getUTCDate() - 1);
      return { start: y, end: y };
    }
    case "last_7d": {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 6); // today - 6 = 7 days inclusive
      return { start: s, end: today };
    }
    case "last_30d": {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 29);
      return { start: s, end: today };
    }
    case "last_90d": {
      const s = new Date(today);
      s.setUTCDate(s.getUTCDate() - 89);
      return { start: s, end: today };
    }
    case "month_to_date":
      return { start: startOfMonthInTz(tz), end: today };
    case "last_month":
      return lastMonthRange(tz);
  }
}

function formatLabel(range: DateRange): string {
  const presetLabel =
    PRESET_OPTIONS.find((p) => p.value === range.preset)?.label ?? "Custom range";
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${presetLabel} · ${fmt(range.start)} – ${fmt(range.end)}`;
}

const STORAGE_VERSION = "v1";

export default function DateRangePicker({ value, onChange, shopTimezone }: DateRangePickerProps) {
  const [popoverActive, setPopoverActive] = useState(false);
  // Local picker state for custom range — tracks DatePicker month view
  const [pickerMonth, setPickerMonth] = useState({
    month: value.start.getUTCMonth(),
    year: value.start.getUTCFullYear(),
  });
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);

  // Persist last preset to localStorage
  const persistPreset = useCallback(
    (preset: PresetKey | "custom", shopDomain?: string) => {
      if (typeof window === "undefined") return;
      const key = `${shopDomain ?? "shop"}:cl:dateRange:${STORAGE_VERSION}`;
      localStorage.setItem(key, preset);
    },
    []
  );

  const handlePresetChange = useCallback(
    (selected: string) => {
      if (selected === "custom") {
        // Don't fire onChange until two dates are picked
        onChange({ ...value, preset: "custom" });
        return;
      }
      const preset = selected as PresetKey;
      const { start, end } = computePresetRange(preset, shopTimezone);
      persistPreset(preset);
      setPopoverActive(false);
      onChange({ start, end, preset });
    },
    [value, onChange, shopTimezone, persistPreset]
  );

  const handleDatePickerChange = useCallback(
    ({ start, end }: { start: Date; end: Date }) => {
      setCustomRange({ start, end });
      // Only fire onChange on the second click (end selected = start !== end OR both set)
      // Polaris DatePicker fires with start=end on first click, then start≠end on second
      if (start.getTime() !== end.getTime()) {
        persistPreset("custom");
        setPopoverActive(false);
        onChange({ start, end, preset: "custom" });
      }
    },
    [onChange, persistPreset]
  );

  const trigger = (
    <Button disclosure onClick={() => setPopoverActive((v) => !v)}>
      {formatLabel(value)}
    </Button>
  );

  return (
    <Popover
      active={popoverActive}
      activator={trigger}
      onClose={() => setPopoverActive(false)}
      preferredAlignment="right"
    >
      <div style={{ padding: "12px", minWidth: 280 }}>
        <Select
          label="Date range"
          options={PRESET_OPTIONS as unknown as { label: string; value: string }[]}
          value={value.preset}
          onChange={handlePresetChange}
        />
        {value.preset === "custom" && (
          <div style={{ marginTop: 12 }}>
            <DatePicker
              month={pickerMonth.month}
              year={pickerMonth.year}
              selected={
                customRange ?? { start: value.start, end: value.end }
              }
              onChange={handleDatePickerChange}
              onMonthChange={(month, year) => setPickerMonth({ month, year })}
              allowRange
            />
          </div>
        )}
      </div>
    </Popover>
  );
}
