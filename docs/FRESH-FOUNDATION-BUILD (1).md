# CouponMaxx — Fresh Foundation Build

## CONTEXT FOR CLAUDE CODE

You are rebuilding the install/uninstall/auth flow for a Shopify embedded app called CouponMaxx. The app already exists and works on one store (Dr.Water) but the auth flow has reliability issues when installing on new stores. We are rewriting ONLY the auth-related files. The dashboard pages, API routes, and extensions already exist in the repo and will be copied over AFTER the foundation is solid.

**What this app does**: Tracks coupon code usage on Shopify stores. Theme extension monitors cart events. Web pixel monitors checkout events. Dashboard shows analytics.

**Stack**: Next.js 14, Prisma (auth/billing), Supabase JS (analytics reads/writes), Polaris 12.9, deployed on Vercel.

**Shared Supabase DB**: Both the old deployment (Dr.Water) and new deployment (couponmaxx) share the same Supabase database. Do NOT run any destructive DB migrations. The Prisma schema and tables already exist.

**The app's Vercel URL**: `https://couponmaxx.vercel.app`
**The app's Shopify client_id**: Stored in env var `SHOPIFY_API_KEY`

---

## PHASE 1 — Auth callback rewrite

### THE RULES
1. Shop row MUST be created BEFORE pixel registration
2. Redirect MUST happen BEFORE background work (pixel, webhooks)
3. Every step gets a console.log with a numbered step
4. If pixel registration fails, the app still works — it just means no checkout tracking until pixel is registered later
5. If webhook registration fails, the app still works — webhooks are convenience, not critical path
6. The function must complete the critical path (HMAC → token → session → shop upsert → redirect) in under 6 seconds

### FILE: `app/api/auth/callback/route.ts`

Replace the ENTIRE file:

```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { Session } from "@shopify/shopify-api";
import { sessionStorage } from "@/lib/shopify";
import prisma from "@/lib/prisma";
import { registerAppPixel, deregisterAppPixel } from "@/lib/pixel-registration";
import { registerWebhooks } from "@/lib/shopify";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  console.log("[AUTH] ====== CALLBACK START ======", new Date().toISOString());

  const params = req.nextUrl.searchParams;
  const shop = params.get("shop");
  const code = params.get("code");
  const hmac = params.get("hmac");
  const host = params.get("host") ?? "";

  if (!shop || !code || !hmac) {
    console.error("[AUTH] MISSING PARAMS:", { shop: !!shop, code: !!code, hmac: !!hmac });
    return new Response("Missing required OAuth params", { status: 400 });
  }

  // ── STEP 1: HMAC ──
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("[AUTH] NO SHOPIFY_API_SECRET ENV VAR");
    return new Response("Server misconfiguration", { status: 500 });
  }

  const pairs: string[] = [];
  params.forEach((v, k) => { if (k !== "hmac") pairs.push(`${k}=${v}`); });
  pairs.sort();
  const expected = createHmac("sha256", secret).update(pairs.join("&")).digest("hex");

  try {
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"))) {
      console.error("[AUTH] HMAC MISMATCH");
      return new Response("HMAC validation failed", { status: 403 });
    }
  } catch {
    console.error("[AUTH] HMAC COMPARISON ERROR");
    return new Response("Invalid HMAC", { status: 403 });
  }
  console.log(`[AUTH] STEP 1 HMAC OK (${Date.now() - t0}ms):`, shop);

  // ── STEP 2: TOKEN EXCHANGE ──
  let accessToken: string;
  let scope: string;
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });
    const body = await tokenRes.json();
    if (!tokenRes.ok || !body.access_token) {
      console.error("[AUTH] TOKEN EXCHANGE FAILED:", JSON.stringify(body));
      return new Response("Token exchange failed", { status: 500 });
    }
    accessToken = body.access_token;
    scope = body.scope ?? "";
  } catch (err: any) {
    console.error("[AUTH] TOKEN EXCHANGE ERROR:", err.message);
    return new Response("Token exchange error", { status: 500 });
  }
  console.log(`[AUTH] STEP 2 TOKEN OK (${Date.now() - t0}ms):`, shop);

  // ── STEP 3: STORE SESSION ──
  try {
    const session = new Session({
      id: `offline_${shop}`,
      shop,
      state: "installed",
      isOnline: false,
    });
    session.accessToken = accessToken;
    session.scope = scope;
    await sessionStorage.storeSession(session);
  } catch (err: any) {
    console.error("[AUTH] SESSION STORE FAILED:", err.message);
    // Don't return 500 — try to continue. Session storage failing is bad but
    // the shop upsert is more important for the app to function.
  }
  console.log(`[AUTH] STEP 3 SESSION OK (${Date.now() - t0}ms):`, shop);

  // ── STEP 4: UPSERT SHOP ROW ──
  // THIS IS THE CRITICAL STEP. If this succeeds, the app works.
  // Everything after this is optional.
  let shopRecord: { id: string; pixelId: string | null } | null = null;
  try {
    // Check if shop already exists (for pixel cleanup on reinstall)
    const existing = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: { id: true, pixelId: true },
    });

    const result = await prisma.shop.upsert({
      where: { shopDomain: shop },
      update: {
        accessToken,
        isActive: true,
        installedAt: new Date(),
        // Clear old pixelId — will be re-registered in background
        pixelId: null,
      },
      create: {
        shopDomain: shop,
        accessToken,
        isActive: true,
        installedAt: new Date(),
      },
      select: { id: true, pixelId: true, isActive: true, shopDomain: true },
    });

    shopRecord = { id: result.id, pixelId: existing?.pixelId ?? null };
    console.log(`[AUTH] STEP 4 SHOP UPSERTED (${Date.now() - t0}ms):`, JSON.stringify(result));
  } catch (err: any) {
    console.error("[AUTH] STEP 4 SHOP UPSERT FAILED:", err.message, err.stack);
    // This is bad — the app won't show data. But still redirect so the user
    // sees SOMETHING and we can debug from logs.
  }

  // ── STEP 5: REDIRECT ──
  // Do this NOW. Don't wait for pixel or webhooks.
  // Use the canonical Shopify admin URL so App Bridge initializes correctly.
  const shopHandle = shop.replace(".myshopify.com", "");
  const redirectUrl = `https://admin.shopify.com/store/${shopHandle}/apps/${process.env.SHOPIFY_API_KEY}`;
  console.log(`[AUTH] STEP 5 REDIRECTING (${Date.now() - t0}ms):`, redirectUrl);

  // ── STEP 6: BACKGROUND WORK ──
  // Pixel registration + webhook registration run AFTER redirect.
  // If they fail, the app still works. Cart monitor doesn't need a pixel.
  // Checkout pixel is registered via `shopify app deploy`, not this code.
  // This code registers the WEB PIXEL (api-level), which is separate.
  const backgroundWork = async () => {
    const bgStart = Date.now();
    
    // 6a. Deregister old pixel if exists
    if (shopRecord?.pixelId) {
      try {
        await deregisterAppPixel(shop, accessToken, shopRecord.pixelId);
        console.log(`[AUTH] BG: old pixel deregistered (${Date.now() - bgStart}ms)`);
      } catch (err: any) {
        console.error("[AUTH] BG: deregister pixel error:", err.message);
      }
    }

    // 6b. Register new pixel
    try {
      const newPixelId = await registerAppPixel(shop, accessToken);
      if (newPixelId) {
        await prisma.shop.update({
          where: { shopDomain: shop },
          data: { pixelId: newPixelId },
        });
        console.log(`[AUTH] BG: pixel registered (${Date.now() - bgStart}ms):`, newPixelId);
      }
    } catch (err: any) {
      console.error("[AUTH] BG: pixel registration error:", err.message);
      // Not fatal — checkout pixel extension works independently via shopify app deploy.
      // This just registers the API-level pixel for the web pixel extension.
    }

    // 6c. Register webhooks
    try {
      const session = new Session({
        id: `offline_${shop}`,
        shop,
        state: "installed",
        isOnline: false,
      });
      session.accessToken = accessToken;
      await registerWebhooks(session);
      console.log(`[AUTH] BG: webhooks registered (${Date.now() - bgStart}ms)`);
    } catch (err: any) {
      console.error("[AUTH] BG: webhook registration error:", err.message);
    }

    console.log(`[AUTH] BG: all background work done (${Date.now() - bgStart}ms)`);
  };

  // Fire and forget — do NOT await
  backgroundWork().catch((err) => console.error("[AUTH] BG: uncaught error:", err));

  console.log(`[AUTH] ====== CALLBACK DONE (${Date.now() - t0}ms) ======`);
  return NextResponse.redirect(redirectUrl);
}
```

### VERIFY PHASE 1:
```bash
echo "1. File exists and compiles:"
npx next build 2>&1 | tail -5

