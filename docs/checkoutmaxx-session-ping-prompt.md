# CheckoutMaxx — Session Init Ping
> Paste this entire prompt into Claude Code from the repo root.
> Read SPEC.md and CHANGELOG.md before touching any file.
> This prompt is self-contained — every decision is pre-made. Do not infer, assume, or improvise.

---

## CONTEXT — READ FIRST

### What exists and must not be touched
- `extensions/cart-monitor/assets/cart-monitor.js` — theme extension JS, intercepts cart network calls
- `pixel/checkout-monitor.js` — Shopify Web Pixel, sandboxed, sendBeacon only
- `app/api/cart/ingest/route.ts` — receives cart beacons, writes to CartEvent via Supabase JS
- `app/api/pixel/ingest/route.ts` — receives checkout beacons, writes to CheckoutEvent via Supabase JS
- `lib/supabase.ts` — Supabase JS client (createClient with SUPABASE_URL + SERVICE_ROLE_KEY)
- `lib/ingest-log.ts` — fire-and-forget IngestLog writer used by both ingest endpoints
- `app/api/health/route.ts` — health check endpoint

### Current console log in cart-monitor.js
After the first successful `navigator.sendBeacon()` call, cart-monitor.js already logs:
```
[CheckoutMaxx] Active — session: <sessionId>
```
This fires once per page load. It is in the existing code. Do not remove it.

### What is NOT in the codebase yet
- `cart_session_started` event — does not exist
- `checkout_session_started` event — does not exist
- `SessionPing` table — does not exist
- Session init ping logic — does not exist

### Technology rules (never violate)
- Ingest endpoints use Supabase JS client only — never Prisma for writes
- All DB writes are fire-and-forget via waitUntil() or void — never block the response
- No third-party SDKs in Web Pixel — sendBeacon only, no imports
- No localStorage in cart-monitor.js — sessionStorage only
- IDs: crypto.randomUUID() on every insert — Prisma is not involved in writes
- cart-monitor.js must never throw uncaught errors — wrap everything in try/catch

---

## WHAT YOU ARE BUILDING

A guaranteed pipeline confirmation signal. One event fires at the start of
every cart session and every checkout session. If this event is in the DB,
the full pipeline (JS → sendBeacon → ingest endpoint → Supabase) is confirmed alive.
This is the single source of truth for "is the system working?"

### Two new events
1. `cart_session_started` — fired by cart-monitor.js on init
2. `checkout_session_started` — fired by pixel/checkout-monitor.js on init

### One new table
`SessionPing` — lightweight table, separate from CartEvent and CheckoutEvent.
Stores only session init events. Used by /api/health to confirm pipeline liveness.

---

## STEP 1 — CREATE SessionPing TABLE IN SUPABASE

Create a new file `supabase/sessionping-table.sql`:

```sql
CREATE TABLE IF NOT EXISTS "SessionPing" (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "sessionId" text NOT NULL,
  source text NOT NULL,        -- 'cart' or 'checkout'
  "shopDomain" text NOT NULL,
  country text,
  device text,
  "pageUrl" text,
  "occurredAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "SessionPing_shopDomain_occurredAt_idx"
  ON "SessionPing" ("shopDomain", "occurredAt" DESC);

CREATE INDEX IF NOT EXISTS "SessionPing_sessionId_idx"
  ON "SessionPing" ("sessionId");

CREATE INDEX IF NOT EXISTS "SessionPing_source_occurredAt_idx"
  ON "SessionPing" (source, "occurredAt" DESC);
```

Do NOT run this file. The developer will run it manually in Supabase SQL editor.
Print a reminder at the end of the session:
"Run supabase/sessionping-table.sql in Supabase SQL editor before deploying."

---

## STEP 2 — NEW INGEST ENDPOINT FOR SESSION PINGS

Create `app/api/session/ping/route.ts`:

```typescript
export const dynamic = 'force-dynamic';
import { type NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logIngest } from '@/lib/ingest-log';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  let body: {
    sessionId: string;
    source: 'cart' | 'checkout';
    shopDomain: string;
    country?: string;
    device?: string;
    pageUrl?: string;
    occurredAt: string;
  };

  try {
    const text = await req.text();
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: CORS });
  }

  const { sessionId, source, shopDomain, country, device, pageUrl, occurredAt } = body;

  if (!sessionId || !source || !shopDomain) {
    return NextResponse.json({ ok: false }, { status: 400, headers: CORS });
  }

  // Respond immediately — do not block
  const responsePromise = NextResponse.json({ ok: true }, { headers: CORS });

  void (async () => {
    const start = Date.now();
    try {
      const { error } = await supabase.from('SessionPing').insert({
        id: crypto.randomUUID(),
        sessionId,
        source,
        shopDomain,
        country: country ?? null,
        device: device ?? null,
        pageUrl: pageUrl ?? null,
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
      });
      await logIngest({
        endpoint: `session-ping-${source}`,
        shopDomain,
        eventType: `${source}_session_started`,
        success: !error,
        latencyMs: Date.now() - start,
        errorCode: error?.code ?? null,
        errorMessage: error?.message ?? null,
      });
    } catch (err: any) {
      await logIngest({
        endpoint: `session-ping-${source}`,
        shopDomain,
        eventType: `${source}_session_started`,
        success: false,
        latencyMs: Date.now() - start,
        errorCode: null,
        errorMessage: err?.message ?? 'unknown',
      });
    }
  })();

  return responsePromise;
}
```

---

## STEP 3 — UPDATE cart-monitor.js

Open `extensions/cart-monitor/assets/cart-monitor.js`.

Find the CONFIG block. Add one new field:
```javascript
pingUrl: script?.dataset?.pingUrl ?? null,
```

The full CONFIG block should now include `pingUrl` alongside `ingestUrl`, `shopDomain`, etc.

Find the liquid block at `extensions/cart-monitor/blocks/cart-monitor.liquid`.
Add `data-ping-url` attribute:
```liquid
<script
  src="{{ 'cart-monitor.js' | asset_url }}"
  data-shop="{{ shop.permanent_domain }}"
  data-ingest-url="https://checkoutmaxx-rt55.vercel.app/api/cart/ingest"
  data-ping-url="https://checkoutmaxx-rt55.vercel.app/api/session/ping"
  defer
></script>
```

Now find the initialization block in cart-monitor.js — this is where the script
sets up the fetch/XHR interceptors and assigns the session ID. It runs once on
page load.

Add the session init ping AFTER the session ID is assigned and AFTER the
existing console log. The console log currently says:
`[CheckoutMaxx] Active — session: <sessionId>`

Add the ping immediately after that log line:

```javascript
// Session init ping — fires once per page load
// Confirms: script loaded → sendBeacon working → ingest endpoint reachable → DB alive
if (CONFIG.pingUrl) {
  try {
    const pingPayload = JSON.stringify({
      sessionId: CONFIG.sessionId,
      source: 'cart',
      shopDomain: CONFIG.shopDomain,
      country: CONFIG.country ?? null,
      device: CONFIG.device ?? null,
      pageUrl: window.location.pathname,
      occurredAt: new Date().toISOString(),
    });
    const sent = navigator.sendBeacon(CONFIG.pingUrl, pingPayload);
    if (!sent) {
      // sendBeacon returns false if the queue is full — extremely rare
      // Log but do not throw
      console.warn('[CheckoutMaxx] Session ping queued but not confirmed sent');
    }
    // Do NOT move the existing console log — keep it where it already is
  } catch (e) {
    // Never let the ping crash the script
  }
}
```

IMPORTANT: Do not move or modify the existing console log line. The ping fires after it.

---

## STEP 4 — UPDATE pixel/checkout-monitor.js

Open `pixel/checkout-monitor.js`.

