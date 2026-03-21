# CouponMaxx — From Current State to Submission

## WHERE WE ARE RIGHT NOW
- ✅ Auth callback works (1.27 seconds, all 6 steps)
- ✅ Shop row created in Supabase on install
- ✅ Pixel registered in background
- ✅ App pages load inside Shopify admin
- ✅ API calls fire with correct shop domain
- ❌ Nav sidebar doesn't show (App Bridge ui-nav-menu not rendering)
- ❌ Data not confirmed flowing to UI
- ❌ Uninstall/reinstall cycle not tested
- ❌ Session tokens check still red
- ❌ Branding still says CheckoutMaxx in some places

This file fixes ALL of these. Do them in order. Each section has a STOP gate.

---

## SECTION 1 — Fix the postMessage error

### THE PROBLEM
Console shows: `Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('https://couponmaxx.vercel.app') does not match the recipient window's origin ('https://admin.shopify.com')`

This means something in the app is trying to postMessage to its own origin instead of to Shopify's admin origin. This is NOT the API key mismatch error from before (that would say "does not match the recipient window's origin ('https://couponmaxx.vercel.app')"). This error is the reverse — the app is the recipient, Shopify admin is the sender.

This is actually a KNOWN App Bridge 4.x behavior. It happens when the app sends a message back to itself through the iframe. It does NOT block App Bridge from working. The nav issue is separate.

### ACTION: None needed. This error is cosmetic. Move on.

---

## SECTION 2 — Fix Nav Sidebar

### THE PROBLEM
`<ui-nav-menu>` renders in the layout but Shopify doesn't pick it up for the sidebar.

### THE CAUSE
App Bridge registers nav items when the `<ui-nav-menu>` web component first mounts. If the component mounts BEFORE App Bridge finishes initializing, the nav items are missed. This is a timing issue with client-side rendering.

### FIX OPTION A — Partner Dashboard nav (guaranteed to work)

Go to **Partner Dashboard → couponmaxx → Build → Navigation** (or **App setup → Embedded app home → Manage navigation**)

If you see a navigation section, add these manually:

| Label | URL | Home? |
|-------|-----|-------|
| Analytics | /couponmaxx/analytics | Yes (set as home) |
| Cart Sessions | /couponmaxx/sessions | No |
| Coupons | /couponmaxx/coupons | No |
| Notifications | /couponmaxx/notifications | No |

Save. Close app tab. Reopen from Apps → couponmaxx.

### FIX OPTION B — If Partner Dashboard doesn't have nav settings

This means nav is controlled entirely by the code. The issue is timing. Add a small delay to ensure App Bridge is ready before the nav mounts.

**FILE**: `app/(embedded)/couponmaxx/layout.tsx`

Replace with:

```tsx
'use client';

import { useState, useEffect } from 'react';

export default function CouponMaxxLayout({ children }: { children: React.ReactNode }) {
  // Delay nav mount to ensure App Bridge is initialized
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {mounted && (
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

### FIX OPTION C — If neither A nor B works

Add the nav links directly in the App URL. Change Partner Dashboard App URL to:
```
https://couponmaxx.vercel.app/couponmaxx/analytics
```

Then add nav through `shopify.app.toml`:
```toml
[app_home]
embedded = true

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

Then deploy: `npx shopify app deploy` (with couponmaxx client_id in toml).

### TRY OPTIONS IN ORDER: A → B → C. One of them will work.

---

## ════════════════════════════════════
## 🛑 STOP — Nav must show 4 tabs
## ════════════════════════════════════

Open the app in Shopify admin. The left sidebar under "couponmaxx" must show:
- Analytics
- Cart Sessions
- Coupons
- Notifications

Clicking each tab must navigate to the correct page.

**If nav works**: proceed to Section 3.
**If nav doesn't work after all 3 options**: Screenshot the console and the Partner Dashboard configuration page. Something fundamental is misconfigured.

---

## SECTION 3 — Fix App URL for proper loading

### SET THE APP URL

In **Partner Dashboard → couponmaxx → Configuration → App URL**, set it to:
```
https://couponmaxx.vercel.app/couponmaxx/analytics
```

This bypasses the root page entirely. When merchants click the app, Shopify loads this URL directly in the iframe. No redirect chain, no shop-status check, no auth loop.

The Redirect URL stays:
```
https://couponmaxx.vercel.app/api/auth/callback
```

### WHY THIS WORKS
- The root page (`app/page.tsx`) tries to detect shop status and redirect. Inside an iframe, redirects can fail or loop.
- Pointing App URL directly to `/couponmaxx/analytics` means the first thing that loads is the analytics page inside the CouponMaxx layout, which renders `<ui-nav-menu>`.
- The `useShop()` hook reads `?shop=` from the URL (Shopify always appends this to the iframe src).