echo ""
echo "2. Upsert BEFORE pixel:"
UPSERT=$(grep -n "STEP 4 SHOP UPSERTED" app/api/auth/callback/route.ts | head -1 | cut -d: -f1)
PIXEL=$(grep -n "registerAppPixel" app/api/auth/callback/route.ts | head -1 | cut -d: -f1)
echo "  Upsert line: $UPSERT, Pixel line: $PIXEL"

echo ""
echo "3. Redirect BEFORE background work:"
REDIRECT=$(grep -n "STEP 5 REDIRECTING" app/api/auth/callback/route.ts | head -1 | cut -d: -f1)
BG=$(grep -n "backgroundWork" app/api/auth/callback/route.ts | head -1 | cut -d: -f1)
echo "  Redirect line: $REDIRECT, BG line: $BG"

echo ""
echo "4. No await on backgroundWork:"
grep "backgroundWork()" app/api/auth/callback/route.ts
echo "  (Must NOT have 'await backgroundWork()')"
```

---

## ════════════════════════════════════════
## 🛑 STOP — TEST GATE 1: Install flow
## ════════════════════════════════════════

### WHAT TO DO:
1. Commit and push ONLY `app/api/auth/callback/route.ts`
2. Manually redeploy couponmaxx on Vercel (Deployments → Redeploy)
3. Delete any existing rows for dev store in Supabase:
```sql
DELETE FROM "CartEvent" WHERE "shopId" IN (SELECT id FROM "Shop" WHERE "shopDomain" = 'testingstoresumeet.myshopify.com');
DELETE FROM "CheckoutEvent" WHERE "shopId" IN (SELECT id FROM "Shop" WHERE "shopDomain" = 'testingstoresumeet.myshopify.com');
DELETE FROM "AlertLog" WHERE "shopId" IN (SELECT id FROM "Shop" WHERE "shopDomain" = 'testingstoresumeet.myshopify.com');
DELETE FROM "Baseline" WHERE "shopId" IN (SELECT id FROM "Shop" WHERE "shopDomain" = 'testingstoresumeet.myshopify.com');
DELETE FROM "Shop" WHERE "shopDomain" = 'testingstoresumeet.myshopify.com';
DELETE FROM "Session" WHERE shop = 'testingstoresumeet.myshopify.com';
```
4. Uninstall couponmaxx from dev store (if installed)
5. Open Vercel → couponmaxx → Logs in a separate tab
6. Install couponmaxx on dev store from Partner Dashboard

### EXPECTED LOGS (in order):
```
[AUTH] ====== CALLBACK START ======
[AUTH] STEP 1 HMAC OK (Xms): testingstoresumeet.myshopify.com
[AUTH] STEP 2 TOKEN OK (Xms): testingstoresumeet.myshopify.com
[AUTH] STEP 3 SESSION OK (Xms): testingstoresumeet.myshopify.com
[AUTH] STEP 4 SHOP UPSERTED (Xms): {"id":"...","pixelId":null,"isActive":true,"shopDomain":"testingstoresumeet.myshopify.com"}
[AUTH] STEP 5 REDIRECTING (Xms): https://admin.shopify.com/store/testingstoresumeet/apps/...
[AUTH] ====== CALLBACK DONE (Xms) ======
[AUTH] BG: pixel registered (Xms): gid://shopify/WebPixel/...  (may appear seconds later)
[AUTH] BG: webhooks registered (Xms)
[AUTH] BG: all background work done (Xms)
```

### HARD TEST — Check Supabase:
- `Session` table: row with `id = offline_testingstoresumeet.myshopify.com`, `accessToken` populated
- `Shop` table: row with `shopDomain = testingstoresumeet.myshopify.com`, `isActive = true`, `installedAt` = just now
- `Shop.pixelId`: may be null initially, should populate within 10 seconds from background work

### HARD TEST — Check Shopify admin:
- App loads inside Shopify admin (even if blank page)
- No "There's no page at this address" error
- URL bar shows `admin.shopify.com/store/testingstoresumeet/apps/...`

### IF ANY OF THESE FAIL:
Screenshot the Vercel logs. The step numbers tell you exactly where it broke. Do NOT proceed to Phase 2.

---

## PHASE 2 — Uninstall webhook rewrite

### THE RULES
1. Uninstall HARD DELETES the Shop row (not soft delete)
2. This ensures every reinstall creates a fresh row — no stale isActive=false ghosts
3. Related child rows (CartEvent, CheckoutEvent, etc.) have ON DELETE CASCADE in the DB... but Prisma may not cascade. So we delete children first.
4. Pixel deregistration is best-effort — if it fails, Shopify cleans it up eventually

### FILE: `app/api/webhooks/app-uninstalled/route.ts`

Replace the ENTIRE file:

```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { supabase } from "@/lib/supabase";
import { deregisterAppPixel } from "@/lib/pixel-registration";

