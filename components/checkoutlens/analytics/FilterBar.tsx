"use client";

import { useCallback, useState, useEffect } from "react";
import { Filters, ChoiceList, InlineStack, Button } from "@shopify/polaris";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import DateRangePicker, { DateRange, computePresetRange } from "@/components/checkoutlens/DateRangePicker";
import useSWR from "swr";

interface FilterBarProps {
  shopTimezone: string;
}

const fetcher = (url: string) =>
  fetch(url, {
    headers: { Authorization: `Bearer ${(window as any).__shopifySessionToken ?? ""}` },
  }).then((r) => r.json());

function getSessionToken(): string {
  if (typeof window === "undefined") return "";
  return (window as any).__shopifySessionToken ?? "";
}

export default function FilterBar({ shopTimezone }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read filter state from URL
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const presetParam = searchParams.get("preset") ?? "last_30d";
  const countryParam = searchParams.get("country");
  const deviceParam = searchParams.get("device");
  const discountUsageParam = searchParams.get("discountUsage");

  const defaultRange = computePresetRange("last_30d", shopTimezone);
  const [dateRange, setDateRange] = useState<DateRange>({
    start: startParam ? new Date(startParam) : defaultRange.start,
    end: endParam ? new Date(endParam) : defaultRange.end,
    preset: (presetParam as DateRange["preset"]) ?? "last_30d",
  });

  const { data: filterOptions } = useSWR(
    `/api/checkoutlens/analytics/filter-options?start=${dateRange.start.toISOString()}&end=${dateRange.end.toISOString()}`,
    (url) =>
      fetch(url, { headers: { Authorization: `Bearer ${getSessionToken()}` } }).then((r) => r.json())
  );

  const topCountries: { label: string; value: string }[] = filterOptions?.countries ?? [];

  function pushParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v == null) {
        params.delete(k);
      } else {
        params.set(k, v);
      }
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const handleDateRangeChange = useCallback(
    (next: DateRange) => {
      setDateRange(next);
      pushParams({
        start: next.start.toISOString(),
        end: next.end.toISOString(),
        preset: next.preset,
      });
    },
    [searchParams, pathname]
  );

  const handleCountryChange = useCallback(
    (selected: string[]) => {
      pushParams({ country: selected[0] ?? null });
    },
    [searchParams, pathname]
  );

  const handleDeviceChange = useCallback(
    (selected: string[]) => {
      pushParams({ device: selected[0] ?? null });
    },
    [searchParams, pathname]
  );

  const handleDiscountUsageChange = useCallback(
    (selected: string[]) => {
      pushParams({ discountUsage: selected[0] ?? null });
    },
    [searchParams, pathname]
  );

  const handleClearAll = useCallback(() => {
    const params = new URLSearchParams();
    params.set("start", dateRange.start.toISOString());
    params.set("end", dateRange.end.toISOString());
    params.set("preset", dateRange.preset);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [dateRange, pathname]);

  const appliedFilters = [];
  if (countryParam) {
    appliedFilters.push({
      key: "country",
      label: `Country: ${countryParam}`,
      onRemove: () => pushParams({ country: null }),
    });
  }
  if (deviceParam) {
    appliedFilters.push({
      key: "device",
      label: `Device: ${deviceParam}`,
      onRemove: () => pushParams({ device: null }),
    });
  }
  if (discountUsageParam) {
    appliedFilters.push({
      key: "discountUsage",
      label: `Discount: ${discountUsageParam}`,
      onRemove: () => pushParams({ discountUsage: null }),
    });
  }

  return (
    <InlineStack align="space-between" gap="200" blockAlign="center">
      <Filters
        queryValue=""
        queryPlaceholder="Search"
        onQueryChange={() => {}}
        onQueryClear={() => {}}
        onClearAll={handleClearAll}
        appliedFilters={appliedFilters}
        filters={[
          {
            key: "country",
            label: "Country",
            filter: (
              <ChoiceList
                title="Country"
                choices={topCountries.length > 0 ? topCountries : [{ label: "No data", value: "" }]}
                selected={countryParam ? [countryParam] : []}
                onChange={handleCountryChange}
              />
            ),
            shortcut: true,
          },
          {
            key: "device",
            label: "Device",
            filter: (
              <ChoiceList
                title="Device type"
                choices={[
                  { label: "Mobile", value: "mobile" },
                  { label: "Tablet", value: "tablet" },
                  { label: "Desktop", value: "desktop" },
                ]}
                selected={deviceParam ? [deviceParam] : []}
                onChange={handleDeviceChange}
              />
            ),
            shortcut: true,
          },
          {
            key: "discountUsage",
            label: "Discount usage",
            filter: (
              <ChoiceList
                title="Discount usage"
                choices={[
                  { label: "Used a coupon", value: "used" },
                  { label: "Tried a failed coupon", value: "failed" },
                  { label: "No coupon", value: "none" },
                ]}
                selected={discountUsageParam ? [discountUsageParam] : []}
                onChange={handleDiscountUsageChange}
              />
            ),
          },
        ]}
      />
      <DateRangePicker
        value={dateRange}
        onChange={handleDateRangeChange}
        shopTimezone={shopTimezone}
      />
    </InlineStack>
  );
}
