"use client";
import { useEffect, useState } from "react";

const STORAGE_KEY = "cm_shop";

export function useShop(): string {
  const [shop, setShop] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("shop");
    if (fromUrl) {
      localStorage.setItem(STORAGE_KEY, fromUrl);
      setShop(fromUrl);
      return;
    }
    // Try App Bridge
    try {
      const shopify = (window as any).shopify;
      if (shopify?.config?.shop) {
        localStorage.setItem(STORAGE_KEY, shopify.config.shop);
        setShop(shopify.config.shop);
        return;
      }
    } catch {}
    // Fall back to localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setShop(stored);
  }, []);

  return shop;
}
