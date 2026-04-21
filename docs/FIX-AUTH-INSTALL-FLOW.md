# Fix Auth + Install/Reinstall Flow — Sonnet Execution Prompt

> **You are Sonnet.** This is your task prompt. Execute end-to-end in the `couponmaxx-submission` branch of `/Users/sumeetkarwa/Documents/Code/checkout-maxx`. Do not deviate. Ask only if a step is genuinely ambiguous.

---

## Why this exists

Current `couponmaxx-submission` (commit `9334fca`) rewrote Shop-row lifecycle to a Supabase RPC that does `UPDATE isActive=false + INSERT new UUID` on every install. This creates three blockers for Shopify submission:

1. **Dashboard empty after reinstall.** Child tables (`CartEvent`, `CheckoutEvent`, `RecoveryEvent`, `MerchantRecoverySettings`, `SessionPing`, etc.) FK on `Shop.id`. New install = new id → all prior data orphaned on the now-inactive row → dashboard queries return zero. Shopify reviewer runs install → use → uninstall → reinstall → sees empty app → flags.

2. **Install/uninstall race.** Quick uninstall-then-reinstall leaves the `app/uninstalled` webhook queued by Shopify. Webhook arrives ~1-2 minutes post-reinstall → handler sets `isActive=false` on the fresh row → app permanently "inactive" despite being installed. Confirmed historical bug in this codebase.

3. **OAuth begin fragmentation.** Two begin routes exist:
   - `app/api/auth/route.ts` — Shopify SDK `shopify.auth.begin` (sets SDK state cookie)
   - `app/api/auth/begin/route.ts` — manual redirect (sets cookie `shopify_oauth_state`)
   
   `app/api/auth/callback/route.ts:28` validates only `shopify_oauth_state`. Any path through `/api/auth` → state cookie name mismatch → 403 `State validation failed`. Directly observed: user hit `/api/auth?shop=20aprtest.myshopify.com` and got `[AUTH] STATE MISMATCH — possible CSRF attack`.

### Goal

Stable `Shop.id` across reinstalls, correct pixel deregister/register lifecycle, race-safe uninstall webhook, single OAuth begin path. Scope excludes feature work (checkout claim button, etc.).

### Non-negotiable constraints

- **Do not** touch unrelated submission-scope work (`bf315d0` admin trim, `5f760e3` diagnostics, checkout-recovery extension, existing docs).
- **Do not** run `prisma migrate` — DB has a unique index applied via an untracked SQL file already. Keep Prisma schema in sync for type safety only.
- **Do not** introduce new abstractions or refactors beyond what this doc specifies.
- **Do** add heavy console logs on all new/changed paths (project convention — see `.claude/memory`).
- **Do** verify every code change by reading the file back before moving on.

---

## Architecture target

```
Shop
  id              UUID PK           -- stable across reinstalls
  shopDomain      TEXT UNIQUE
  accessToken     TEXT              -- overwritten on reinstall, nulled on uninstall
  pixelId         TEXT NULL         -- reset to null on reinstall, BG writes new
  isActive        BOOLEAN
  installedAt     TIMESTAMPTZ       -- refreshed on reinstall
  uninstalledAt   TIMESTAMPTZ NULL  -- set by uninstall webhook, cleared on reinstall
  (+ existing fields untouched)
```

**Install (OAuth callback):** `INSERT ... ON CONFLICT (shopDomain) DO UPDATE` returns stable id + previous `pixelId`. Background: deregister previous pixel, register new, write new `pixelId`.

**Uninstall webhook:** compare `X-Shopify-Triggered-At` vs row's `installedAt`. Skip if triggered-at is older than current install (stale webhook for a dead install). Else mark inactive, null `accessToken` + `pixelId`, stamp `uninstalledAt`. Always respond 200.

**shop/redact webhook:** out of scope — just confirm existing handler HMAC-verifies + returns 200. Real deletion logic ships post-launch.

---

## Execution — do these steps in order

### Step 0 — Pre-flight