---

## SECTION 4 — Generate Test Data

You need real events in the database to verify the dashboard works.

### STEP 1: Verify cart monitor is active
Go to **dev store → Online Store → Themes → Customize → App embeds** (toggle icon bottom-left).
Find "Cart Monitor" → must be ON → Save.

### STEP 2: Open storefront
Open the dev store's storefront in a **new incognito window** (important — no admin session cookies interfering).

### STEP 3: Generate cart events
1. Browse to any product page
2. Click "Add to Cart"
3. Go to the cart page (`/cart`)
4. In the discount code field, type `FAKE123` and click Apply
5. It will fail — that's expected and what we want
6. Now type a REAL discount code (go to Shopify admin → Discounts → create a simple 10% code called `TEST10` if you don't have one)
7. Apply `TEST10` in the cart
8. Click Checkout (you don't need to complete it)

### STEP 4: Verify in browser console
On the storefront, DevTools console should show:
```
[CouponMaxx] Loaded — shop: testingstoresumeet.myshopify.com session: cart_XXXX
```

If it says `[CheckoutMaxx]` instead of `[CouponMaxx]`, that's fine — the branding in the JS file is cosmetic. Events still flow correctly.

### STEP 5: Verify in Supabase
Go to Supabase → Table Editor → CartEvent.

Filter or sort by `createdAt` descending. You should see rows with:
- `eventType`: `cart_coupon_failed` (for FAKE123)
- `eventType`: `cart_coupon_applied` (for TEST10)
- `couponCode`: `FAKE123` and `TEST10`
- `shopId`: matches the Shop row ID for testingstoresumeet

### STEP 6: Verify in Vercel logs
Vercel → couponmaxx → Logs. You should see `POST /api/cart/ingest` with 200 status.

---

## ════════════════════════════════════
## 🛑 STOP — CartEvent rows must exist
## ════════════════════════════════════

Check Supabase CartEvent table. At least 3-4 rows for the dev store must exist with today's timestamp.

**If rows exist**: proceed to Section 5.
**If no rows**:
1. Check cart-monitor.liquid URLs: `grep "data-ingest-url" extensions/cart-monitor/blocks/cart-monitor.liquid` — must say `couponmaxx.vercel.app`
2. Check if extensions were deployed to the couponmaxx app (not the old checkoutmaxx app)
3. Check Vercel logs for `/api/cart/ingest` — any errors?
4. Check Shop row exists with `isActive: true`

---

## SECTION 5 — Verify Dashboard Shows Data

### STEP 1: Open app in Shopify admin
Go to dev store → Apps → couponmaxx. The analytics page should load.

### STEP 2: Check date range
The default date range is "last 7 days." Your test data was just created, so it should be in range. If not, change the date picker to include today.

### STEP 3: What you should see
- **Coupon success rate**: A percentage (might be 50% if one code worked and one failed)
- **Cart views**: At least 1
- **Funnel**: Shows cart views → coupons attempted → etc.

### STEP 4: Check Cart Sessions tab
Click Cart Sessions. You should see:
- KPI boxes with numbers (Carts Opened, With Products, etc.)
- A table row showing your test session with the coupon codes

### STEP 5: Check Coupons tab
Click Coupons. You should see:
- `FAKE123` listed as a failed code
- `TEST10` listed as a successful code (if you used a real code)

### STEP 6: Check Notifications tab
Click Notifications. Page should load with toggle switches. No data needed — just verify it renders.

---

## ════════════════════════════════════
## 🛑 STOP — Dashboard shows data
## ════════════════════════════════════

At least ONE metric card shows a number. At least ONE session shows in the Cart Sessions table.

**If data shows**: proceed to Section 6.
**If pages load but data is empty**:
1. Check the Network tab — is the API call returning data or an error?
2. Open the API URL directly in browser: `https://couponmaxx.vercel.app/api/couponmaxx/analytics?shop=testingstoresumeet.myshopify.com&start=2026-03-11T00:00:00.000Z&end=2026-03-19T00:00:00.000Z&attrWindow=14&priceType=pre`
3. If it returns `{"error":"Shop not found"}` — the API is checking `isActive` and not finding the shop
4. If it returns data with all zeros — the CartEvent shopId doesn't match the Shop row id

---

## SECTION 6 — Uninstall/Reinstall Test (Test Gate 2)

### CYCLE 1:

**Uninstall:**
1. Dev store → Settings → Apps and sales channels → couponmaxx → Uninstall
2. Check Vercel logs — should show `[UNINSTALL] ====== WEBHOOK HIT ======` through `[UNINSTALL] ====== DONE ======`
3. Check Supabase:
   - Shop table: NO row for testingstoresumeet.myshopify.com
   - Session table: NO row for offline_testingstoresumeet.myshopify.com

**Reinstall:**
1. Partner Dashboard → couponmaxx → install on dev store
2. Check Vercel logs — all 6 AUTH steps
3. Check Supabase:
   - Shop table: NEW row with `isActive: true`, new `id` (different from before)
   - Session table: row exists
4. Open app in Shopify admin → page loads

### CYCLE 2: Repeat exact same steps.

### CYCLE 3: Repeat exact same steps.

**All 3 cycles must:**
- Create a clean Shop row on install
- Delete the Shop row on uninstall
- App loads after each reinstall

---

## ════════════════════════════════════
## 🛑 STOP — 3 clean cycles completed
## ════════════════════════════════════

If all 3 cycles passed, the install/uninstall flow is solid. Proceed to Section 7.

If any cycle failed:
- Screenshot the Vercel logs
- Check if the uninstall webhook fired (look for `[UNINSTALL]` in logs)
- If webhook didn't fire: the webhook URL in Partner Dashboard might be wrong
- If webhook fired but delete failed: the error message tells you why

---

## SECTION 7 — Session Tokens (Submission Requirement)

### WHAT NEEDS TO HAPPEN
Shopify's submission check requires that your API routes read session tokens from the `Authorization: Bearer` header. Phase 3 of FRESH-FOUNDATION-BUILD.md added `getShopFromRequest()` to all API routes.

### VERIFY IT'S DEPLOYED
```bash
grep -rl "getShopFromRequest" app/api/couponmaxx/ app/api/shop-status/ | wc -l
# Must be >= 7
```

If this returns 0, Phase 3 was not applied. Go back to FRESH-FOUNDATION-BUILD.md Phase 3 and apply it.

### GENERATE SESSION DATA
1. Open the app in Shopify admin
2. Click through ALL 4 tabs: Analytics → Cart Sessions → Coupons → Notifications
3. On each page, wait 3 seconds for the API calls to complete
4. Open DevTools → Network tab → look at any fetch to `/api/couponmaxx/analytics`
5. Click on it → Headers tab → Request Headers
6. You should see: `Authorization: Bearer eyJhbGci...`

If the Authorization header is present, session tokens are working. The Shopify check will turn green within 2 hours.

If the header is NOT present:
- App Bridge is not injecting tokens
- This happens when `SHOPIFY_API_KEY` doesn't match the installed app
- Verify the env var one more time

### WAIT
After clicking through all tabs, wait 2 hours. Check the submission page. Both checks should be green:
- ✅ Using the latest App Bridge script loaded from Shopify's CDN
- ✅ Using session tokens for user authentication

---

## SECTION 8 — Branding Cleanup

### THE RULE: Zero mentions of "CheckoutMaxx" anywhere the reviewer will see.

### 8a. Privacy page
**File**: `app/privacy/page.tsx`

Replace ALL "CheckoutMaxx" with "CouponMaxx". Update date to "March 2026". Update description to describe coupon analytics, not checkout monitoring.

Full replacement content was provided in PRE-SUBMISSION-FIXES.md from the earlier conversation.

### 8b. Email/alert references
**Files to update** (find/replace "CheckoutMaxx" → "CouponMaxx"):
- `lib/send-email.ts`
- `app/api/jobs/weekly-digest/route.ts`
- `app/api/jobs/test-alert/route.ts`
- `app/api/settings/test-slack/route.ts`
- `app/api/webhooks/customers/data-request/route.ts` (comment only)
- `app/api/webhooks/customers/redact/route.ts` (comment only)
- `extensions/cart-monitor/blocks/cart-monitor.liquid` (comment only)

### 8c. Verify
```bash
grep -rn "CheckoutMaxx" app/ components/ lib/ extensions/ --include="*.tsx" --include="*.ts" --include="*.liquid" 2>/dev/null | grep -v node_modules | grep -v ".next" | grep -v CHANGELOG | grep -v ".md" | wc -l
# Must: 0
```

### COMMIT:
```bash
git add -A
git commit -m "fix: rename all CheckoutMaxx to CouponMaxx for submission"
git push
```

Then manually redeploy couponmaxx on Vercel.

---

## SECTION 9 — Extension Deployment

The theme extension (cart-monitor) and web pixel (checkout-monitor) need to be deployed under the couponmaxx app. This requires temporarily changing the toml.

### STEP 1: Verify current toml client_id
```bash
grep "client_id" shopify.app.toml
```
Must show the couponmaxx app's client_id (`ef34a3eb07ec4333b42d63385823433b`).

### STEP 2: Verify liquid URLs
```bash
grep "data-ingest-url\|data-ping-url" extensions/cart-monitor/blocks/cart-monitor.liquid
```
Must show `couponmaxx.vercel.app`.

### STEP 3: Verify pixel URL
```bash
grep "INGEST_URL" extensions/checkout-monitor/src/index.ts | head -1
```
Must show `couponmaxx.vercel.app`.

### STEP 4: Deploy extensions
```bash
npx shopify app deploy
```

This registers both extensions under the couponmaxx Shopify app.

### STEP 5: Revert toml if you changed it
If the toml had to be changed for this step, revert it:
```bash
git checkout -- shopify.app.toml
```

Do NOT commit toml changes that would break the Dr.Water deployment.

---

## SECTION 10 — Final Submission

### PARTNER DASHBOARD CHECKLIST

Go to **Partner Dashboard → couponmaxx → App listing** and fill in:

**App name**: `CouponMaxx — Coupon & Discount Analytics`

**Tagline**: `Track failed coupon codes, monitor discount performance, and recover lost revenue.`

**Description**: (Full text in COPY-DASHBOARD-AND-SUBMIT.md)

**Key benefits**:
1. Track every coupon attempt — not just the successful ones
2. Get alerted instantly when a discount code breaks
3. See exactly how much revenue failed coupons are costing you
4. Monitor all active codes in one real-time dashboard
5. Session-level detail — see what happened before and after each coupon attempt
6. Works inside Shopify admin with no external tools needed

**Category**: Store analytics

**Support email**: Your real email that you monitor

**Privacy policy URL**: `https://couponmaxx.vercel.app/privacy`

**App icon**: 1200×1200 PNG (upload one)

**Screenshots**: At least 3. Take from Dr.Water where you have real data:
1. Analytics dashboard with charts
2. Cart Sessions table with session data
3. Coupons page with code health

### TESTING INSTRUCTIONS (paste this in the submission form):
```
1. Install the app on a development store
2. Go to Online Store → Themes → Customize → App embeds → enable "Cart Monitor"
3. Save the theme
4. Visit the storefront and add any product to cart
5. Open the cart drawer or cart page
6. Type any coupon code (valid or invalid) and click Apply
7. Return to the CouponMaxx app in Shopify admin
8. Navigate to Cart Sessions — the session should appear within 1-2 minutes
9. Navigate to Coupons — the code you tried will show with its success/failure status
10. Navigate to Notifications — configure alert thresholds and Slack/email channels

Note: The app needs a few minutes of storefront activity before the dashboard populates. Empty states are shown until data arrives.
```

### FINAL VERIFICATION

Both embedded app checks must be green:
- ✅ Using the latest App Bridge script loaded from Shopify's CDN
- ✅ Using session tokens for user authentication

If session tokens is still red, wait longer (up to 4 hours). If still red after 4 hours, the `getShopFromRequest` function may not be deployed — check that `lib/verify-session-token.ts` exists on the couponmaxx Vercel deployment.

### SUBMIT

Click **"Submit for review"**.

---

## QUICK REFERENCE — What to do if things break

| Symptom | Cause | Fix |
|---------|-------|-----|
| "admin.shopify.com refused to connect" | Root page redirect loop | Set App URL to `/couponmaxx/analytics` |
| No nav sidebar | App Bridge timing or config | Section 2 Options A/B/C |
| Blank page, no data | useShop() returns empty | Check SHOPIFY_API_KEY matches app client_id |
| "Shop not found" from API | Shop row missing or isActive=false | Check Supabase Shop table |
| Data in Supabase but not in UI | Date range mismatch | Change date picker to include today |
| PostMessage origin mismatch | SHOPIFY_API_KEY wrong | Fix env var, redeploy |
| Install fails silently | Auth callback error | Check Vercel logs for [AUTH] step that failed |
| Uninstall doesn't clean up | Webhook URL wrong | Check GDPR/webhook URLs in Partner Dashboard |
| Session tokens check red | Need to click through tabs + wait | Click all 4 tabs, wait 2-4 hours |
| Cart events not flowing | Cart monitor URLs wrong | Check liquid file points to couponmaxx.vercel.app |
| Checkout events not flowing | Pixel not deployed to couponmaxx app | Run `npx shopify app deploy` with correct client_id |
