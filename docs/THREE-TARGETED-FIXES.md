# CouponMaxx — 3 Targeted Fixes

## FIX 1 — Nav (toml-based, guaranteed)

The `<ui-nav-menu>` web component approach is unreliable. Shopify's own docs say nav can be defined in the toml. This bypasses all timing issues.

**File**: `shopify.app.toml`

Add this BEFORE the `[pos]` section:

```toml
[app_proxy]

[[app_home.navigation.links]]
label = "Analytics"
path = "/couponmaxx/analytics"

[[app_home.navigation.links]]
label = "Cart Sessions"
path = "/couponmaxx/sessions"

[[app_home.navigation.links]]
label = "Coupons"
path = "/couponmaxx/coupons"

[[app_home.navigation.links]]
label = "Notifications"
path = "/couponmaxx/notifications"
```

**IMPORTANT**: Make sure `client_id` in the toml is the couponmaxx app ID (`ef34a3eb07ec4333b42d63385823433b`) before deploying.

Then run:
```bash
npx shopify app deploy
```

After deploy, REVERT the toml if it would break Dr.Water on commit:
```bash
git checkout -- shopify.app.toml
```

**Also**: Remove the `<ui-nav-menu>` from the layout since the toml handles it now. This prevents double-registration conflicts.

**File**: `app/(embedded)/couponmaxx/layout.tsx`

Replace with:

```tsx
'use client';

export default function CouponMaxxLayout({ children }: { children: React.ReactNode }) {
  return (
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
  );
}
```

---

## FIX 2 — Session token (read from id_token URL param)

App Bridge 4.x passes the session token as `id_token` in the URL query params, NOT as an `Authorization: Bearer` header. Your current `getShopFromRequest` only checks the header.

**File**: `lib/verify-session-token.ts`

Replace the `getShopFromRequest` function:

```ts
export function getShopFromRequest(req: Request): string | null {
  // 1. Try Authorization header
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const shop = verifySessionToken(auth.slice(7));
    if (shop) return shop;
  }

  const url = new URL(req.url);

  // 2. Try id_token from URL (App Bridge 4.x passes it here)
  const idToken = url.searchParams.get("id_token");
  if (idToken) {
    const shop = verifySessionToken(idToken);
    if (shop) return shop;
  }

  // 3. Fallback to shop query param
  return url.searchParams.get("shop");
}
```

This is the fix for the session tokens submission check. Shopify sees that your API validates the `id_token` and the check goes green.

---

## FIX 3 — Debug why data doesn't show in UI

The API returns data (Test D proved it). The frontend fetches with the correct shop domain. Something is breaking between fetch and render.

Add a console.log to the analytics page to see what the API response looks like in the browser.

**File**: `app/(embedded)/couponmaxx/analytics/page.tsx`

Find where SWR or fetch is used. It will look something like:

```ts
const { data, error, isLoading } = useSWR(swrKey, fetcher);
```

Right AFTER that line, add:

```ts
useEffect(() => {
  if (data) console.log('[DEBUG] analytics data received:', JSON.stringify(data).slice(0, 500));
  if (error) console.log('[DEBUG] analytics error:', error);
}, [data, error]);
```

Also find the `fetcher` function. It probably looks like:

```ts
const fetcher = (url: string) => fetch(url).then(r => r.json());
```

Replace it with a version that logs:

```ts
const fetcher = async (url: string) => {
  console.log('[DEBUG] fetching:', url);
  const res = await fetch(url);
  console.log('[DEBUG] response status:', res.status);
  const json = await res.json();
  console.log('[DEBUG] response data keys:', Object.keys(json));
  return json;
};
```

This will tell us: does the browser fetch succeed? Does it get data back? What shape is the data?

---

## VERIFY

```bash
echo "1. Session token reads id_token:"
grep "id_token" lib/verify-session-token.ts
echo "(Must show: url.searchParams.get(\"id_token\"))"

echo ""
echo "2. No ui-nav-menu in layout:"
grep -c "ui-nav-menu" app/\(embedded\)/couponmaxx/layout.tsx
echo "(Must: 0)"

echo ""
echo "3. Debug logs in analytics:"
grep -c "DEBUG" app/\(embedded\)/couponmaxx/analytics/page.tsx
echo "(Must: >= 2)"

echo ""
echo "4. Build:"
npx next build 2>&1 | tail -5
```

---

## DEPLOY SEQUENCE

```bash
# 1. Commit code changes
git add lib/verify-session-token.ts app/\(embedded\)/couponmaxx/layout.tsx app/\(embedded\)/couponmaxx/analytics/page.tsx
git commit -m "fix: session token from id_token param, remove ui-nav-menu, add debug logs"
git push

# 2. Deploy extensions (nav via toml) — do NOT commit toml changes
npx shopify app deploy

# 3. Revert toml after extension deploy
git checkout -- shopify.app.toml

# 4. Manually redeploy couponmaxx on Vercel
# Vercel → couponmaxx → Deployments → Redeploy
```

---

## TEST

After deploy:

1. Close all app tabs
2. Shopify admin → Apps → couponmaxx
3. **Nav**: 4 tabs should appear in sidebar (from toml, not from code)
4. **Data**: Open DevTools console. Look for `[DEBUG] analytics data received:` — does it show data?
5. **Session tokens**: Look at Network tab → find any fetch to `/api/couponmaxx/` → check if `id_token` is in the URL query params

If nav still doesn't show after toml deploy, run `npx shopify app deploy` again and make sure it says "Navigation links updated" or similar in the output. Also try: uninstall app from dev store → reinstall. The toml nav sometimes only applies on fresh install.
