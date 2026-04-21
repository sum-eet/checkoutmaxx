# Plan: Strip + Rebuild CouponMaxx (Minimal Submission App)

## Context

After 10 days of patch-on-patch across 15+ commits on shop/auth/pixel lifecycle, the architecture has drifted. Fastest path to a clean, submittable app = strip 80% of code, rebuild the submission-critical surface minimally.

CheckoutMaxx (client `0a60bbe935cef2f46838acec2b3918d8`, `checkoutmaxx-rt55.vercel.app`, runs on drwater store `jg2svv-pc.myshopify.com`) is the sanity-plan-B app. Its Vercel auto-deploy is off (last deploy April 7 2026). It continues to run unchanged throughout this rebuild.

CouponMaxx (client `ef34a3eb07ec4333b42d63385823433b`, `couponmaxx.vercel.app`) is the submission app. This plan rebuilds CouponMaxx only. Public URL contract filed with Shopify Partners is preserved verbatim.

## Immutable submission contract (must not change)

If any of these change, Partners resubmission is required. The rewrite keeps them byte-identical.

- Vercel production domain: `https://couponmaxx.vercel.app`
- OAuth callback path: `/api/auth/callback`
- GDPR webhook paths: `/api/webhooks/customers/data-request`, `/api/webhooks/customers/redact`, `/api/webhooks/shop/redact`
- OAuth scopes (comma-separated, exact order): `read_orders,read_checkouts,write_pixels,read_customer_events,read_analytics,write_discounts`
- `client_id` in `shopify.app.toml`: `ef34a3eb07ec4333b42d63385823433b`
- Extension handles (in `shopify.app.toml`): `checkout-monitor` (web_pixel), `cart-monitor` (theme), `checkout-recovery` (ui_extension)
- App webhook api_version: `2025-07`
- App `embedded = true`
- App name: `couponmaxx`

## Decisions locked

| Decision | Value |
|---|---|
| Rebuild branch | `rebuild-minimal` cut from `couponmaxx-submission` |
| `main`, `couponmaxx-submission` branches | Untouched. Fallbacks. |
| Supabase DB | Reuse. No table DROP during rebuild. Leave unused tables dormant. |
| Extensions | Copy proven dirs from current branch (`cart-monitor`, `checkout-recovery`, `checkout-monitor`) — do not rewrite |
| Admin UI | One minimal embedded screen: `/couponmaxx` diagnostics (status cards only). All other dashboard pages deleted. |
| Billing | In scope — keep existing logic if proven, stub if broken |
| Analytics/notifications/slack/klaviyo/email/alerts/crons | Deleted |
| Vercel deployment | Couponmaxx project switches to `rebuild-minimal` only after Phase 1 tests pass |
| CheckoutMaxx side | Do not touch. Its Vercel project, env vars, and DB reads stay as-is. |

## Branch + git strategy

```bash
git fetch --all
git checkout couponmaxx-submission
git pull
git checkout -b rebuild-minimal
```

All Phase 0–5 work happens on `rebuild-minimal`. Push every phase as its own commit. Do not merge to `couponmaxx-submission` until Phase 5 passes end-to-end.

## Supabase DB posture

Shared with CheckoutMaxx. Do not drop any table. What we need from the DB for CouponMaxx rebuild:

**Tables reused (schema unchanged):**
- `Shop` — gets a unique index on `shopDomain` + new `uninstalledAt` column
- `Session` — unchanged, used by session storage
- `CartEvent` — unchanged
- `CheckoutEvent` — unchanged

**Tables left dormant (not touched, not dropped):**
- `AlertLog`, `Baseline`, `SessionPing`, `RecoveryEvent`, `MerchantRecoverySettings`, `IngestLog`, any notification tables, etc.

**SQL to run in Supabase SQL editor** (Sumeet runs these; Sonnet does not):

```sql
-- 1. Add uninstalledAt column
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "uninstalledAt" TIMESTAMPTZ NULL;

-- 2. Ensure shopDomain unique index exists
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- 3. Replace create_shop RPC with upsert-on-conflict
CREATE OR REPLACE FUNCTION create_shop(p_shop_domain TEXT, p_access_token TEXT)
RETURNS TABLE(id UUID, prev_pixel_id TEXT) AS $$
DECLARE out_id UUID; out_prev TEXT;
BEGIN
  SELECT "pixelId" INTO out_prev FROM "Shop" WHERE "shopDomain" = p_shop_domain;

  INSERT INTO "Shop" (id, "shopDomain", "accessToken", "isActive", "installedAt", "updatedAt", "uninstalledAt", "pixelId")
  VALUES (gen_random_uuid(), p_shop_domain, p_access_token, true, now(), now(), NULL, NULL)
  ON CONFLICT ("shopDomain") DO UPDATE SET
    "accessToken"   = EXCLUDED."accessToken",
    "isActive"      = true,
    "installedAt"   = now(),
    "updatedAt"     = now(),
    "uninstalledAt" = NULL,
    "pixelId"       = NULL
  RETURNING "Shop".id INTO out_id;

  RETURN QUERY SELECT out_id, out_prev;
END;
$$ LANGUAGE plpgsql;

-- 4. Verify
SELECT routine_name FROM information_schema.routines WHERE routine_name = 'create_shop';
SELECT indexname FROM pg_indexes WHERE tablename = 'Shop' AND indexdef ILIKE '%shopDomain%';
```

Before running: check for duplicate shopDomain rows that would block the unique index. If any exist, keep newest active row, delete older duplicates.

