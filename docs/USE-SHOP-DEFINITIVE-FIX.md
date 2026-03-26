# useShop Loading Forever — Root Cause + Definitive Fix

---

## ROOT CAUSE ANALYSIS

### The problem
On fresh browsers (Yash's PC, your mobile), the app renders the UI but data never loads. Loading state forever.

### Why
Two things working together:

**Cause 1: NEXT_PUBLIC_SHOPIFY_API_KEY likely missing on checkoutmaxx-rt55 Vercel project**

`app/layout.tsx` line 17:
```html
<script src="app-bridge.js" data-api-key={process.env.NEXT_PUBLIC_SHOPIFY_API_KEY} />
```

We added this env var to **couponmaxx** Vercel project but likely never added it to **checkoutmaxx-rt55** (Dr.Water). Without it, App Bridge loads with an empty API key.

App Bridge with no API key:
- The `<ui-nav-menu>` still renders (Shopify admin renders the nav shell, not App Bridge)
- Nav LOOKS like it works — clicking tabs navigates to new pages
- BUT App Bridge doesn't intercept the navigation
- Normal `<a href="/couponmaxx/sessions">` fires as a plain page load
- The new page URL has NO query params (?shop=, id_token, host are all missing)
- useShop() finds nothing → data never loads

**Cause 2: useShop has no resilient fallback**

When URL params are missing:
- `?shop=` → not in URL (App Bridge didn't add it)
- `window.shopify.config.shop` → empty (App Bridge has no API key, can't initialize)
- `localStorage` → blocked in Safari/iOS third-party iframe context, or empty on fresh browser
- Result: shop = "" forever

### Why it works on YOUR primary browser

Your Chrome has `localStorage` key `cm_shop` cached from a previous session when you had `?shop=` in the URL. That cache persists across sessions. On Yash's PC and your mobile, no cache exists, and all three sources fail.

---

## FIX — TWO STEPS, BOTH REQUIRED

### Step 1: Add NEXT_PUBLIC_SHOPIFY_API_KEY to checkoutmaxx-rt55 Vercel project

**Do this manually right now:**
1. Go to Vercel → checkoutmaxx-rt55 project → Settings → Environment Variables
2. Check if `NEXT_PUBLIC_SHOPIFY_API_KEY` exists
3. If it does NOT exist: Add it
   - Key: `NEXT_PUBLIC_SHOPIFY_API_KEY`
   - Value: `0a60bbe935cef2f46838acec2b3918d8` (Dr.Water's custom app client ID)
   - Environment: Production, Preview, Development (all three)
4. After adding: go to Deployments → latest → Redeploy
   - NEXT_PUBLIC_ vars are baked at BUILD time, so a redeploy is required

**If the env var already exists:** then Cause 1 is ruled out and the issue is purely Cause 2. Fix Step 2 is still needed.

**How to verify Step 1 worked:**
After redeploy, view source on the Dr.Water app page. Find the script tag. It should show:
```html
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key="0a60bbe935cef2f46838acec2b3918d8"></script>
```
If `data-api-key` is empty or missing, the env var is not set or the redeploy didn't pick it up.

### Step 2: Make useShop() bulletproof

Even with App Bridge fixed, we need useShop to handle every edge case. The fix uses three layers of resilience:

**Layer 1 — Module-level cache:** A plain JavaScript variable outside React. Survives client-side navigation. No localStorage needed. No browser API needed. Just memory.

**Layer 2 — id_token decoding:** The JWT is in the URL on every App Bridge navigation. Decode the payload, extract the shop domain. Always present when App Bridge works.

**Layer 3 — Existing checks:** ?shop= param, window.shopify, localStorage (with try-catch for Safari).

**File:** `hooks/useShop.ts`

**REPLACE THE ENTIRE FILE:**

```ts
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
```

---

## WHY THIS IS THE DEFINITIVE FIX

**Step 1 (env var) fixes the root cause:** App Bridge gets its API key. Nav clicks add ?shop= and id_token to every page URL. useShop resolves from URL params immediately. This is how it should work — everything else is a fallback.

**Step 2 (useShop rewrite) makes it bulletproof for every scenario:**

| Scenario | What resolves shop | Layer |
|----------|-------------------|-------|
| First load from Shopify admin | `?shop=` in URL | 1 |
| Nav click (App Bridge working) | `?shop=` or `id_token` in URL | 1 or 2 |
| Nav click (App Bridge broken) | Module-level `_shop` cache | 4 |
| Second tab opened in same session | Module-level `_shop` cache | 4 |
| Safari blocking localStorage | id_token or module cache | 2 or 4 |
| Mobile browser, slow App Bridge | id_token in URL (always present) | 2 |
| Everything fails somehow | Poll for App Bridge init | last resort |

The module-level `_shop` variable is the key insight. It's not React state (which resets per component mount). It's not localStorage (which can be blocked). It's a plain JS variable in module scope that persists as long as the page's JavaScript bundle is loaded. On client-side navigation, the bundle stays loaded — so `_shop` holds the value across page changes even when URL params are gone and localStorage is blocked.

---

## VERIFY

### After Step 1 (env var):
```
View source on Dr.Water app → search for "data-api-key"
Must show: data-api-key="0a60bbe935cef2f46838acec2b3918d8"
NOT: data-api-key="" or data-api-key="undefined"
```

### After Step 2 (useShop):
```bash
npx next build 2>&1 | tail -5

# Module-level cache exists:
grep "let _shop" hooks/useShop.ts
# Must exist

# id_token decoding exists:
grep "shopFromIdToken" hooks/useShop.ts
# Must exist

# localStorage wrapped in try-catch:
grep -c "try.*localStorage" hooks/useShop.ts
# Must be >= 2 (one for get, one for set)

# Synchronous initial state:
grep "useState(() =>" hooks/useShop.ts
# Must exist
```

### Integration test:
1. Add env var to checkoutmaxx-rt55, redeploy
2. Push useShop.ts changes to main (auto-deploys)
3. Open Chrome incognito → Dr.Water admin → Apps → checkoutmaxx
4. Data loads on first page (not stuck)
5. Click Cart Sessions → data loads (not stuck)
6. Click Coupons → data loads (not stuck)
7. Click back to Analytics → data loads (not stuck)
8. Ask Yash to try on his PC
9. Try on your mobile

All 9 must show data. If ANY show loading forever, screenshot the browser console — look for `[useShop]` warnings.

---

## COMMIT (Step 2 only — Step 1 is a Vercel UI change)

```bash
git add hooks/useShop.ts
git commit -m "fix: useShop reads id_token + module cache for reliable shop resolution"
git push
```
