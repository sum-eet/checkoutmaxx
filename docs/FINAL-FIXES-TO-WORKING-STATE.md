# CouponMaxx — Final Fixes to Working State

## CURRENT STATUS
- ✅ Auth works (shop row created, pixel registered)
- ✅ Cart monitor loads on storefront (events flow to Supabase)
- ✅ Analytics page renders KPI cards when accessed via direct URL
- ❌ Clicking app in sidebar → "refused to connect" (root page redirect loop)
- ❌ Nav sidebar missing
- ❌ Dashboard shows no data (API may return empty or error)
- ❌ Session tokens check red (getShopFromRequest never applied)
- ❌ Privacy page may still reference CheckoutMaxx

## ROOT CAUSES (there are exactly 3 bugs)

**Bug 1**: Root page (`app/page.tsx`) fetches `/api/shop-status` server-side. If this fetch fails or is slow, it redirects to `/api/auth/begin` which redirects to Shopify OAuth which can't load in an iframe → "refused to connect." Fix: rewrite root page to always redirect to `/couponmaxx/analytics` and let the analytics page handle auth.

**Bug 2**: `getShopFromRequest()` was never wired into the API routes. The `lib/verify-session-token.ts` file may exist but the API routes still use `p.get('shop')`. This means session tokens aren't being verified and the Shopify check stays red.

**Bug 3**: The API routes work, the data is in Supabase, but the dashboard may show empty because the analytics page's `useShop()` returns empty on first render (before App Bridge injects `?shop=`), and the SWR call fires with null key. On second render it works — but if the page shows "no data" instead of retrying, it looks broken.

---

## FIX 1 — Root page (stops the redirect loop)

**File**: `app/page.tsx`

Replace the ENTIRE file with:

```tsx
import { redirect } from "next/navigation";

export default function RootPage({
  searchParams,
}: {
  searchParams: { shop?: string; host?: string; [key: string]: string | undefined };
}) {
  // Always redirect to analytics. The analytics page handles empty state.
  // If the shop isn't installed, the analytics page will show "Shop not found" 
  // which is better than an iframe-breaking auth redirect loop.
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  redirect(`/couponmaxx/analytics${qs ? `?${qs}` : ""}`);
}
```

This is 12 lines. No fetch. No shop-status check. No auth redirect. Just go straight to the dashboard. Always.

---

## FIX 2 — Session token verification in API routes

**File**: `lib/verify-session-token.ts`

Check if this file exists. If not, create it:

```ts
import { createHmac } from "crypto";

export function verifySessionToken(token: string): string | null {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return null;

  try {
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    if (!headerB64 || !payloadB64 || !signatureB64) return null;

    const expected = createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");

    if (expected !== signatureB64) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    const dest = payload.dest || payload.iss || "";
    const match = dest.match(/https?:\/\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function getShopFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const shop = verifySessionToken(auth.slice(7));
    if (shop) return shop;
  }
  const url = new URL(req.url);
  return url.searchParams.get("shop");
}
```

**Now update EVERY couponmaxx API route.** In each file listed below, add this import at the top:

```ts
import { getShopFromRequest } from "@/lib/verify-session-token";
```

Then find where `shopDomain` is extracted and replace it:

### `app/api/couponmaxx/analytics/route.ts`
```
FIND:    const shopDomain = p.get('shop');
REPLACE: const shopDomain = getShopFromRequest(req) ?? p.get('shop');
```

### `app/api/couponmaxx/sessions/route.ts`
```
FIND:    const shopDomain = p.get('shop');
REPLACE: const shopDomain = getShopFromRequest(req) ?? p.get('shop');
```

### `app/api/couponmaxx/session/route.ts`
Find the line where shop is extracted from params and add the same pattern.

### `app/api/couponmaxx/coupons/route.ts`
Same pattern.

### `app/api/couponmaxx/notifications/route.ts`
Same pattern. This route may use POST — adapt:
```ts
// For GET handlers:
const shopDomain = getShopFromRequest(req) ?? p.get('shop');

// For POST handlers where shop comes from body:
const shopDomain = getShopFromRequest(req) ?? body.shop;
```

### `app/api/couponmaxx/settings/route.ts`
Same pattern.

### `app/api/shop-status/route.ts`
```
FIND:    const shop = req.nextUrl.searchParams.get("shop");
REPLACE: const shop = getShopFromRequest(req) ?? req.nextUrl.searchParams.get("shop");
```

**Add the import to each file.** Don't miss any.

---

## FIX 3 — Nav sidebar

**File**: `app/(embedded)/couponmaxx/layout.tsx`

Replace with:

```tsx
'use client';

import { useState, useEffect } from 'react';

export default function CouponMaxxLayout({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  
  useEffect(() => {
    // Wait for App Bridge to initialize before mounting nav
    const timer = setTimeout(() => setReady(true), 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {ready && (
        <ui-nav-menu>
          <a href="/couponmaxx/analytics" rel="home">Analytics</a>
          <a href="/couponmaxx/sessions">Cart Sessions</a>
          <a href="/couponmaxx/coupons">Coupons</a>
          <a href="/couponmaxx/notifications">Notifications</a>
        </ui-nav-menu>
      )}

      <div style={{
        minHeight: '100vh',
        background: '#F1F1F1',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{ padding: '20px 24px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
```