```sql
SELECT "shopDomain", count(*) FROM "Shop" GROUP BY 1 HAVING count(*) > 1;
```

---

# Phase-by-phase execution

Each phase has: scope, exact file list (delete / keep / rewrite), full code snippets for rewrites, test commands, expected log output, commit message, rollback.

Sonnet: do the phases in order. Do not start a phase until the previous phase's tests pass. Do not create files or take actions outside the lists given here.

---

## Phase 0 — Strip

**Goal:** Delete all out-of-scope files. Repo shrinks to ~50 source files.

### Files to DELETE (run `rm` on each; then `git add -A`)

#### API routes (delete entire directories/files)

```
app/api/auth/route.ts                                  # dead SDK-based begin, causes state mismatch
app/api/couponmaxx/analytics/route.ts
app/api/couponmaxx/cart/activity/route.ts
app/api/couponmaxx/cart/conversion/route.ts
app/api/couponmaxx/cart/route.ts
app/api/couponmaxx/coupons/[code]/route.ts
app/api/couponmaxx/coupons/route.ts
app/api/couponmaxx/notifications/[id]/read/route.ts
app/api/couponmaxx/notifications/route.ts
app/api/couponmaxx/recovery/settings/route.ts
app/api/couponmaxx/recovery/stats/route.ts
app/api/couponmaxx/session/route.ts
app/api/couponmaxx/sessions/route.ts
app/api/couponmaxx/settings/route.ts
app/api/couponmaxx/slack/callback/route.ts
app/api/debug/auth/route.ts
app/api/jobs/                                          # entire dir (crons)
```

Keep: `app/api/couponmaxx/cx/route.ts`, `app/api/couponmaxx/health/route.ts`, `app/api/couponmaxx/recovery/decide/route.ts` — used by claim + diagnostics.

#### Embedded pages

Delete everything under `app/(embedded)/couponmaxx/` EXCEPT `diagnostics/page.tsx` and `layout.tsx`.

```
app/(embedded)/couponmaxx/analytics/loading.tsx
app/(embedded)/couponmaxx/analytics/page.tsx
app/(embedded)/couponmaxx/cart/page.tsx
app/(embedded)/couponmaxx/coupons/loading.tsx
app/(embedded)/couponmaxx/coupons/page.tsx
app/(embedded)/couponmaxx/notifications/page.tsx
app/(embedded)/couponmaxx/sessions/loading.tsx
app/(embedded)/couponmaxx/sessions/page.tsx
app/(embedded)/couponmaxx/settings/page.tsx
app/(embedded)/couponmaxx/error.tsx
```

Delete entire directories:
```
app/preview/
app/install/
```

#### Components

Delete entirely:
```
components/monitor/                                    # entire dir (live-feed / kpi / funnel)
components/couponmaxx/DateRangePicker.tsx
components/couponmaxx/FunnelChart.tsx
components/couponmaxx/KpiBox.tsx
components/couponmaxx/LineChartInCard.tsx
components/couponmaxx/LoadingBar.tsx
components/couponmaxx/MetricCard.tsx
components/couponmaxx/OnboardingBanner.tsx
components/couponmaxx/SideBySideComparison.tsx
components/couponmaxx/Toggle.tsx
components/couponmaxx/ToggleGroup.tsx
```

Keep `components/couponmaxx/` directory (will be rebuilt empty or with a single StatusCard component in Phase 4).

#### Libs

Delete:
```
lib/alert-engine.ts
lib/compute-baselines.ts
lib/ingest-log.ts
lib/metrics.ts
lib/send-email.ts
lib/send-slack.ts
lib/authenticated-fetch.ts
lib/session-utils.ts
hooks/useShop.ts                                       # only if confirmed unused post-strip; otherwise keep
```

Keep:
```
lib/shopify.ts
lib/shop.ts                                            # rewritten in Phase 1
lib/pixel.ts                                           # rewritten in Phase 2
lib/prisma.ts
lib/supabase.ts
lib/session-storage.ts
lib/sanitize.ts                                        # used by cart ingest
lib/verifyWebhookHmac.ts
lib/verify-session-token.ts
lib/env-check.ts
lib/billing.ts                                         # rebuilt/stubbed in Phase 4
```

#### Scripts / misc

Delete:
```
scripts/check-funnel.ts
scripts/read-cart-log.ts
pixel/checkout-monitor.js                              # if not referenced by extensions/checkout-monitor
__tests__/                                             # entire dir, unless rebuild tests are desired
foundation-17-apr.md
remotion/
caveman/
docs/archive/                                          # keep docs/ but drop archived junk
supabase/.temp/
```

Keep `docs/` itself. Keep `extensions/` entirely.

### Files to KEEP untouched (do not modify)

```
extensions/cart-monitor/                               # proven theme extension — used as-is
extensions/checkout-recovery/                          # proven checkout UI extension — used as-is
extensions/checkout-monitor/                           # web pixel extension — used as-is
shopify.app.toml                                       # couponmaxx app config
shopify.app.checkoutmaxx.toml                          # checkoutmaxx reference config (do not edit)
shopify.web.toml
next.config.mjs
tsconfig.json
package.json                                           # will be pruned in Phase 0b
vercel.json
vitest.config.ts                                       # delete only if __tests__ is deleted
middleware.ts
```

### Phase 0b — Prune package.json