This is the Shopify Web Pixel. It runs in a sandbox. Rules:
- No imports
- sendBeacon only
- No access to DOM
- No sessionStorage — session ID comes from cart attributes

Find where the pixel already sends its first event (`checkout_started`).
The pixel receives `analytics.subscribe('checkout_started', ...)`.

Find where the pixel constructs the beacon payload and calls `sendBeacon`.

After the existing `checkout_started` sendBeacon call, add a second sendBeacon
to the session ping endpoint:

```javascript
// Session init ping — fires once on checkout_started
// Separate from the checkout event beacon — lightweight, goes to SessionPing table
try {
  const pingPayload = JSON.stringify({
    sessionId: sessionId,         // use the same sessionId already extracted
    source: 'checkout',
    shopDomain: shopDomain,       // use the same shopDomain already extracted
    country: country ?? null,     // use the same country already extracted
    device: deviceType ?? null,   // use the same deviceType already extracted
    pageUrl: '/checkout',
    occurredAt: new Date().toISOString(),
  });
  navigator.sendBeacon(
    'https://checkoutmaxx-rt55.vercel.app/api/session/ping',
    pingPayload
  );
} catch (e) {
  // Never let the ping crash the pixel
}
```

Read the existing pixel code carefully to find the correct variable names for
sessionId, shopDomain, country, and deviceType — they are already extracted
earlier in the checkout_started handler. Use those exact variable names.
Do not redeclare them.

Add a console log matching the cart monitor style:
```javascript
console.log('[CheckoutMaxx] Checkout active — session:', sessionId);
```
Place this after the ping sendBeacon call.

---

## STEP 5 — UPDATE /api/health TO USE SessionPing

Open `app/api/health/route.ts`.

Find where it checks last CartEvent age and last CheckoutEvent age.

Add a third check using SessionPing:

```typescript
// Check last session pings
const { data: lastCartPing } = await supabase
  .from('SessionPing')
  .select('occurredAt')
  .eq('source', 'cart')
  .order('occurredAt', { ascending: false })
  .limit(1)
  .single();

const { data: lastCheckoutPing } = await supabase
  .from('SessionPing')
  .select('occurredAt')
  .eq('source', 'checkout')
  .order('occurredAt', { ascending: false })
  .limit(1)
  .single();
```

Add these to the health response:
```typescript
lastCartSessionPing: lastCartPing?.occurredAt ?? null,
lastCheckoutSessionPing: lastCheckoutPing?.occurredAt ?? null,
```

The health endpoint's `status` field logic:
- `'ok'` — both cart and checkout pings within last 60 minutes
- `'degraded'` — one of them is stale (>60 min) but not both
- `'down'` — both stale OR Supabase unreachable

---

## STEP 6 — VERIFY TYPES

After all changes, run:
```bash
npx tsc --noEmit
```

Fix any TypeScript errors before committing. The build must be clean.

---

## STEP 7 — DEPLOY

```bash
npx shopify app deploy
git add -A && git commit -m "feat: session init ping — cart_session_started + checkout_session_started + SessionPing table + /api/session/ping endpoint" && git push
```

`npx shopify app deploy` is required because cart-monitor.js and
checkout-monitor.js (theme extension + web pixel) changed.
Vercel deploys automatically from the git push.

---

## SUCCESS CRITERIA

After deploy, the developer will:

### Test 1 — Cart session ping
1. Open drwater.store in incognito (no adblocker)
2. Open DevTools → Console
3. Verify this line appears: `[CheckoutMaxx] Active — session: cart_XXXXX`
4. In Supabase → SessionPing table, query:
```sql
SELECT * FROM "SessionPing"
WHERE source = 'cart'
ORDER BY "occurredAt" DESC
LIMIT 5;
```
Expected: row with correct sessionId, source='cart', country='IN' (or wherever you are)

