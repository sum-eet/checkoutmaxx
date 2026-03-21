"use client";
import { useEffect, useState } from "react";

// Module-level cache — survives client-side navigation, no storage API needed.
// Once resolved, this holds the shop domain for the lifetime of the JS bundle.
let _shop: string = "";

/**
 * Decode App Bridge id_token JWT to get shop domain from the dest/iss claim.
 * Client-side only — no signature verification (API routes handle that).
 */
function shopFromIdToken(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    const dest = payload.dest || payload.iss || "";
    const match = dest.match(/https?:\/\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Try every known source for the shop domain, in order of reliability.
 */
function resolveShop(): string | null {
  // Avoid running on server
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);

  // 1. ?shop= URL param — present on initial iframe load from Shopify admin
  const fromUrl = params.get("shop");
  if (fromUrl) return fromUrl;

  // 2. id_token JWT — App Bridge 4.x adds this on every navigation
  const idToken = params.get("id_token");
  if (idToken) {
    const fromToken = shopFromIdToken(idToken);
    if (fromToken) return fromToken;
  }

  // 3. App Bridge global — available after App Bridge initializes
  try {
    const shopify = (window as any).shopify;
    if (shopify?.config?.shop) return shopify.config.shop;
  } catch {}

  // 4. Module-level cache — set from a previous page in this session
  if (_shop) return _shop;

  // 5. localStorage — may be blocked in third-party iframe (Safari)
  try {
    const stored = localStorage.getItem("cm_shop");
    if (stored) return stored;
  } catch {}

  return null;
}

export function useShop(): string {
  const [shop, setShop] = useState(() => {
    // Synchronous resolve on first render — avoids flash of loading state
    if (typeof window === "undefined") return _shop || "";
    const resolved = resolveShop();
    if (resolved) {
      _shop = resolved;
      try { localStorage.setItem("cm_shop", resolved); } catch {}
    }
    return resolved || "";
  });

  useEffect(() => {
    // If already resolved, ensure caches are updated
    if (shop) {
      _shop = shop;
      try { localStorage.setItem("cm_shop", shop); } catch {}
      return;
    }

    // If not resolved, try again (App Bridge may have initialized since first render)
    const result = resolveShop();
    if (result) {
      _shop = result;
      try { localStorage.setItem("cm_shop", result); } catch {}
      setShop(result);
      return;
    }

    // Poll as absolute last resort (should rarely fire with the above layers)
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const found = resolveShop();
      if (found) {
        _shop = found;
        try { localStorage.setItem("cm_shop", found); } catch {}
        setShop(found);
        clearInterval(interval);
      } else if (attempts >= 10) {
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [shop]);

  return shop;
}