export async function POST(req: NextRequest) {
  console.log("[UNINSTALL] ====== WEBHOOK HIT ======");

  // Verify HMAC
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) {
    console.error("[UNINSTALL] NO HMAC HEADER");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.text();
  const { createHmac } = await import("crypto");
  const secret = process.env.SHOPIFY_API_SECRET!;
  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  if (computed !== hmacHeader) {
    console.error("[UNINSTALL] HMAC MISMATCH");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    console.error("[UNINSTALL] INVALID JSON BODY");
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const shop = (body?.domain || body?.myshopify_domain) as string | undefined;
  if (!shop) {
    console.error("[UNINSTALL] NO SHOP DOMAIN IN PAYLOAD");
    return NextResponse.json({ error: "Missing shop" }, { status: 400 });
  }

  console.log("[UNINSTALL] STEP 1 VERIFIED:", shop);

  // Find shop record
  const shopRecord = await prisma.shop.findUnique({
    where: { shopDomain: shop },
    select: { id: true, pixelId: true, accessToken: true },
  });

  if (!shopRecord) {
    console.log("[UNINSTALL] No shop record found for:", shop, "— nothing to do");
    return NextResponse.json({ ok: true });
  }

  console.log("[UNINSTALL] STEP 2 FOUND SHOP:", shopRecord.id);

  // Deregister pixel (best effort)
  if (shopRecord.pixelId && shopRecord.accessToken) {
    try {
      await deregisterAppPixel(shop, shopRecord.accessToken, shopRecord.pixelId);
      console.log("[UNINSTALL] STEP 3 PIXEL DEREGISTERED");
    } catch (err: any) {
      console.error("[UNINSTALL] STEP 3 PIXEL DEREGISTER FAILED:", err.message);
      // Continue — Shopify will clean up orphaned pixels
    }
  } else {
    console.log("[UNINSTALL] STEP 3 NO PIXEL TO DEREGISTER");
  }

  // Delete child records first (Supabase JS for speed — no Prisma cold start)
  const shopId = shopRecord.id;
  try {
    await Promise.all([
      supabase.from("CartEvent").delete().eq("shopId", shopId),
      supabase.from("CheckoutEvent").delete().eq("shopId", shopId),
      supabase.from("AlertLog").delete().eq("shopId", shopId),
      supabase.from("Baseline").delete().eq("shopId", shopId),
    ]);
    console.log("[UNINSTALL] STEP 4 CHILD RECORDS DELETED");
  } catch (err: any) {
    console.error("[UNINSTALL] STEP 4 CHILD DELETE ERROR:", err.message);
    // Continue — try to delete shop row anyway
  }

  // Delete shop row
  try {
    await prisma.shop.delete({ where: { id: shopId } });
    console.log("[UNINSTALL] STEP 5 SHOP ROW DELETED:", shop);
  } catch (err: any) {
    console.error("[UNINSTALL] STEP 5 SHOP DELETE FAILED:", err.message);
    // Fallback: soft delete
    try {
      await prisma.shop.update({
        where: { id: shopId },
        data: { isActive: false, pixelId: null },
      });
      console.log("[UNINSTALL] STEP 5 FALLBACK: soft deleted");
    } catch {}
  }

  // Delete session
  try {
    await prisma.session.delete({ where: { id: `offline_${shop}` } });
    console.log("[UNINSTALL] STEP 6 SESSION DELETED");
  } catch (err: any) {
    console.log("[UNINSTALL] STEP 6 SESSION DELETE SKIPPED:", err.message);
  }

  console.log("[UNINSTALL] ====== DONE ======");
  return NextResponse.json({ ok: true });
}
```

### VERIFY PHASE 2:
```bash
echo "1. Hard delete present:"
grep -c "prisma.shop.delete" app/api/webhooks/app-uninstalled/route.ts
echo "(Must: >= 1)"

echo ""
echo "2. Child records deleted first:"
grep -n "CartEvent.*delete\|CheckoutEvent.*delete" app/api/webhooks/app-uninstalled/route.ts
echo "(Must: appear BEFORE prisma.shop.delete)"

echo ""
echo "3. Build:"
npx next build 2>&1 | tail -5
```

---

## ════════════════════════════════════════
## 🛑 STOP — TEST GATE 2: Uninstall + Reinstall cycle
## ════════════════════════════════════════

### WHAT TO DO:
1. Commit and push the uninstall webhook file
2. Manually redeploy couponmaxx
3. Open Vercel logs
4. Go to dev store → Settings → Apps → couponmaxx → Uninstall

### EXPECTED LOGS:
```
[UNINSTALL] ====== WEBHOOK HIT ======
[UNINSTALL] STEP 1 VERIFIED: testingstoresumeet.myshopify.com
[UNINSTALL] STEP 2 FOUND SHOP: cuid_xxx
[UNINSTALL] STEP 3 PIXEL DEREGISTERED (or NO PIXEL)
[UNINSTALL] STEP 4 CHILD RECORDS DELETED
[UNINSTALL] STEP 5 SHOP ROW DELETED: testingstoresumeet.myshopify.com
[UNINSTALL] STEP 6 SESSION DELETED
[UNINSTALL] ====== DONE ======
```

### HARD TEST — Supabase after uninstall:
- `Shop` table: NO row for testingstoresumeet.myshopify.com
- `Session` table: NO row for offline_testingstoresumeet.myshopify.com
- `CartEvent` table: NO rows for that shopId

### NOW REINSTALL:
1. Install couponmaxx again from Partner Dashboard
2. Check Vercel logs — all 6 AUTH steps should fire
3. Check Supabase — fresh Shop row with new `id`, `isActive: true`
4. App loads in Shopify admin

### REPEAT THIS 3 TIMES:
Uninstall → verify clean → reinstall → verify Shop row. All 3 times must succeed. If any fail, screenshot the logs and STOP.

---

## PHASE 3 — Session token verification

Shopify's submission requires "Using session tokens for user authentication." This means API routes must read the App Bridge session token from the `Authorization: Bearer` header.

### FILE: `lib/verify-session-token.ts` (NEW FILE)

```ts
import { createHmac } from "crypto";

/**
 * Verify an App Bridge session token (JWT signed with app secret).
 * Returns the shop domain if valid, null if invalid.
 */
export function verifySessionToken(token: string): string | null {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return null;

  try {
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    if (!headerB64 || !payloadB64 || !signatureB64) return null;

    // Verify signature
    const expected = createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");

    if (expected !== signatureB64) return null;

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());

    // Check expiry
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    // Extract shop from dest (format: https://shop.myshopify.com)
    const dest = payload.dest || payload.iss || "";
    const match = dest.match(/https?:\/\/([^/]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Get authenticated shop from request.
 * Tries session token first, falls back to query param.
 */
export function getShopFromRequest(req: Request): string | null {
  // 1. Try Authorization header (App Bridge session token)
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const shop = verifySessionToken(auth.slice(7));
    if (shop) return shop;
  }

  // 2. Fallback to query param
  const url = new URL(req.url);
  return url.searchParams.get("shop");
}
```

### UPDATE ALL COUPONMAXX API ROUTES:

Add this import to every file in `app/api/couponmaxx/*/route.ts`:

```ts
import { getShopFromRequest } from "@/lib/verify-session-token";
```

Then replace the shop extraction line. Find:
```ts
const shopDomain = p.get('shop');
```
Replace with:
```ts
const shopDomain = getShopFromRequest(req);
```

**Files to update:**
- `app/api/couponmaxx/analytics/route.ts`
- `app/api/couponmaxx/sessions/route.ts`
- `app/api/couponmaxx/session/route.ts`
- `app/api/couponmaxx/coupons/route.ts`
- `app/api/couponmaxx/notifications/route.ts`
- `app/api/couponmaxx/settings/route.ts`
- `app/api/shop-status/route.ts`

For routes where the request parameter is not named `req`, adapt accordingly. The function takes any `Request` object.

### VERIFY PHASE 3:
```bash
echo "1. verify-session-token.ts exists:"
ls lib/verify-session-token.ts

echo ""
echo "2. Imported in API routes:"
grep -rl "getShopFromRequest" app/api/ | wc -l
echo "(Must: >= 7)"

echo ""
echo "3. Build:"
npx next build 2>&1 | tail -5
```

---

## ════════════════════════════════════════
## 🛑 STOP — TEST GATE 3: App Bridge + Session Tokens
## ════════════════════════════════════════

### WHAT TO DO:
1. Commit and push
2. Redeploy couponmaxx
3. Open dev store → Apps → couponmaxx
4. Open browser DevTools → Network tab
5. Click through all 4 nav tabs

### HARD TEST — Network tab:
Look at the fetch requests to `/api/couponmaxx/analytics?shop=...` (or similar). The request headers should include:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

App Bridge 4.x auto-injects this header on `fetch()` calls made from within the embedded iframe. If you see this header, session tokens are working.

### HARD TEST — Shopify submission check:
After clicking through all tabs, wait 2 hours. The "Using session tokens" check should turn green.

If the Authorization header is NOT present in fetch requests, the issue is App Bridge not initializing. Check:
1. Vercel env var `SHOPIFY_API_KEY` matches the installed app's client_id
2. App URL in Partner Dashboard matches the Vercel URL exactly
3. No trailing slashes or protocol mismatches

---

## PHASE 4 — Cart monitor verification

The cart monitor is a THEME APP EXTENSION. It injects a `<script>` tag on the storefront that intercepts cart API calls and sends events to your ingest endpoint.

### CRITICAL: The liquid file has hardcoded URLs

**FILE**: `extensions/cart-monitor/blocks/cart-monitor.liquid`

The ingest URLs MUST point to the couponmaxx Vercel deployment. Check the current values:
```bash
grep "data-ingest-url\|data-ping-url" extensions/cart-monitor/blocks/cart-monitor.liquid
```

If they point to `checkoutmaxx-rt55.vercel.app`, change them to `couponmaxx.vercel.app`.

**IMPORTANT**: Do NOT commit this to main. It will break Dr.Water. Instead:
1. Change locally
2. Run `npx shopify app deploy` with couponmaxx credentials in `shopify.app.toml`
3. Revert the liquid file change
4. Do NOT commit

### HOW THE CART MONITOR WORKS:
1. Theme loads `cart-monitor.js` on every storefront page
2. Script intercepts `fetch()` calls to `/cart/add.js`, `/cart/update.js`, `/cart/change.js`
3. When a coupon is applied/failed, it sends a `POST` to `data-ingest-url`
4. The ingest endpoint (`/api/cart/ingest`) resolves the shopId from the `Shop` table
5. Events are inserted into `CartEvent` table

### HOW TO DEPLOY EXTENSIONS TO COUPONMAXX:

```bash
# 1. Temporarily update toml with couponmaxx credentials
# (client_id, application_url, redirect_urls — all to couponmaxx.vercel.app)

# 2. Temporarily update cart-monitor.liquid URLs to couponmaxx.vercel.app

# 3. Deploy
npx shopify app deploy

# 4. REVERT both files immediately
git checkout -- shopify.app.toml extensions/cart-monitor/blocks/cart-monitor.liquid
```

---

## ════════════════════════════════════════
## 🛑 STOP — TEST GATE 4: Cart data flowing
## ════════════════════════════════════════

### WHAT TO DO:
1. Deploy extensions to couponmaxx (steps above)
2. Go to dev store → Online Store → Themes → Customize → App embeds → enable Cart Monitor → Save
3. Open dev store storefront in a new tab
4. Open browser DevTools → Console
5. Add a product to cart
6. Go to cart page
7. Type a coupon code and click Apply

### HARD TEST — Console:
You should see:
```
[CouponMaxx] Loaded — shop: testingstoresumeet.myshopify.com session: cart_XXXX_XXXXXX
```

If you see `[CheckoutMaxx]` instead, the OLD extension is still active. Remove it from theme App embeds and re-enable the new one.

### HARD TEST — Supabase:
Check `CartEvent` table. Filter by `shopDomain` or the shopId from the Shop table. You should see rows with:
- `eventType: cart_coupon_applied` or `cart_coupon_failed`
- `couponCode: whatever you typed`
- `cartValue: the cart total in cents`

### HARD TEST — Vercel logs:
You should see `POST /api/cart/ingest` with 200 status.

If events are NOT appearing:
1. Check cart-monitor.liquid URLs point to couponmaxx.vercel.app
2. Check that the Shop row exists in Supabase with `isActive: true`
3. Check Vercel logs for errors on `/api/cart/ingest`

---

## PHASE 5 — Checkout pixel verification

The checkout pixel is a WEB PIXEL EXTENSION. It runs in Shopify's sandboxed environment during checkout.

### FILE: `extensions/checkout-monitor/src/index.ts`

Check line 13:
```ts
const INGEST_URL = "https://couponmaxx.vercel.app/api/pixel/ingest";
```

This MUST point to `couponmaxx.vercel.app`. If it doesn't, change it as part of the `npx shopify app deploy` step above.

### HOW IT WORKS:
1. Shopify loads the web pixel in a sandboxed worker during checkout
2. Pixel subscribes to: `checkout_started`, `checkout_completed`, `payment_info_submitted`, etc.
3. On each event, it calls `browser.sendBeacon(INGEST_URL, payload)`
4. The pixel ingest endpoint (`/api/pixel/ingest`) inserts into `CheckoutEvent`

### VERIFY PIXEL INGEST ROUTE IS ACTIVE:
```bash
# Check it's not entirely commented out
grep -v "^//" app/api/pixel/ingest/route.ts | grep -v "^$" | head -5
# Should show actual imports, not comments
```

---

## ════════════════════════════════════════
## 🛑 STOP — TEST GATE 5: Checkout data flowing
## ════════════════════════════════════════

### WHAT TO DO:
1. On dev store, verify checkout pixel is registered: Settings → Customer events → should see "checkout-monitor"
2. Go to storefront, add product to cart, proceed to checkout
3. Complete the checkout (use Shopify's test payment gateway — "Bogus Gateway")

### HARD TEST — Supabase:
Check `CheckoutEvent` table. You should see rows with:
- `eventType: checkout_started`
- `eventType: checkout_completed` (if you completed the order)
- `shopId` matching the Shop row

### HARD TEST — Vercel logs:
Look for `POST /api/pixel/ingest` with 200 status.

If checkout events are NOT flowing:
1. Check Settings → Customer events — is "checkout-monitor" listed?
2. If not, the extension didn't deploy. Run `npx shopify app deploy` again.
3. Check pixel ingest route is not commented out
4. Check the INGEST_URL in the extension points to couponmaxx.vercel.app

---

## PHASE 6 — Nav verification

The nav is rendered by `<ui-nav-menu>` in the CouponMaxx layout file.

### FILE: `app/(embedded)/couponmaxx/layout.tsx`

```tsx
<ui-nav-menu>
  <a href="/couponmaxx/analytics" rel="home">Analytics</a>
  <a href="/couponmaxx/sessions">Cart Sessions</a>
  <a href="/couponmaxx/coupons">Coupons</a>
  <a href="/couponmaxx/notifications">Notifications</a>
</ui-nav-menu>
```

This uses App Bridge's native web component. It only works when:
1. App Bridge is initialized (correct API key)
2. The app is loaded inside the Shopify admin iframe
3. The layout file actually renders (the route matches `/couponmaxx/*`)

### IF NAV DOESN'T SHOW:
1. Check the App URL in Partner Dashboard points to `https://couponmaxx.vercel.app`
2. The root page (`app/page.tsx`) must redirect to `/couponmaxx/analytics` — check it does
3. Open DevTools console — look for "App Bridge" errors
4. Try: close the tab entirely, go to Shopify admin → Apps → click couponmaxx fresh

---

## ════════════════════════════════════════
## 🛑 STOP — TEST GATE 6: Full app functional
## ════════════════════════════════════════

### THE FINAL CHECKLIST:

**Install/Uninstall:**
- [ ] Install creates Shop row in Supabase (isActive: true)
- [ ] Install creates Session row in Supabase
- [ ] Uninstall deletes Shop row completely
- [ ] Uninstall deletes Session row
- [ ] 3x install/uninstall cycles all succeed

**App Bridge:**
- [ ] App loads inside Shopify admin iframe
- [ ] Nav shows 4 tabs in sidebar
- [ ] Clicking each tab navigates correctly
- [ ] No "postMessage origin mismatch" errors in console
- [ ] No "App Bridge: missing shop" errors in console

**Cart Monitor:**
- [ ] Console shows `[CouponMaxx] Loaded — shop: ...`
- [ ] Applying a coupon creates CartEvent rows in Supabase
- [ ] Failed coupon shows `cart_coupon_failed` event type
- [ ] Successful coupon shows `cart_coupon_applied` event type

**Checkout Pixel:**
- [ ] "checkout-monitor" visible in Settings → Customer events
- [ ] Starting checkout creates `checkout_started` event in CheckoutEvent table
- [ ] Completing checkout creates `checkout_completed` event

**Dashboard:**
- [ ] Analytics page loads with data (after storefront activity)
- [ ] Cart Sessions page shows sessions
- [ ] Coupons page shows coupon codes
- [ ] Notifications page loads

**Submission:**
- [ ] App Bridge CDN check: green ✅
- [ ] Session tokens check: green ✅ (may take 2 hours after clicking through tabs)

---

## ENV VARS REQUIRED ON VERCEL (couponmaxx project)

```
SHOPIFY_API_KEY=<personal app client_id>
SHOPIFY_API_SECRET=<personal app secret>
SHOPIFY_APP_URL=https://couponmaxx.vercel.app
NEXT_PUBLIC_APP_URL=https://couponmaxx.vercel.app
DATABASE_URL=<prisma connection string>
DIRECT_URL=<prisma direct connection string>
SUPABASE_URL=<supabase project url>
SUPABASE_SERVICE_ROLE_KEY=<supabase service role key>
NEXT_PUBLIC_SUPABASE_URL=<supabase project url>
```

**Note**: Check your `lib/supabase.ts` — it uses `SUPABASE_URL` (not `NEXT_PUBLIC_SUPABASE_URL`). Make sure both exist. Some files may reference either.

---

## COMMIT STRATEGY

```bash
# Phase 1 only:
git add app/api/auth/callback/route.ts
git commit -m "fix: rewrite auth callback — upsert before pixel, bg work after redirect"

# Phase 2 only (after Test Gate 1 passes):
git add app/api/webhooks/app-uninstalled/route.ts
git commit -m "fix: uninstall hard deletes shop row for clean reinstalls"

# Phase 3 only (after Test Gate 2 passes):
git add lib/verify-session-token.ts
git add app/api/couponmaxx/
git add app/api/shop-status/route.ts
git commit -m "feat: session token verification for BFS submission"
```

Each commit is independently safe. Each one builds on the previous. Each has a test gate before the next.
