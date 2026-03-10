"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const STORAGE_KEY = "cm_shop";

export function useShop(): string {
  const params = useSearchParams();
  const shopFromUrl = params.get("shop");
  const [shop, setShop] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return shopFromUrl || localStorage.getItem(STORAGE_KEY) || "";
    }
    return shopFromUrl || "";
  });

  useEffect(() => {
    if (shopFromUrl) {
      localStorage.setItem(STORAGE_KEY, shopFromUrl);
      setShop(shopFromUrl);
    } else if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setShop(stored);
    }
  }, [shopFromUrl]);

  return shop;
}