---

## FIX 4 — Partner Dashboard App URL

This is a MANUAL step. Do NOT skip.

Go to **Partner Dashboard → couponmaxx → Configuration → App URL**

Set to:
```
https://couponmaxx.vercel.app/couponmaxx/analytics
```

Redirect URL stays:
```
https://couponmaxx.vercel.app/api/auth/callback
```

---

## FIX 5 — Add API debug logging

To understand WHY data isn't showing, add a log line to the analytics route.

**File**: `app/api/couponmaxx/analytics/route.ts`

After the shop lookup (around line 28), add:

```ts
console.log('[analytics] shopId=%s, querying RPCs for range %s to %s', shopId, start.toISOString(), end.toISOString());
```

After the parallel RPC calls (the `Promise.all` block), add:

```ts
console.log('[analytics] RPC results: cart=%d rows, checkout=%d rows, attr=%d rows, funnel=%s',
  cartRows.length, ckRows.length, attrRows.length, JSON.stringify(funnel));
```

This will appear in Vercel logs and tell us whether the RPCs return data or empty arrays.

---

## VERIFY

```bash
echo "1. Root page — no fetch, no auth redirect:"
grep -c "fetch\|auth/begin\|shop-status" app/page.tsx
echo "(Must: 0)"

echo ""
echo "2. getShopFromRequest in API routes:"
grep -rl "getShopFromRequest" app/api/couponmaxx/ app/api/shop-status/ 2>/dev/null | wc -l
echo "(Must: >= 6)"

echo ""
echo "3. verify-session-token.ts exists:"
ls lib/verify-session-token.ts 2>&1

echo ""
echo "4. Nav has delay:"
grep "setTimeout" app/\(embedded\)/couponmaxx/layout.tsx
echo "(Must show setTimeout with 800ms)"

echo ""
echo "5. Build:"
npx next build 2>&1 | tail -5
```

---

## COMMIT AND DEPLOY

```bash
git add app/page.tsx lib/verify-session-token.ts app/\(embedded\)/couponmaxx/layout.tsx app/api/
git commit -m "fix: root page redirect loop, session tokens, nav timing, API debug logs"
git push
```

Then **manually redeploy** couponmaxx on Vercel (Deployments → Redeploy).

---

## ════════════════════════════════════
## 🛑 STOP — TEST ALL OF THESE
## ════════════════════════════════════

After deploy, do this in order:

### Test A — App loads from sidebar
1. Close any open app tabs
2. Go to Shopify admin → Apps → click couponmaxx
3. **Expected**: Analytics page loads. No "refused to connect."

### Test B — Nav appears
4. Look at left sidebar under "couponmaxx"
5. **Expected**: 4 tabs (Analytics, Cart Sessions, Coupons, Notifications)
6. Click each tab — pages navigate correctly

### Test C — Data shows
7. Generate data if you haven't: storefront → add to cart → try coupon code
8. Wait 1 minute
9. Go to Cart Sessions tab
10. **Expected**: At least one session row in the table
11. Check Vercel logs for `[analytics]` lines — do the RPCs return data?

### Test D — API works directly
12. Open this URL in a new tab (NOT inside Shopify admin):
```
https://couponmaxx.vercel.app/api/couponmaxx/sessions?shop=testingstoresumeet.myshopify.com&start=2026-03-17T00:00:00.000Z&end=2026-03-19T00:00:00.000Z
```
13. **Expected**: JSON response with session data, not `{"error":"Shop not found"}`

### Test E — Session tokens
14. Inside the app in Shopify admin, open DevTools → Network tab
15. Find any request to `/api/couponmaxx/analytics` or `/api/couponmaxx/sessions`
16. Click it → Headers → Request Headers
17. **Expected**: `Authorization: Bearer eyJ...` header present

### IF Test A fails:
Screenshot console errors. The root page is the simplest redirect now — if it fails, something else is redirecting.

### IF Test B fails (no nav):
Go to Partner Dashboard → couponmaxx. Look for Navigation settings. Add the 4 links manually:
- Analytics → /couponmaxx/analytics (Home)
- Cart Sessions → /couponmaxx/sessions
- Coupons → /couponmaxx/coupons
- Notifications → /couponmaxx/notifications

### IF Test C fails (no data in UI):
Check Vercel logs for the `[analytics]` debug lines. Three possibilities:
1. `shop lookup: null` → Shop row missing or isActive=false. Check Supabase.
2. `RPC results: cart=0 rows` → No CartEvent data. Generate some on storefront.
3. RPCs return data but UI shows empty → Frontend rendering issue. Screenshot the API response from Test D.

### IF Test D fails ("Shop not found"):
The Supabase query is: `Shop.select('id').eq('shopDomain', X).eq('isActive', true)`
Check Supabase → Shop table → is there a row for testingstoresumeet.myshopify.com with isActive = true?

### IF Test E fails (no Authorization header):
App Bridge isn't injecting tokens. The `SHOPIFY_API_KEY` env var on Vercel doesn't match the installed app's client_id. Verify in Vercel settings.