### Test 2 — Checkout session ping
1. Add item to cart, click Checkout
2. Complete checkout OR just reach the checkout page (checkout_started fires on page load)
3. In Supabase → SessionPing table, query:
```sql
SELECT * FROM "SessionPing"
WHERE source = 'checkout'
ORDER BY "occurredAt" DESC
LIMIT 5;
```
Expected: row with source='checkout', matching sessionId from cart session

### Test 3 — Health endpoint confirms pings
1. Hit `https://checkoutmaxx-rt55.vercel.app/api/health`
2. Expected response includes:
```json
{
  "status": "ok",
  "lastCartSessionPing": "2026-03-14T...",
  "lastCheckoutSessionPing": "2026-03-14T..."
}
```

### Test 4 — IngestLog confirms pipeline
```sql
SELECT endpoint, "eventType", success, "latencyMs", "errorMessage"
FROM "IngestLog"
WHERE endpoint LIKE 'session-ping-%'
ORDER BY "occurredAt" DESC
LIMIT 10;
```
Expected: rows with success=true, latencyMs < 300, errorMessage=null

### Test 5 — Console log in checkout DevTools
On the checkout page, DevTools console should show:
`[CheckoutMaxx] Checkout active — session: cart_XXXXX`

### Test 6 — SessionId join between cart and checkout
```sql
SELECT
  cp.source,
  cp."sessionId",
  cp."occurredAt" as ping_time,
  cp.country
FROM "SessionPing" cp
WHERE cp."sessionId" IN (
  SELECT "sessionId" FROM "SessionPing" WHERE source = 'cart'
  INTERSECT
  SELECT "sessionId" FROM "SessionPing" WHERE source = 'checkout'
)
ORDER BY cp."occurredAt" DESC;
```
Expected: matching rows from both cart and checkout with the same sessionId.
This confirms the session ID carries correctly from storefront to checkout.

---

## WHAT NOT TO DO

- Do not modify CartEvent schema — SessionPing is a separate table
- Do not modify CheckoutEvent schema — same reason
- Do not add SessionPing writes to cart/ingest or pixel/ingest — they go to /api/session/ping only
- Do not use Prisma for SessionPing — Supabase JS only
- Do not make the ping synchronous — always fire-and-forget
- Do not catch errors and swallow them silently — log to IngestLog
- Do not change the existing console log in cart-monitor.js — only add the ping after it
- Do not add any imports to pixel/checkout-monitor.js — it is sandboxed
- Do not run supabase/sessionping-table.sql — that is the developer's job before deploy

---

## APPEND TO CHANGELOG.md BEFORE ENDING SESSION

Add this entry to CHANGELOG.md:

```markdown
## 2026-03-14: Session init ping — SessionPing table + /api/session/ping

**What changed:** Added guaranteed pipeline confirmation signal.
`cart_session_started` fires from cart-monitor.js on every page load init.
`checkout_session_started` fires from Web Pixel on checkout_started event.
Both write to new SessionPing table (not CartEvent or CheckoutEvent).

**Why:** No reliable way to confirm pipeline liveness without manually querying
the DB. SessionPing gives a guaranteed first event per session. /api/health
now uses SessionPing recency as primary liveness signal. IngestLog tracks
success/failure of every ping write.

**New endpoint:** /api/session/ping — receives both cart and checkout pings,
writes to SessionPing, logs to IngestLog.

**New table:** SessionPing — sessionId, source (cart|checkout), shopDomain,
country, device, pageUrl, occurredAt.

**Files changed:**
- supabase/sessionping-table.sql (NEW — run manually in Supabase SQL editor)
- app/api/session/ping/route.ts (NEW)
- extensions/cart-monitor/assets/cart-monitor.js (session ping after console log)
- extensions/cart-monitor/blocks/cart-monitor.liquid (data-ping-url attribute)
- pixel/checkout-monitor.js (checkout session ping + console log)
- app/api/health/route.ts (SessionPing checks added)
```
