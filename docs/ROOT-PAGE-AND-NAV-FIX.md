# CouponMaxx — Root Page Fix (THIS WAS NEVER APPLIED)

## THE BUG
`app/page.tsx` fetches `/api/shop-status` server-side. If this fetch fails, it redirects to `/api/auth/begin` → iframe breaks → "refused to connect." To work around this, the App URL was changed to `/couponmaxx/analytics` which BYPASSES the root page. But this breaks nav because Shopify resolves `<ui-nav-menu>` links relative to the App URL root.

On Dr.Water, App URL is root. Root page redirects to `/couponmaxx/analytics`. Nav works. We need the same setup.

## FIX

### Step 1: Replace `app/page.tsx`

Replace the ENTIRE file with this. No fetch. No shop-status. No auth redirect. Just redirect to analytics:

```tsx
import { redirect } from "next/navigation";

export default function RootPage({
  searchParams,
}: {
  searchParams: { shop?: string; host?: string; [key: string]: string | undefined };
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  redirect(`/couponmaxx/analytics${qs ? `?${qs}` : ""}`);
}
```

That's it. 12 lines. No async. No fetch. No try/catch. Just redirect.

### Step 2: Verify `<ui-nav-menu>` is in the couponmaxx layout

`app/(embedded)/couponmaxx/layout.tsx` must contain:

```tsx
<ui-nav-menu>
  <a href="/couponmaxx/analytics" rel="home">Analytics</a>
  <a href="/couponmaxx/sessions">Cart Sessions</a>
  <a href="/couponmaxx/coupons">Coupons</a>
  <a href="/couponmaxx/notifications">Notifications</a>
</ui-nav-menu>
```

If it was removed by a previous fix attempt, put it back. The full layout file should be:

```tsx
'use client';

export default function CouponMaxxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ui-nav-menu>
        <a href="/couponmaxx/analytics" rel="home">Analytics</a>
        <a href="/couponmaxx/sessions">Cart Sessions</a>
        <a href="/couponmaxx/coupons">Coupons</a>
        <a href="/couponmaxx/notifications">Notifications</a>
      </ui-nav-menu>

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

### Step 3: Remove `app_home` from toml if it was added

Check `shopify.app.toml`. If it has `[app_home]` or `[[app_home.navigation.links]]`, delete those lines. They cause `npx shopify app deploy` to fail.

## VERIFY

```bash
echo "1. Root page has no fetch:"
grep -c "fetch\|shop-status\|auth/begin" app/page.tsx
echo "(Must: 0)"

echo ""
echo "2. Root page just redirects:"
grep "redirect" app/page.tsx
echo "(Must show: redirect to /couponmaxx/analytics)"

echo ""
echo "3. ui-nav-menu in layout:"
grep -c "ui-nav-menu" app/\(embedded\)/couponmaxx/layout.tsx
echo "(Must: >= 1)"

echo ""
echo "4. No app_home in toml:"
grep -c "app_home" shopify.app.toml
echo "(Must: 0)"

echo ""
echo "5. Build:"
npx next build 2>&1 | tail -5
```

## DEPLOY

```bash
git add app/page.tsx app/\(embedded\)/couponmaxx/layout.tsx shopify.app.toml
git commit -m "fix: root page simple redirect, restore ui-nav-menu"
git push
```

Manually redeploy couponmaxx on Vercel.

## MANUAL STEP — PARTNER DASHBOARD

Change App URL back to root:

**Partner Dashboard → couponmaxx → Configuration → App URL:**
```
https://couponmaxx.vercel.app
```

This is the LAST TIME this changes. It matches Dr.Water's setup exactly.

## TEST

1. Uninstall couponmaxx from dev store
2. Reinstall fresh
3. Open app from Shopify admin → Apps → couponmaxx
4. Nav should show in sidebar
5. Analytics page should load

This is how Dr.Water works. Same code. Same root URL. Same redirect. Same nav.