After deleting files above, remove unused deps:
```
@klaviyo/api, @slack/web-api, nodemailer, resend, node-cron, any chart libs (recharts, etc.),
any unused ui libs, @remotion/*
```

Keep: `@shopify/*`, `@prisma/client`, `@supabase/supabase-js`, `next`, `react`, `react-dom`, `@vercel/functions`, `zod` if used, typescript, tailwind (if diagnostics page uses it — else remove).

Run `npm install` to regenerate lockfile. Commit lockfile.

### Phase 0 tests

```bash
npx tsc --noEmit
```

Expected: TypeScript compiles with zero errors after strip. If it errors because deleted files are imported somewhere we missed, chase the import, delete the importer if out of scope, or stub it.

### Phase 0 commit

```
strip: delete analytics, notifications, slack, klaviyo, crons, preview — rebuild foundation
```

### Phase 0 rollback

`git checkout rebuild-minimal~1 -- <path>` to restore individual files if accidentally deleted. Worst case: `git reset --hard couponmaxx-submission` and re-cut branch.

---

## Phase 1 — Auth + Shop lifecycle

**Goal:** Working install → uninstall → reinstall with stable Shop id + race-safe webhook + single OAuth begin route.

### Files to REWRITE

#### 1.1 `prisma/schema.prisma`

Trim to only models we keep. Replace entire file with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

model Session {
  id            String    @id
  shop          String
  state         String
  isOnline      Boolean   @default(false)
  scope         String?
  expires       DateTime?
  accessToken   String
  userId        BigInt?
  firstName     String?
  lastName      String?
  email         String?
  accountOwner  Boolean   @default(false)
  locale        String?
  collaborator  Boolean?  @default(false)
  emailVerified Boolean?  @default(false)
}

model Shop {
  id              String   @id @default(cuid())
  shopDomain      String   @unique
  accessToken     String?
  pixelId         String?
  isActive        Boolean  @default(true)
  installedAt     DateTime @default(now())
  uninstalledAt   DateTime?
  timezone        String   @default("UTC")

  subscriptionId     String?
  subscriptionStatus String?
  trialEndsAt        DateTime?
  billingPlan        String    @default("free")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  cartEvents     CartEvent[]
  checkoutEvents CheckoutEvent[]
}

model CartEvent {
  id               String   @id @default(cuid())
  shopId           String
  sessionId        String
  cartToken        String
  eventType        String
  cartValue        Int?
  cartItemCount    Int?
  lineItems        Json?
  couponCode       String?
  couponSuccess    Boolean?
  couponFailReason String?
  couponRecovered  Boolean?
  discountAmount   Int?
  lineIndex        Int?
  newQuantity      Int?
  pageUrl          String?
  device           String?
  country          String?
  utmSource        String?
  utmMedium        String?
  utmCampaign      String?
  utmReferrer      String?
  occurredAt       DateTime
  createdAt        DateTime @default(now())

  shop Shop @relation(fields: [shopId], references: [id])

  @@index([shopId, occurredAt])
  @@index([sessionId])
  @@index([cartToken])
  @@index([shopId, eventType, occurredAt])
  @@index([shopId, couponCode, occurredAt])
}