Read current state of each file before editing:
- `prisma/schema.prisma` (lines 30–60)
- `supabase/create-shop.sql`
- `lib/shop.ts`
- `lib/pixel.ts`
- `app/api/auth/callback/route.ts`
- `app/api/auth/route.ts`
- `app/api/auth/begin/route.ts`
- `app/api/webhooks/app-uninstalled/route.ts`

Confirm each exists and matches the shapes this doc references. If any file has drifted from expectations, stop and ask.

### Step 1 — Prisma schema

File: `prisma/schema.prisma`, `Shop` model.

Change:
```
shopDomain String
```
to:
```
shopDomain String @unique
```

Add new optional column (anywhere sensible in the model):
```
uninstalledAt DateTime?
```

Do not run `prisma migrate`. DB already has the unique index (`supabase/shop-domain-unique-index.sql`). The `uninstalledAt` column will be added manually in Step 2.

Regenerate Prisma client:
```
npx prisma generate
```

### Step 2 — Replace `supabase/create-shop.sql`

Overwrite the file with:

```sql
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
```

This must be applied in Supabase SQL editor by Sumeet (see final "Operator steps"). Commit the file.

### Step 3 — Update `lib/shop.ts`

Modify `createShop` to return `{ id, prevPixelId }`:

```ts
export async function createShop(
  shopDomain: string,
  accessToken: string
): Promise<{ id: string; prevPixelId: string | null }> {
  console.log("[shop] createShop shopDomain=%s", shopDomain);

  const { data, error } = await supabase
    .rpc("create_shop", { p_shop_domain: shopDomain, p_access_token: accessToken })
    .single();

  if (!error && data) {
    const id = (data as any).id as string;
    const prev = ((data as any).prev_pixel_id as string | null) ?? null;
    console.log("[shop] createShop id=%s prevPixel=%s", id, prev);
    return { id, prevPixelId: prev };
  }

  throw new Error(
    `[shop] createShop failed shopDomain=${shopDomain}: ${error?.message ?? "unknown"}`
  );
}
```

Delete the old 23505 race branch — `ON CONFLICT` handles concurrency in-DB.

In `getShop`, after the existing `isActive` match block, add an `accessToken` guard:

```ts
if (!match.accessToken) {
  console.log("[shop] getShop: row exists but accessToken null (uninstalled) for %s", shopDomain);
  return null;
}
```

Keep `upgradeToken` as-is.

### Step 4 — Add `deregisterAppPixel` to `lib/pixel.ts`

Current file exports `ensurePixel` + `deletePixel`. Rename nothing; add a clearly-named wrapper:

```ts
export async function deregisterAppPixel(
  shop: string,
  accessToken: string,
  pixelId: string
): Promise<void> {
  console.log("[pixel] deregisterAppPixel pixelId=%s", pixelId);
  try {
    await deletePixel(shop, accessToken, pixelId);
  } catch (err: any) {
    console.warn("[pixel] deregisterAppPixel non-fatal:", err?.message);
  }
}
```

(`deletePixel` already exists; this is a named wrapper that logs and swallows — pixel may already be gone after Shopify-side uninstall cleanup.)

### Step 5 — Update `app/api/auth/callback/route.ts`

At the top, add to the pixel import:
```ts
import { ensurePixel, deregisterAppPixel } from "@/lib/pixel";
```

In Step 4 (the `createShop` call), destructure the new return shape:

```ts
// Create shop row via atomic RPC (upsert semantics)
let shopId: string;
let prevPixelId: string | null = null;
try {
  const result = await createShop(shop, accessToken);
  shopId = result.id;
  prevPixelId = result.prevPixelId;
  console.log(`[AUTH] STEP 4 createShop OK (${Date.now() - t0}ms): id=${shopId} prevPixel=${prevPixelId}`);
} catch (err: any) {
  console.error("[AUTH] STEP 4 createShop FAILED:", err.message);
  return new Response(
    `Shop provisioning failed. Please try reinstalling the app.\n${err.message}`,
    { status: 500 }
  );
}
```

In the `waitUntil(Promise.all([...]))` block, replace the pixel IIFE with:

```ts
(async () => {
  try {
    if (prevPixelId) {
      await deregisterAppPixel(shopCapture, accessTokenCapture, prevPixelId);
      console.log("[AUTH] BG: old pixel deregistered pixelId=%s", prevPixelId);
    }
    const pid = await ensurePixel(shopCapture, accessTokenCapture);
    if (pid) {
      const { error } = await supabase
        .from("Shop")
        .update({ pixelId: pid })
        .eq("id", shopIdCapture);
      if (error) console.error("[AUTH] BG: pixelId update failed:", error.message);
      else console.log("[AUTH] BG: pixel registered pixelId=%s", pid);
    } else {
      console.log("[AUTH] BG: ensurePixel → null; pixel may be live without stored id");
    }
  } catch (err: any) {
    console.error("[AUTH] BG: pixel block error:", err?.message);
  }
})(),
```

Keep the webhook-registration IIFE as-is.

Capture variables for BG closure near the existing `shopIdCapture` / `accessTokenCapture` / `shopCapture`: add `prevPixelId` capture — no new variable needed since `prevPixelId` is already in scope.

### Step 6 — Delete `app/api/auth/route.ts`

Dead code. SDK-based begin route with cookie-name mismatch against manual callback. Single canonical begin is `/api/auth/begin`.

```
rm app/api/auth/route.ts
```

Also grep the repo for any lingering references to `/api/auth?` (not `/api/auth/begin?` or `/api/auth/callback?`) and update them to `/api/auth/begin`. Likely candidates: docs, install instructions, any UI text.

### Step 7 — Add timestamp guard to `app/api/webhooks/app-uninstalled/route.ts`

Read current file. Keep the HMAC verification, shop-domain parsing, and `return 200` convention intact. Inside the handler, after shop domain is extracted and HMAC verified, replace the existing row-deactivation block with:

```ts
const triggeredAtHeader = req.headers.get("x-shopify-triggered-at");
const triggered = triggeredAtHeader ? new Date(triggeredAtHeader) : new Date();
console.log("[uninstall] shopDomain=%s triggered=%s", shopDomain, triggered.toISOString());

const { data: row, error: selErr } = await supabase
  .from("Shop")
  .select("id, installedAt")
  .eq("shopDomain", shopDomain)
  .maybeSingle();

if (selErr) {
  console.error("[uninstall] SELECT failed:", selErr.message);
  return new NextResponse(null, { status: 200 });
}
if (!row) {
  console.log("[uninstall] no row for %s — nothing to do", shopDomain);
  return new NextResponse(null, { status: 200 });
}
if (new Date(row.installedAt) > triggered) {
  console.log("[uninstall] stale webhook — installedAt > triggered, skip. installedAt=%s triggered=%s",
    row.installedAt, triggered.toISOString());
  return new NextResponse(null, { status: 200 });
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

if (updErr) console.error("[uninstall] UPDATE failed:", updErr.message);
else console.log("[uninstall] shop deactivated id=%s", row.id);

return new NextResponse(null, { status: 200 });
```

Always return 200 so Shopify stops retrying.

### Step 8 — Verify no other code creates Shop rows

Grep:
```
grep -rn "from(\"Shop\").*insert\|\\.shop\\.create\\b\|rpc(.create_shop" --include="*.ts" --include="*.tsx" .
```

Only `lib/shop.ts` (via RPC) should appear. Any other insert paths → stop and flag; the AUTH-AND-PIXEL-V3 contract says callback is the only creator.

### Step 9 — Typecheck + build

```
npx tsc --noEmit
```

Zero errors required before commit.

### Step 10 — Commit

One commit only:

```
fix(auth): stable Shop.id via upsert + race-safe uninstall + single OAuth begin

- RPC create_shop rewritten to INSERT..ON CONFLICT → stable id across reinstalls
- callback captures previous pixelId, deregisters in BG before registering new
- app/uninstalled webhook adds X-Shopify-Triggered-At guard (kills install/uninstall race)
- deleted app/api/auth/route.ts (dead SDK begin route causing state mismatch)
- getShop returns null when accessToken is null (post-uninstall state)
- prisma schema: shopDomain @unique + uninstalledAt column
```

Push to `couponmaxx-submission`.

---

## Operator steps (Sumeet, not Sonnet)

Run in order:

1. **Uninstall app** from `testingstoresumeet.myshopify.com` via Shopify admin → Apps → CouponMaxx → Uninstall. Stops the 60s phantom pings. Repeat for any other dev stores where CouponMaxx is still listed.

2. **Apply DB changes** in Supabase SQL editor:
   ```sql
   -- a) Add the uninstalledAt column
   ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "uninstalledAt" TIMESTAMPTZ NULL;

   -- b) Confirm unique index exists
   SELECT indexname FROM pg_indexes WHERE tablename = 'Shop' AND indexdef ILIKE '%shopDomain%unique%';
   -- if empty, run supabase/shop-domain-unique-index.sql first

   -- c) Apply the new create_shop function
   -- paste supabase/create-shop.sql contents, run

   -- d) Verify
   SELECT routine_name FROM information_schema.routines WHERE routine_name = 'create_shop';
   ```

3. **Clean stale Shop rows** if they have duplicates:
   ```sql
   SELECT "shopDomain", count(*) FROM "Shop" GROUP BY 1 HAVING count(*) > 1;
   ```
   If any shopDomain has > 1 row, keep newest active, delete others. Child data on deleted rows is already orphaned — leave or repoint manually.

4. **Install on fresh dev store** by opening:
   ```
   https://couponmaxx.vercel.app/api/auth/begin?shop=20aprtest.myshopify.com
   ```
   Watch Vercel logs — expect the full `[AUTH] STEP 1..5` chain.

---

## Verification

### Install

Expected Vercel logs on a fresh `20aprtest.myshopify.com` install:
```
[auth/begin] shop: 20aprtest.myshopify.com
[AUTH] ====== CALLBACK START ======
[AUTH] STEP 1 HMAC OK
[AUTH] STEP 2 TOKEN OK
[AUTH] STEP 3 SESSION OK
[shop] createShop shopDomain=20aprtest.myshopify.com
[shop] createShop id=<uuid> prevPixel=null
[AUTH] STEP 4 createShop OK
[AUTH] STEP 5 REDIRECTING
[AUTH] BG: pixel registered pixelId=<gid>
[AUTH] BG: webhooks registered
```

### Reinstall (the critical test)
1. Shopify admin → 20aprtest → Apps → CouponMaxx → Uninstall
2. Watch logs for `[uninstall] shop deactivated id=<uuid>`
3. Immediately reinstall via `/api/auth/begin?shop=20aprtest.myshopify.com`
4. Expect `[shop] createShop id=<SAME uuid> prevPixel=<old gid>` — id must match first install
5. Expect `[AUTH] BG: old pixel deregistered` then `[AUTH] BG: pixel registered pixelId=<new gid>`
6. Query:
   ```sql
   SELECT id, "shopDomain", "isActive", "accessToken" IS NOT NULL AS has_token,
          "pixelId", "installedAt", "uninstalledAt"
   FROM "Shop" WHERE "shopDomain" = '20aprtest.myshopify.com';
   ```
   One row. Same id as first install. `isActive=true`. `has_token=true`. `uninstalledAt=NULL`. Fresh `pixelId`.

### Race guard
1. Install, capture id.
2. Uninstall → immediately reinstall within 10s.
3. Wait ~2 minutes for the stale uninstall webhook to arrive.
4. Expect log `[uninstall] stale webhook — installedAt > triggered, skip`
5. Shop row remains `isActive=true`, accessToken not null.

### Diagnostics
Embedded app → Diagnostics page → all checks green, no HTTP 400.

### Pixel live
Storefront → add to cart → checkout → `[pixel/ingest]` event in Vercel logs. Shopify admin → Settings → Customer events → CouponMaxx pixel present.

---

## Out of scope

- Real deletion in `shop/redact` webhook handler (post-launch).
- `customers/redact`, `customers/data_request` real implementations (post-launch — must still HMAC-verify + 200).
- Checkout claim button work.
- Theme extension changes.
- Any dashboard UI work.

---

## If something is off

Stop and ask. Do not guess at architecture. Do not add new error-handling layers or fallbacks beyond what's specified. Do not create new files outside those listed. If a file has drifted from what this doc describes, surface the diff and pause.
