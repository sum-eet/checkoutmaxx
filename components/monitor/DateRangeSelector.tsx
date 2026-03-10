"use client";
import { ButtonGroup, Button, Modal, DatePicker } from "@shopify/polaris";
import { useState, useCallback } from "react";

export type DateRange = { start: Date; end: Date };
type Preset = "1h" | "24h" | "7d" | "30d";

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

function presetToRange(preset: Preset): DateRange {
  const now = new Date();
  const ms: Record<Preset, number> = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  return { start: new Date(now.getTime() - ms[preset]), end: now };
}

export function DateRangeSelector({ value, onChange }: Props) {
  const [active, setActive] = useState<Preset>("24h");
  const [customOpen, setCustomOpen] = useState(false);
  const [{ month, year }, setMonthYear] = useState({
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
  });
  const [selectedDates, setSelectedDates] = useState({ start: value.start, end: value.end });

  function applyPreset(preset: Preset) {
    setActive(preset);
    onChange(presetToRange(preset));
  }

  const handleMonthChange = useCallback((m: number, y: number) => {
    setMonthYear({ month: m, year: y });
  }, []);

  return (
    <>
      <ButtonGroup gap="tight">
        {(["1h", "24h", "7d", "30d"] as Preset[]).map((p) => (
          <Button
            key={p}
            variant={active === p ? "primary" : "secondary"}
            size="slim"
            onClick={() => applyPreset(p)}
          >
            {p}
          </Button>
        ))}
        <Button size="slim" onClick={() => setCustomOpen(true)}>
          Custom
        </Button>
      </ButtonGroup>

      <Modal
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        title="Custom date range"
        primaryAction={{
          content: "Apply",
          onAction: () => {
            onChange(selectedDates);
            setActive("24h");
            setCustomOpen(false);
          },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setCustomOpen(false) }]}
      >
        <Modal.Section>
          <DatePicker
            month={month}
            year={year}
            onChange={setSelectedDates}
            onMonthChange={handleMonthChange}
            selected={selectedDates}
            allowRange
          />
        </Modal.Section>
      </Modal>
    </>
  );
}