model CheckoutEvent {
  id     String @id @default(cuid())
  shopId String
  shop   Shop   @relation(fields: [shopId], references: [id])

  sessionId String
  eventType String

  deviceType   String?
  country      String?
  discountCode String?
  totalPrice   Float?
  currency     String?
  gatewayName  String?
  errorMessage String?
  extensionId  String?

  rawPayload Json
  occurredAt DateTime
  receivedAt DateTime @default(now())

  @@index([shopId, eventType, occurredAt])
  @@index([shopId, sessionId])
  @@index([shopId, occurredAt])
}
```

DO NOT run `prisma migrate dev`. Supabase DB already has the unique index + `uninstalledAt` column applied (operator step). Only run:

```bash
npx prisma generate
```

If deleted models (AlertLog, Baseline, etc.) still have columns/rows in DB, that's fine — Prisma ignores them.

#### 1.2 `app/api/auth/begin/route.ts`

Replace entire file with:

```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) return new Response("Missing shop param", { status: 400 });
  if (!/^[a-z0-9][a-z0-9\-]*\.myshopify\.com$/i.test(shop)) {
    return new Response("Invalid shop domain", { status: 400 });
  }

  console.log("[auth/begin] shop:", shop);

  const apiKey = process.env.SHOPIFY_API_KEY!;
  const scopes = "read_orders,read_checkouts,write_pixels,read_customer_events,read_analytics,write_discounts";
  const redirectUri = `${process.env.SHOPIFY_APP_URL}/api/auth/callback`;
  const state = crypto.randomBytes(16).toString("hex");

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${apiKey}` +
    `&scope=${scopes}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  console.log("[auth/begin] redirecting:", installUrl);
  const res = NextResponse.redirect(installUrl);
  res.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });
  return res;
}
```

#### 1.3 `app/api/auth/callback/route.ts`

Replace entire file with:

```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { Session } from "@shopify/shopify-api";
import { sessionStorage, registerWebhooks } from "@/lib/shopify";
import { waitUntil } from "@vercel/functions";
import { supabase } from "@/lib/supabase";
import { createShop } from "@/lib/shop";
import { registerAppPixel, deregisterAppPixel } from "@/lib/pixel";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  console.log("[AUTH] ====== CALLBACK START ======", new Date().toISOString());

  const params = req.nextUrl.searchParams;
  const shop = params.get("shop");
  const code = params.get("code");
  const hmac = params.get("hmac");
  const state = params.get("state");

  if (!shop || !code || !hmac) {
    console.error("[AUTH] MISSING PARAMS", { shop: !!shop, code: !!code, hmac: !!hmac });
    return new Response("Missing required OAuth params", { status: 400 });
  }

  // State
  const storedState = req.cookies.get("shopify_oauth_state")?.value;
  if (!state || !storedState || state !== storedState) {
    console.error("[AUTH] STATE MISMATCH");
    return new Response("State validation failed", { status: 403 });
  }

  // HMAC
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return new Response("Server misconfiguration", { status: 500 });

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
    return new Response("Invalid HMAC", { status: 403 });
  }
  console.log(`[AUTH] STEP 1 HMAC OK (${Date.now() - t0}ms)`);

  // Token exchange
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
      console.error("[AUTH] TOKEN EXCHANGE FAILED", JSON.stringify(body));
      return new Response("Token exchange failed", { status: 500 });
    }
    accessToken = body.access_token;
    scope = body.scope ?? "";
  } catch (err: any) {
    console.error("[AUTH] TOKEN EXCHANGE ERROR", err.message);
    return new Response("Token exchange error", { status: 500 });
  }
  console.log(`[AUTH] STEP 2 TOKEN OK (${Date.now() - t0}ms)`);

  // Session
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
    console.error("[AUTH] SESSION STORE FAILED", err.message);
  }
  console.log(`[AUTH] STEP 3 SESSION OK (${Date.now() - t0}ms)`);

  // Upsert shop row (stable id)
  let shopId: string;
  let prevPixelId: string | null = null;
  try {
    const result = await createShop(shop, accessToken);
    shopId = result.id;
    prevPixelId = result.prevPixelId;
    console.log(`[AUTH] STEP 4 SHOP OK id=${shopId} prevPixel=${prevPixelId} (${Date.now() - t0}ms)`);
  } catch (err: any) {
    console.error("[AUTH] STEP 4 SHOP FAILED", err.message);
    return new Response(`Shop provisioning failed: ${err.message}`, { status: 500 });
  }

  // BG: pixel + webhooks
  const shopCapture = shop;
  const tokenCapture = accessToken;
  const shopIdCapture = shopId;
  const prevPixelCapture = prevPixelId;

  waitUntil(Promise.all([
    (async () => {
      try {
        if (prevPixelCapture) {
          await deregisterAppPixel(shopCapture, tokenCapture, prevPixelCapture);
          console.log("[AUTH] BG: old pixel deregistered", prevPixelCapture);
        }
        const pid = await registerAppPixel(shopCapture, tokenCapture);
        if (pid) {
          const { error } = await supabase.from("Shop").update({ pixelId: pid }).eq("id", shopIdCapture);
          if (error) console.error("[AUTH] BG: pixelId update failed", error.message);
          else console.log("[AUTH] BG: pixel registered", pid);
        } else {
          console.log("[AUTH] BG: registerAppPixel null — pixel may still be live");
        }
      } catch (err: any) {
        console.error("[AUTH] BG: pixel block error", err?.message);
      }
    })(),
    (async () => {
      try {
        const session = new Session({
          id: `offline_${shopCapture}`,
          shop: shopCapture,
          state: "installed",
          isOnline: false,
        });
        session.accessToken = tokenCapture;
        await registerWebhooks(session);
        console.log("[AUTH] BG: webhooks registered");
      } catch (err: any) {
        console.error("[AUTH] BG: webhook error", err?.message);
      }
    })(),
  ]));

  // Redirect to embedded admin
  const shopHandle = shop.replace(".myshopify.com", "");
  const redirectUrl = `https://admin.shopify.com/store/${shopHandle}/apps/${process.env.SHOPIFY_API_KEY}`;
  console.log(`[AUTH] STEP 5 REDIRECT ${redirectUrl} (${Date.now() - t0}ms)`);

  const res = NextResponse.redirect(redirectUrl);
  res.cookies.delete("shopify_oauth_state");
  return res;
}
```

#### 1.4 `lib/shop.ts`

Replace entire file with:

```ts
import { supabase } from "./supabase";

export async function getShop(
  shopDomain: string
): Promise<{ id: string; accessToken: string; pixelId: string | null } | null> {
  console.log("[shop] getShop shopDomain=%s", shopDomain);

  const { data, error } = await supabase
    .from("Shop")
    .select("id, accessToken, pixelId, isActive")
    .eq("shopDomain", shopDomain)
    .maybeSingle();

  if (error) {
    console.error("[shop] getShop SELECT failed", error.code, error.message);
    return null;
  }
  if (!data) {
    console.log("[shop] getShop: no row for %s", shopDomain);
    return null;
  }
  if (data.isActive !== true && data.isActive !== "true" && data.isActive !== 1) {
    console.log("[shop] getShop: row inactive for %s", shopDomain);
    return null;
  }
  if (!data.accessToken) {
    console.log("[shop] getShop: row has no accessToken (uninstalled) for %s", shopDomain);
    return null;
  }
  console.log("[shop] getShop → %s", data.id);
  return { id: data.id, accessToken: data.accessToken, pixelId: data.pixelId ?? null };
}

