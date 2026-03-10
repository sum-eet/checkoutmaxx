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
    } else {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setShop(stored);
    }
  }, []);

  return shop;
}