export async function createShop(
  shopDomain: string,
  accessToken: string
): Promise<{ id: string; prevPixelId: string | null }> {
  console.log("[shop] createShop shopDomain=%s", shopDomain);
  const { data, error } = await supabase
    .rpc("create_shop", { p_shop_domain: shopDomain, p_access_token: accessToken })
    .single();
  if (error || !data) {
    throw new Error(`[shop] createShop failed for ${shopDomain}: ${error?.message ?? "unknown"}`);
  }
  const id = (data as any).id as string;
  const prev = ((data as any).prev_pixel_id as string | null) ?? null;
  console.log("[shop] createShop id=%s prevPixel=%s", id, prev);
  return { id, prevPixelId: prev };
}
```

#### 1.5 `app/api/webhooks/app-uninstalled/route.ts`

Replace entire file with:

```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabase } from "@/lib/supabase";

function ok() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  console.log("[UNINSTALL] ====== WEBHOOK ======");

  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) return ok();

  const rawBody = await req.text();
  const secret = process.env.SHOPIFY_API_SECRET!;
  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  const aBuf = Buffer.from(computed);
  const bBuf = Buffer.from(hmacHeader);
  if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
    console.error("[UNINSTALL] HMAC MISMATCH");
    return ok();
  }

  let body: any;
  try { body = JSON.parse(rawBody); } catch { return ok(); }

  const shopDomain = (body?.domain || body?.myshopify_domain) as string | undefined;
  if (!shopDomain) return ok();

  const triggeredAtHeader = req.headers.get("x-shopify-triggered-at");
  const triggered = triggeredAtHeader ? new Date(triggeredAtHeader) : new Date();
  console.log("[UNINSTALL] shop=%s triggered=%s", shopDomain, triggered.toISOString());

  const { data: row, error: selErr } = await supabase
    .from("Shop")
    .select("id, installedAt")
    .eq("shopDomain", shopDomain)
    .maybeSingle();

  if (selErr) {
    console.error("[UNINSTALL] SELECT failed", selErr.message);
    return ok();
  }
  if (!row) {
    console.log("[UNINSTALL] no row for %s", shopDomain);
    return ok();
  }

  if (new Date(row.installedAt) > triggered) {
    console.log("[UNINSTALL] stale webhook — installedAt(%s) > triggered(%s), skip",
      row.installedAt, triggered.toISOString());
    return ok();
  }

  const { error: updErr } = await supabase
    .from("Shop")
    .update({
      isActive: false,
      accessToken: null,
      pixelId: null,
      uninstalledAt: triggered.toISOString(),
    })
    .eq("id", row.id);

  if (updErr) console.error("[UNINSTALL] UPDATE failed", updErr.message);
  else console.log("[UNINSTALL] deactivated id=%s", row.id);

  return ok();
}
```

#### 1.6 `supabase/create-shop.sql`

Overwrite with the SQL in the "Supabase DB posture" section above. Commit the file. Operator (Sumeet) runs it in Supabase.

#### 1.7 `app/page.tsx`

Leave as-is for now. Root page still forwards to `/couponmaxx`. Adding an "install redirect" here is Phase 4 work.

### Phase 1 tests

**Pre-test operator step:** Sumeet runs the Supabase SQL from the "Supabase DB posture" section. Then:

```sql
DELETE FROM "Shop" WHERE "shopDomain" = '20aprtest.myshopify.com';
```

**Test 1.1 — Install**

Deploy `rebuild-minimal` to a Vercel preview (do NOT switch production yet). Hit:
```
https://<preview-url>/api/auth/begin?shop=20aprtest.myshopify.com
```

But — callback goes to production `couponmaxx.vercel.app/api/auth/callback` per toml. For Phase 1 testing we must either:
- Temporarily switch Couponmaxx Vercel production to `rebuild-minimal`, OR
- Override `SHOPIFY_APP_URL` env var on preview to point at the preview URL AND update `shopify.app.toml` redirect_urls temporarily

Recommended: switch production to `rebuild-minimal` now. Keep `couponmaxx-submission` branch intact; we can flip back via Vercel UI if needed. (The contract URL is `couponmaxx.vercel.app` regardless of branch.)

Watch Vercel logs. Expected:
```
[auth/begin] shop: 20aprtest.myshopify.com
[AUTH] ====== CALLBACK START ======
[AUTH] STEP 1 HMAC OK
[AUTH] STEP 2 TOKEN OK
[AUTH] STEP 3 SESSION OK
[shop] createShop shopDomain=20aprtest.myshopify.com
[shop] createShop id=<uuid> prevPixel=null
[AUTH] STEP 4 SHOP OK id=<uuid> prevPixel=null
[AUTH] STEP 5 REDIRECT https://admin.shopify.com/store/20aprtest/apps/ef34a3eb07ec4333b42d63385823433b
```

Query:
```sql
SELECT id, "shopDomain", "isActive", "accessToken" IS NOT NULL AS has_token, "installedAt", "uninstalledAt"
FROM "Shop" WHERE "shopDomain" = '20aprtest.myshopify.com';
```
Expect: 1 row, `isActive=true`, `has_token=true`, `uninstalledAt=NULL`. Capture the `id` as `ID_1`.

**Test 1.2 — Uninstall**

Shopify admin → 20aprtest.myshopify.com → Apps → CouponMaxx → Uninstall.

Expected logs:
```
[UNINSTALL] ====== WEBHOOK ======
[UNINSTALL] shop=20aprtest.myshopify.com triggered=<iso>
[UNINSTALL] deactivated id=<uuid>
```

Query same SQL. Expect: `isActive=false`, `has_token=false`, `uninstalledAt` set.

**Test 1.3 — Reinstall (critical)**

Hit `/api/auth/begin?shop=20aprtest.myshopify.com` again. Walk through OAuth grant.

Expected: `[shop] createShop id=<same as ID_1> prevPixel=null`. Id MUST match Test 1.1 id.

Query: `isActive=true`, `has_token=true`, `uninstalledAt=NULL`, id unchanged.

**Test 1.4 — Race guard**

Install, uninstall, reinstall within 10 seconds. Wait 2–5 minutes for stale uninstall webhook to arrive.

Expected log: `[UNINSTALL] stale webhook — installedAt(...) > triggered(...), skip`

Shop row still `isActive=true`.

### Phase 1 commit

```
phase 1: auth + shop lifecycle — stable id, race-safe uninstall, single begin route
```

### Phase 1 rollback

If tests fail: Vercel → Couponmaxx project → Deployments → promote previous `couponmaxx-submission` deploy. Debug on `rebuild-minimal` without production impact.

---

## Phase 2 — Pixel registration + theme extension + ingest

**Goal:** Web pixel registers on install, theme extension fires storefront events, ingest endpoints persist to DB.

### Files to REWRITE

#### 2.1 `lib/pixel.ts`

Replace entire file with:

```ts
import { Session } from "@shopify/shopify-api";
import { shopify } from "./shopify";

const WEB_PIXEL_CREATE = `
  mutation webPixelCreate($webPixel: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixel) {
      userErrors { field message }
      webPixel { id }
    }
  }
`;

const WEB_PIXEL_DELETE = `
  mutation webPixelDelete($id: ID!) {
    webPixelDelete(id: $id) {
      userErrors { field message }
      deletedWebPixelId
    }
  }
`;

function makeSession(shop: string, accessToken: string): Session {
  const s = new Session({ id: `offline_${shop}`, shop, state: "offline", isOnline: false });
  s.accessToken = accessToken;
  return s;
}

export async function registerAppPixel(shop: string, accessToken: string): Promise<string | null> {
  console.log("[pixel] registerAppPixel shop=%s", shop);
  try {
    const client = new shopify.clients.Graphql({ session: makeSession(shop, accessToken) });
    const resp = await client.request(WEB_PIXEL_CREATE, {
      variables: { webPixel: { settings: JSON.stringify({ shopDomain: shop }) } },
    });
    const userErrors = (resp.data as any)?.webPixelCreate?.userErrors ?? [];
    const id = (resp.data as any)?.webPixelCreate?.webPixel?.id as string | undefined;

    if (id) {
      console.log("[pixel] registerAppPixel created id=%s", id);
      return id;
    }
    // "already been set" can occur on reinstall if deregister missed
    if (userErrors.some((e: any) => e.message?.includes("already been set"))) {
      console.warn("[pixel] registerAppPixel: pixel already set; returning null (live on storefront)");
      return null;
    }
    console.error("[pixel] registerAppPixel errors", userErrors);
    return null;
  } catch (err: any) {
    console.error("[pixel] registerAppPixel threw", err?.message);
    return null;
  }
}

export async function deregisterAppPixel(shop: string, accessToken: string, pixelId: string): Promise<void> {
  console.log("[pixel] deregisterAppPixel pixelId=%s", pixelId);
  try {
    const client = new shopify.clients.Graphql({ session: makeSession(shop, accessToken) });
    const resp = await client.request(WEB_PIXEL_DELETE, { variables: { id: pixelId } });
    const userErrors = (resp.data as any)?.webPixelDelete?.userErrors ?? [];
    if (userErrors.length) console.warn("[pixel] deregisterAppPixel userErrors", userErrors);
    else console.log("[pixel] deregisterAppPixel deleted %s", pixelId);
  } catch (err: any) {
    console.warn("[pixel] deregisterAppPixel non-fatal", err?.message);
  }
}
```

Remove any export of `deletePixel`, `ensurePixel` — callers were deleted in Phase 0.

#### 2.2 `extensions/cart-monitor/`

Do not modify. Copy as-is from current branch — already committed there. Just verify `blocks/cart-monitor.liquid` has `data-ingest-url` pointing to `{{ block.settings.app_url }}/api/cart/ingest` and `data-ping-url` to `.../api/session/ping`.

#### 2.3 `extensions/checkout-monitor/`

Do not modify. Web pixel extension — built from `extensions/checkout-monitor/src/index.js`. Verify it posts to `/api/pixel/ingest`.

#### 2.4 `app/api/cart/ingest/route.ts`

Keep existing if present + working. If absent or broken, rewrite minimal:

```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getShop } from "@/lib/shop";
import { sanitizeCartEvent } from "@/lib/sanitize";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.shopDomain || !body?.sessionId || !body?.eventType) {
    return NextResponse.json({ ok: false, reason: "missing fields" }, { status: 400, headers: CORS });
  }

  const shop = await getShop(body.shopDomain);
  if (!shop) {
    return NextResponse.json({ ok: false, reason: "no active shop" }, { status: 400, headers: CORS });
  }

  const row = sanitizeCartEvent({
    shopId: shop.id,
    sessionId: body.sessionId,
    cartToken: body.cartToken ?? "",
    eventType: body.eventType,
    cartValue: body.cartValue ?? null,
    cartItemCount: body.cartItemCount ?? null,
    lineItems: body.lineItems ?? null,
    couponCode: body.couponCode ?? null,
    couponSuccess: body.couponSuccess ?? null,
    couponFailReason: body.couponFailReason ?? null,
    couponRecovered: body.couponRecovered ?? null,
    discountAmount: body.discountAmount ?? null,
    pageUrl: body.pageUrl ?? null,
    device: body.device ?? null,
    country: body.country ?? null,
    utmSource: body.utmSource ?? null,
    utmMedium: body.utmMedium ?? null,
    utmCampaign: body.utmCampaign ?? null,
    utmReferrer: body.utmReferrer ?? null,
    occurredAt: body.occurredAt ? new Date(body.occurredAt).toISOString() : new Date().toISOString(),
  });

  const { error } = await supabase.from("CartEvent").insert({ id: crypto.randomUUID(), ...row });
  if (error) {
    console.error("[cart/ingest] insert failed", error.message);
    return NextResponse.json({ ok: false }, { status: 500, headers: CORS });
  }
  console.log("[cart/ingest] ok shop=%s event=%s", body.shopDomain, body.eventType);
  return NextResponse.json({ ok: true }, { headers: CORS });
}
```

#### 2.5 `app/api/pixel/ingest/route.ts`

Same pattern — minimal insert into `CheckoutEvent`. Keep existing if it's already minimal; otherwise rewrite to same shape.

#### 2.6 `app/api/session/ping/route.ts`

Delete. We are not using `SessionPing` anymore. Remove `data-ping-url` from `cart-monitor.liquid` OR keep the endpoint as a 204 no-op to avoid breaking extension.

Preferred: keep as 204 no-op to maintain extension compatibility.

```ts
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
export async function POST() { return new NextResponse(null, { status: 204 }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204 }); }
```

### Phase 2 tests

Deploy `rebuild-minimal`. Install on 20aprtest (if uninstalled from Phase 1 testing). Verify:

- `[AUTH] BG: pixel registered <gid>` in logs
- `SELECT pixelId FROM "Shop" WHERE shopDomain='20aprtest.myshopify.com'` → non-null
- Shopify admin → Settings → Customer events → CouponMaxx pixel listed + enabled

Then on storefront:
1. Add product to cart
2. Open cart page
3. Expected: `[cart/ingest] ok shop=... event=cart_item_added` (and other events)
4. Proceed to checkout
5. Expected: `[pixel/ingest]` events for `checkout_started`, `checkout_contact_info_submitted`, etc.

Query:
```sql
SELECT "eventType", count(*) FROM "CartEvent" WHERE "shopId"=(SELECT id FROM "Shop" WHERE "shopDomain"='20aprtest.myshopify.com') GROUP BY 1;
SELECT "eventType", count(*) FROM "CheckoutEvent" WHERE "shopId"=(SELECT id FROM "Shop" WHERE "shopDomain"='20aprtest.myshopify.com') GROUP BY 1;
```

### Phase 2 commit
```
phase 2: pixel + theme extension + ingest wired end-to-end
```

---

## Phase 3 — Checkout claim button

**Goal:** Checkout UI extension claim button works with `/api/couponmaxx/cx` endpoint returning discount code.

### Files

#### 3.1 `extensions/checkout-recovery/`
Do not modify. Proven code already in repo.

#### 3.2 `app/api/couponmaxx/cx/route.ts`
Keep existing. Review for correctness:
- Validates recovery code format
- Looks up RecoveryEvent (if kept) or creates ad-hoc discount
- Returns discount code to extension

If `RecoveryEvent` table was deleted from Prisma schema, rewrite to not depend on it — create Shopify discount inline via Admin API + return code.

Minimal shape:
```ts
// POST /api/couponmaxx/cx
// body: { shopDomain, sessionId, cartToken? }
// response: { code: string, amount: number, expiresAt: string }
```

Detailed contract defined jointly with extension expectations — read `extensions/checkout-recovery/src/` to confirm request/response shape before rewriting.

#### 3.3 `app/api/couponmaxx/recovery/decide/route.ts`
Keep if used by extension. Inspect and preserve minimally.

### Phase 3 tests
1. Install on 20aprtest
2. Add to cart → checkout
3. Apply invalid coupon → failure triggers claim offer
4. Click claim button → expect API response with discount code
5. Apply code → checkout total reduced

### Phase 3 commit
```
phase 3: checkout claim button end-to-end
```

---

## Phase 4 — Admin shell + diagnostics + billing + GDPR

**Goal:** One embedded admin screen + privacy webhooks verified + billing flow.

### Files

#### 4.1 `app/(embedded)/couponmaxx/layout.tsx`
Strip to minimum — App Bridge + frame provider + single child route. No nav, no sidebar. Use `@shopify/polaris` if already installed, else plain HTML.

#### 4.2 `app/(embedded)/couponmaxx/diagnostics/page.tsx`
Rewrite as THE admin screen. Status cards: app installed, pixel registered, last cart event, last checkout event, webhook registration status, billing state.

Minimal — no charts, no tables beyond those status cards. Reads from `/api/couponmaxx/health`.

#### 4.3 `app/(embedded)/couponmaxx/page.tsx` (new)
Redirect to `/couponmaxx/diagnostics`.

#### 4.4 `app/api/couponmaxx/health/route.ts`
Trim existing handler. Return:
```json
{
  "shopDomain": "...",
  "shopState": { "isActive": true, "hasToken": true, "hasPixelId": true, "installedAt": "...", "uninstalledAt": null },
  "lastCartEvent": "<iso|null>",
  "lastCheckoutEvent": "<iso|null>",
  "cartEventsToday": <n>,
  "checkoutEventsToday": <n>,
  "billingPlan": "free|pro|...",
  "subscriptionStatus": "active|..."
}
```
Drop theme detection, notification settings, recovery analytics, slack config — everything that required deleted tables.

#### 4.5 `app/api/billing/create/route.ts` + `app/api/billing/callback/route.ts`
Review existing. If proven working: keep. If broken: stub to "always approve free plan" for submission, rebuild properly post-launch.

#### 4.6 `app/api/webhooks/customers/data-request/route.ts`
Keep existing (verified minimal + correct).

#### 4.7 `app/api/webhooks/customers/redact/route.ts`
Keep existing. Log payload, return 200.

#### 4.8 `app/api/webhooks/shop/redact/route.ts`
Keep existing but trim to minimal: HMAC verify, log payload, return 200. Real deletion logic (DELETE FROM CartEvent etc.) kept — is already correct in the current file.

#### 4.9 `app/api/webhooks/app-subscriptions-update/route.ts`
Keep if billing is in scope.

### Phase 4 tests

- Diagnostics page loads in embedded admin, all cards populated, no 400s
- Send test GDPR webhooks via Partners dashboard → verify 200 + HMAC-accepted logs
- Billing: install on a clean store → expect billing approval redirect → approve → land on diagnostics

### Phase 4 commit
```
phase 4: minimal admin shell + diagnostics + GDPR webhooks verified
```

---

## Phase 5 — End-to-end + cleanup + submission

**Goal:** Full flow validated on a clean dev store. Ready to submit.

### 5.1 Operator: uninstall app from stale dev stores
- `testingstoresumeet.myshopify.com` → uninstall
- Any other dev store with CouponMaxx installed → uninstall
- Confirms: 60s phantom pings stop

### 5.2 Fresh dev store test
New dev store `submissionteststore.myshopify.com` (or whatever Sumeet creates). Run full flow:
1. `/api/auth/begin?shop=<store>` → OAuth grant
2. Billing approval
3. Land on `/couponmaxx/diagnostics`
4. Storefront: add to cart, checkout started
5. Apply invalid coupon → claim button appears
6. Claim → discount applied
7. Uninstall from Shopify admin
8. Verify `isActive=false`
9. Reinstall → same Shop id, all child data intact on dashboard

### 5.3 Vercel production
Confirm `couponmaxx` Vercel project is tracking `rebuild-minimal` as production branch. Domain `couponmaxx.vercel.app` resolves to latest deploy.

### 5.4 Submit
Partners dashboard → resubmit app for review. Submission metadata unchanged.

### 5.5 Merge
After Shopify approval:
```
git checkout couponmaxx-submission
git merge rebuild-minimal
git push
```

---

## Global guardrails (Sonnet: read every phase)

- **No scope creep.** If you're tempted to add a file/feature not listed in this plan, STOP and ask.
- **No feature-flags, no abstractions for "future"** code.
- **Keep logs heavy** on every new file — `[AUTH]`, `[UNINSTALL]`, `[pixel]`, `[cart/ingest]`, `[pixel/ingest]`, `[shop]`.
- **Do not touch** `extensions/*` directories other than copying.
- **Do not touch** `shopify.app.toml`, `shopify.app.checkoutmaxx.toml`, scopes, extension handles, client_id.
- **Do not** run `prisma migrate`. Only `prisma generate`.
- **Do not** DROP any Supabase table.
- **Do not** commit `.env` files, secrets, or local config.
- **Run `npx tsc --noEmit`** before every commit. Zero errors required.
- **Read files before editing** — Edit tool will error otherwise.

## Files that don't exist yet but might be needed (Sonnet: ask before creating)

- Any new table in Prisma schema beyond what's listed
- Any new API route not listed above
- Any new lib file
- Any new config file

If a step in this plan references a file that turns out to be missing from the current branch, stop and report the gap rather than inventing.

## Environment variables expected in Couponmaxx Vercel project

Confirm present before Phase 1 deploy:
- `SHOPIFY_API_KEY=ef34a3eb07ec4333b42d63385823433b`
- `SHOPIFY_API_SECRET=<secret>`
- `SHOPIFY_APP_URL=https://couponmaxx.vercel.app`
- `DATABASE_URL=<supabase pooled>`
- `DIRECT_URL=<supabase direct>`
- `SUPABASE_URL=<url>`
- `SUPABASE_SERVICE_ROLE_KEY=<key>`

If any missing, add via Vercel dashboard before Phase 1 deploy.

## Outside submission scope (explicitly v1.1 work)

- Analytics dashboards, funnel charts, KPI cards
- Notifications inbox
- Slack / Klaviyo integrations
- Email alerts, compute baselines, cron jobs
- Multi-tab admin UI
- Recovery stats / per-coupon analytics
- Real `shop/redact` deletion logic (handler exists, returns 200; actual deletes can ship in v1.1 unless already correct)
- Customer-facing onboarding pages

## Verification dashboard (what "done" looks like)

- `git log --oneline rebuild-minimal` shows 5–7 phase commits
- `npx tsc --noEmit` zero errors
- Source files: ~50 (down from 200+)
- `couponmaxx.vercel.app` → fresh install works end-to-end
- Reinstall preserves Shop id + all child data
- Stale uninstall webhook does not deactivate fresh install
- Storefront events flow to DB
- Claim button applies discount
- Diagnostics page green
- GDPR webhooks HMAC-verify + 200
- Submission metadata unchanged → no resubmission needed
