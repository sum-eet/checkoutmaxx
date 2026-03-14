# CheckoutMaxx — Operational Playbook

> Written: 2026-03-13
> Purpose: How to operate this codebase day-to-day. Rules for Claude Code.
> Templates for SPEC.md and CHANGELOG.md. Testing protocols.
> Health monitoring pipeline. Deployment checklists.
> The system that ensures you never lose 19 hours of data again.
>
> This document goes into the repo root. Claude Code reads it at the start of every session.

---

## PART 1: THE NEVER-GO-DARK-AGAIN SYSTEM

The March 12 outage ran for 19 hours because nothing was watching the output. The endpoints returned 200, Vercel showed green, but zero rows were hitting the database. Every layer below is designed to catch a different class of silent failure. You need all of them.

### Layer 1 — Console confirmation in storefront JS

This is the cheapest, fastest signal. When you open DevTools on any store running CheckoutMaxx, you should see proof of life within 5 seconds of any cart interaction.

**What it does:**
After the cart monitor JS sends its first successful beacon, it logs one clean line to the browser console. This confirms: the theme extension loaded, the JS executed, the network interceptor is active, and the beacon was sent.

**What it should look like:**
```
[CheckoutMaxx] ✓ Active — session: cmx_a8f3k2x — beacon sent to /api/cart/ingest
```

**What it should NOT do:**
- Don't log on every event (noisy, pollutes console)
- Don't log before beacon confirmation (misleading)
- Don't expose shopId or any merchant data in the log

**When to check it:**
- After every Vercel deploy
- After every theme extension update
- After any Shopify theme change on the store
- When debugging "events stopped flowing"

**Failure meaning:**
If you open DevTools and add an item to cart and don't see this line, one of these is broken: the theme extension isn't active, the JS has an error, or the beacon URL is wrong. Check the Network tab for the beacon request to `/api/cart/ingest`.

### Layer 2 — IngestLog table (the system heartbeat)

This is the source of truth for "is the pipeline actually writing data?" It sits inside Supabase alongside your event tables.

**What goes in:**
Every single call to /api/cart/ingest and /api/pixel/ingest writes one row to IngestLog. Every call. Successes and failures. This is non-negotiable.

**Why not sample successes?**
At your current traffic (100-150 events/day), sampling is premature optimization. You're nowhere near write volume concerns. Log everything. When you hit 10,000 events/day, revisit and switch to logging all failures + every 50th success.

**The columns that matter:**

| Column | Why it matters |
|--------|---------------|
| success | The only boolean that matters. Filter on `success = false` to see problems. |
| latencyMs | Time from request start to DB write complete. If this drifts above 500ms, something is degrading. |
| errorMessage | The exact error string. This is what you paste into Claude Code when debugging. |
| endpoint | 'cart' or 'pixel'. Lets you see if one pipeline is healthy and the other is dead. |
| shopDomain | When you have multiple stores, this tells you if the problem is global or store-specific. |

**How to use it daily:**
Open Supabase dashboard → IngestLog table → sort by occurredAt DESC → look at the last 20 rows. If they're all success: true and latencyMs < 300, the system is healthy. If there are failures, read the errorMessage. This takes 10 seconds.

**The query you should bookmark:**
```sql
SELECT
  endpoint,
  success,
  COUNT(*) as count,
  AVG("latencyMs") as avg_latency,
  MAX("latencyMs") as max_latency,
  MAX("occurredAt") as last_event
FROM "IngestLog"
WHERE "occurredAt" > now() - interval '24 hours'
GROUP BY endpoint, success
ORDER BY endpoint, success;
```

This gives you a one-glance view: how many events per endpoint, success rate, latency, and when the last event came in. If `last_event` for either endpoint is more than 2 hours old during business hours, something might be wrong.

### Layer 3 — /api/health endpoint

This is the endpoint that external monitors ping. It doesn't just return 200 — it checks the actual data.

**What it checks:**
1. Can we reach Supabase? (Simple query to Shop table)
2. When was the last CartEvent written? (If > 30 minutes during store hours, flag degraded)
3. When was the last CheckoutEvent written? (If > 2 hours, flag degraded — checkouts are less frequent)
4. Are there recent IngestLog failures? (If > 5 failures in last hour, flag degraded)

**Response shape:**
```json
{
  "status": "ok | degraded | down",
  "checks": {
    "supabase": true,
    "lastCartEvent": "3 minutes ago",
    "lastCheckoutEvent": "47 minutes ago",
    "recentFailures": 0
  },
  "timestamp": "2026-03-13T18:30:00Z"
}
```

**Rules:**
- This endpoint MUST NOT be behind authentication. UptimeRobot needs to hit it unauthenticated.
- This endpoint MUST NOT expose sensitive data (no shopIds, no tokens, no event content).
- HTTP 200 when status is "ok" or "degraded". HTTP 503 when status is "down".
- The endpoint itself must respond in < 500ms. Use Promise.allSettled for the checks so one slow query doesn't block the others.

### Layer 4 — UptimeRobot (external watchdog)

UptimeRobot pings /api/health from outside your infrastructure. This catches the failure class that internal monitoring can't: "the entire app is unreachable."

**Three monitors to set up:**

Monitor 1 — Health endpoint:
- URL: `https://checkoutmaxx-rt55.vercel.app/api/health`
- Type: Keyword check for `"ok"`
- Interval: 5 minutes
- Alert: Email + Slack

Monitor 2 — Heartbeat for cron jobs:
- Type: Heartbeat
- Your alert engine cron calls UptimeRobot's heartbeat URL at the end of each run
- If the ping stops, UptimeRobot alerts you

Monitor 3 — Raw HTTP check on cart ingest:
- URL: `https://checkoutmaxx-rt55.vercel.app/api/cart/ingest`
- Type: HTTP(s) — just checking it responds (even 400 is fine, means the endpoint is alive)
- Interval: 5 minutes
- Alert: Email

**Why all three?**
Monitor 1 catches: DB unreachable, pipeline dead, recent failures spiking.
Monitor 2 catches: cron stopped running (Vercel cron misconfigured, CRON_SECRET wrong).
Monitor 3 catches: the specific ingest endpoint is down even if /api/health works.

### Layer 5 — Daily summary cron

A cron job that runs at midnight UTC. It sends you one email/Slack message per day with:

```
CheckoutMaxx Daily Summary — 2026-03-14
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Cart events today:        87
Checkout events today:    23
Failed ingests today:     0
Avg latency (cart):       142ms
Avg latency (pixel):      189ms
Session join rate:        84% (19/23 checkouts matched to cart sessions)
Alerts fired today:       1 (discount_failure_spike)

Status: ALL HEALTHY
```

**Why this matters:**
The other layers catch acute failures (things broke right now). The daily summary catches slow degradation (latency creeping up, join rate dropping, event counts declining). If cart events go from 100/day to 60/day to 30/day over a week, the health endpoint won't flag it — but the daily summary makes the trend obvious.

**The data this email computes:**
- COUNT of CartEvent and CheckoutEvent in last 24h
- COUNT of IngestLog where success = false in last 24h
- AVG of latencyMs from IngestLog in last 24h, split by endpoint
- Session join rate: what percentage of CheckoutEvents have a sessionId that matches at least one CartEvent sessionId
- COUNT of AlertLog entries in last 24h

---

## PART 2: SPEC.md TEMPLATE

Copy this into your repo root. Fill it in. Every Claude Code session starts by reading this file.

```markdown
# CheckoutMaxx — SPEC.md
> Last updated: [DATE]
> Rule: Never delete from this file. Only append. New sections go at the bottom.

---

## SYSTEM IDENTITY

CheckoutMaxx is a Shopify embedded app that captures every event in the
cart-to-order funnel and surfaces it to the merchant.

If the data pipeline stops working, the product has no value.

---

## COMPONENT CONTRACTS

### Cart Monitor JS → /api/cart/ingest

The cart monitor (extensions/cart-monitor/) sends beacons to /api/cart/ingest.

Payload contract:
- eventType: REQUIRED. One of: cart_item_added, cart_item_changed,
  cart_item_removed, cart_bulk_updated, cart_checkout_clicked,
  cart_page_hidden, cart_coupon_applied, cart_coupon_failed,
  cart_coupon_recovered, cart_coupon_removed
- shopDomain: REQUIRED. e.g. "drwater.myshopify.com"
- sessionId: REQUIRED. The _cmx_sid value from sessionStorage.
- cartToken: OPTIONAL but strongly desired. From /cart.js response.
- cartValue: In cents. 0 if unknown.
- lineItems: JSON array of {title, variant_id, quantity, price}. Null if unavailable.
- occurredAt: ISO timestamp from client. Server uses this, not its own clock.

If eventType or shopDomain is missing, the endpoint returns 400.
For any other missing field, the endpoint writes null (not default values).

### Web Pixel → /api/pixel/ingest

The web pixel (pixel/checkout-monitor.js) sends to /api/pixel/ingest.

Payload contract:
- eventType: REQUIRED. One of: checkout_started,
  checkout_contact_info_submitted, checkout_address_info_submitted,
  checkout_shipping_info_submitted, payment_info_submitted,
  checkout_completed
- shopDomain: REQUIRED.
- sessionId: REQUIRED. Read from cart attributes (_cmx_sid).
- All other fields: OPTIONAL. Extracted from Web Pixel event data.
- rawPayload: PII-sanitised JSON snapshot of the checkout event.

### Dashboard → API routes → Supabase

Dashboard tabs call these API routes:
- /api/cart/kpis → KPI cards (total events, conversion rate, AOV)
- /api/cart/sessions → Session list for Cart Activity tab
- /api/cart/session?id=X → Single session timeline
- /api/cart/coupons → Coupon analytics

All routes require authenticated Shopify session.
All routes read from Supabase via Supabase JS client.
All routes return JSON. No routes write data.

---

## DATA INVARIANTS

These must be true for every row in the database. If any invariant is violated,
it's a bug.

1. Every CartEvent has a non-null id (uuid).
2. Every CartEvent has a non-null shopId.
3. Every CartEvent has a non-null eventType.
4. Every CheckoutEvent has a non-null id (uuid).
5. Every CheckoutEvent has a non-null shopId.
6. Every CheckoutEvent has a non-null eventType.
7. No CartEvent or CheckoutEvent contains raw PII
   (email, phone, full name, IP address).
8. Ingest endpoints respond in < 200ms (DB writes happen async).
9. Every ingest attempt (success or failure) produces an IngestLog row.

---

## TECHNOLOGY RULES

1. Ingest endpoints (write-heavy): Supabase JS client only. Never Prisma.
2. Dashboard queries (read): Supabase JS client. Prisma only for migrations.
3. Schema changes: prisma migrate dev with DIRECT_URL.
4. IDs: crypto.randomUUID() for every insert. Never rely on DB-generated IDs.
5. Async writes: Use waitUntil() from @vercel/functions. Never void promises.
6. No persistent connections: Everything goes through HTTP/REST.
7. No new dependencies without answering: Does it work on Vercel serverless?

---

## STORE-SPECIFIC NOTES

### drwater.myshopify.com
- Uses Rebuy Smart Cart 2.0 — fires multiple /cart/update.js per interaction.
  Deduplication needed at query layer.
- Automatic discount HYDRATEFIRST appears in every /cart/update response
  with applicable: false. Must be filtered out — do not generate
  cart_coupon_failed events for automatic discounts.

---

## ARCHITECTURE DECISIONS (append-only log)

### 2026-03-13: Ingest endpoints migrated from Prisma to Supabase JS
Reason: Prisma TCP connections exhaust under Vercel serverless cold starts.
Supabase JS uses HTTP/REST, no connection pools, built for serverless.
See CHANGELOG.md for full decision trail.
```

---

## PART 3: CHANGELOG.md TEMPLATE

Copy this into your repo root. Every Claude Code session that changes anything appends an entry before the session ends. This is part of the definition of done.

```markdown
# CheckoutMaxx — CHANGELOG.md
> Decision-level log. Not git commits. Written for humans and AI who need
> to understand WHY something was done, not just WHAT changed.
>
> Format: Date → What changed → Why → What was tried → What was decided
>
> Rule: Every Claude Code session that modifies the codebase must append
> an entry here before the session ends. No exceptions.

---

## 2026-03-13: DB Connection Crisis — Migrated ingest to Supabase JS

**What broke:** After a Vercel redeploy, both ingest endpoints stopped writing
to the database. 19 hours of zero data. No alerts, no errors in the response
(endpoints returned 200 but writes silently failed).

**Root cause:** Prisma requires persistent TCP connections. Vercel serverless
creates fresh instances per request. Supabase free tier has ~15 concurrent
connection limit. After redeploy, all new Prisma connection pool attempts
were exhausted.

**What was tried (in order):**
1. Supabase pooler URL (port 6543) → "Can't reach server" (IPv6 issue)
2. Singleton Prisma client (globalThis) → No change (doesn't help serverless)
3. connection_limit=1 + sslmode params → Still timing out
4. Prisma Accelerate → Wrong DB host given during setup (.com vs .co)
5. Updated Accelerate host in console → API keys have tenant_id baked in, old key routes to old config
6. New Accelerate API key → Entire tenant was bound to wrong host
7. Supabase JS client → WORKED. HTTP/REST, no TCP, no pools.

**What was decided:**
- Ingest endpoints use Supabase JS exclusively (HTTP, not TCP)
- Prisma stays for migrations only (via DIRECT_URL to port 5432)
- Dashboard reads: migrate to Supabase JS as next priority
- IDs: crypto.randomUUID() in every insert (Prisma was generating cuid() client-side)
- Pattern: waitUntil() for async DB writes, respond immediately

**Files changed:**
- lib/supabase.ts (NEW)
- app/api/cart/ingest/route.ts (rewritten)
- app/api/pixel/ingest/route.ts (rewritten)
- prisma/schema.prisma (added directUrl)
- lib/alert-engine.ts, lib/cart-metrics.ts, lib/metrics.ts, scripts/check-funnel.ts (type fixes)

---

## [TEMPLATE — copy this for each new entry]

## YYYY-MM-DD: [Short title of what changed]

**What changed:**

**Why:**

**What was tried:**

**What was decided:**

**Files changed:**

**Impact on SPEC.md:** [Did any contract, invariant, or rule change? If yes, update SPEC.md too.]
```

---

## PART 4: CLAUDE CODE RULES

Print this on a wall. Every Claude Code session follows these rules. If Claude Code violates any of them, that's your signal to stop and correct course.

### Session Start Protocol

Every Claude Code session begins with this exact instruction:

```
Read SPEC.md and CHANGELOG.md first. Tell me what you understand about the
current state of the system. Then proceed with the task.
```

Do NOT skip this. Do NOT say "just do X quickly." The 5 minutes Claude Code spends reading context saves you 2 hours of debugging inconsistent code.

### The Four Questions Gate

Before Claude Code writes any new code that touches architecture (new endpoints, new tables, new dependencies, new patterns), it must answer these four questions in the chat:

1. **How many concurrent requests will this handle?**
   Wrong answer: "It should be fine." Right answer: "At 100 events/day across 50 shops, this is ~5,000 requests/day, peak of maybe 50/hour. The Supabase REST API handles this easily."

2. **What is the failure mode if the DB is unreachable?**
   Wrong answer: "It will throw an error." Right answer: "The endpoint responds 200 immediately via waitUntil(). The async write fails silently. The IngestLog table records the failure. The health endpoint will show degraded within 5 minutes."

3. **How will we know if this breaks in production?**
   Wrong answer: "We'll check the logs." Right answer: "IngestLog will show success: false with the error message. UptimeRobot will alert within 5 minutes if health degrades. The daily summary will show the drop in event count."

4. **Does this work on Vercel serverless?**
   Wrong answer: "Should work." Right answer: "Yes — it uses HTTP only, no persistent connections, no background processes, and uses waitUntil() for deferred work."

If Claude Code can't answer these clearly, the feature is not ready to be built.

### Code Style Rules for Claude Code

These prevent the codebase from drifting into inconsistency across sessions:

**Error handling pattern — use this everywhere:**
```typescript
const { data, error } = await supabase.from('TableName').select('*').eq('column', value)
if (error) {
  console.error('[module-name] Description:', error.message)
  // Handle: return error response, log to IngestLog, etc.
}
```

Never use try/catch around Supabase JS calls (it returns `{ data, error }`, it doesn't throw). Try/catch is for fetch(), JSON parsing, and unknown external calls.

**Logging format — prefix every log with the module name in brackets:**
```
[cart/ingest] Cart event written: cart_item_added for drwater.myshopify.com
[pixel/ingest] ERROR: Supabase insert failed — relation "CheckoutEvent" does not exist
[health] Status check: ok (cart: 2min ago, checkout: 34min ago)
[cron/alerts] Evaluating thresholds for 1 shops
[cron/summary] Daily summary sent for drwater.myshopify.com
```

This makes Vercel logs filterable. You can search `[cart/ingest]` to see only cart pipeline logs. You can search `ERROR` to see only failures.

**File naming — no exceptions:**
- API routes: `app/api/{domain}/{action}/route.ts`
- Library functions: `lib/{domain}.ts` (e.g., `lib/cart-metrics.ts`)
- Supabase client: `lib/supabase.ts` (singleton, never create a second one)
- Types: `lib/types.ts` or `lib/database.types.ts` (generated)

**Import style:**
```typescript
// External packages first
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Internal imports second
import { supabase } from '@/lib/supabase'
import type { CartEvent } from '@/lib/types'
```

### What Claude Code Must NEVER Do

1. **Never add a new npm dependency without stating why in the chat.** Every dependency is a liability. Claude Code must say: "I want to add X because Y, and it works on Vercel serverless because Z."

2. **Never create a second database client.** There is one Supabase client in `lib/supabase.ts`. All files import from there. If Claude Code creates `const supabase = createClient(...)` in any other file, that's a bug.

3. **Never use Prisma for writes.** All writes go through Supabase JS. If Claude Code imports prisma and calls `.create()` or `.update()`, stop it.

4. **Never expose SERVICE_ROLE_KEY in client-side code.** If Claude Code puts the Supabase client in a React component or any file that runs in the browser, that's a security bug.

5. **Never hardcode store-specific logic.** The HYDRATEFIRST filter should be a configuration, not an if-statement that says `if (code === 'HYDRATEFIRST')`. Other stores will have their own automatic discounts.

6. **Never skip the CHANGELOG entry.** At the end of every session, ask Claude Code: "Update CHANGELOG.md with what we did and why." If it says "I'll do it later," you do it yourself. The entry is part of the work being done.

7. **Never commit secrets, tokens, or keys.** If Claude Code generates a file with an actual API key, catch it before commit.

### Session End Protocol

Before closing a Claude Code session:

1. "Did we change any architecture? If yes, update SPEC.md."
2. "Write a CHANGELOG.md entry for what we did."
3. "Are there any new failure modes we introduced? If yes, how will we detect them?"
4. "List the files we changed." (This is your diff review checklist.)

---

## PART 5: TESTING PROTOCOLS

### Test 1 — Full Pipeline Smoke Test (run after every deploy)

This test confirms the complete data path is working: storefront JS → ingest endpoint → database → dashboard.

**Steps:**
1. Open drwater.store in an incognito browser (no extensions, no adblocker)
2. Open DevTools → Console tab
3. Add any product to cart
4. Confirm you see: `[CheckoutMaxx] ✓ Active — session: cmx_...`
5. Open DevTools → Network tab → filter for "ingest"
6. Confirm the beacon to /api/cart/ingest returned 200
7. Wait 5 seconds
8. Open Supabase dashboard → CartEvent table → sort by createdAt DESC
9. Confirm a new row exists with the correct eventType and a timestamp from the last minute
10. Open IngestLog table → confirm a row with success: true and latencyMs < 300
11. Open the CheckoutMaxx app dashboard → Cart Activity tab
12. Confirm the session appears

**If any step fails:**
- Step 4 fails → Theme extension isn't active. Check Shopify admin → Online Store → Themes → App embeds
- Step 6 fails → Endpoint is down. Check Vercel deployment status and logs
- Step 9 fails → Write is failing silently. Check IngestLog for error details
- Step 12 fails → Dashboard read queries are broken (likely the Prisma/Accelerate issue)

**Time required:** 3 minutes. Do it after EVERY Vercel deploy. No excuses.

### Test 2 — Checkout Pipeline Test (run weekly + after pixel changes)

**Steps:**
1. Open drwater.store incognito
2. Add a product to cart
3. Click Checkout
4. Enter test customer details (use your own email, fake address)
5. Get to the payment step (don't actually pay, or use Shopify Bogus Gateway if set up)
6. Check Supabase → CheckoutEvent table → confirm rows for:
   - checkout_started
   - checkout_contact_info_submitted
   - checkout_address_info_submitted
   - checkout_shipping_info_submitted
7. Check that sessionId on the CheckoutEvent matches the sessionId on the CartEvent from step 2

**If sessionId doesn't match:**
The session join is broken. Check: did the checkout open in a new tab? Is `_cmx_sid` being written to cart attributes? Is the Web Pixel reading it correctly?

### Test 3 — Coupon Flow Test (run after coupon logic changes)

**Steps:**
1. Add product to cart on drwater (cart value > $60 for CREDIT565)
2. Apply coupon PITCHER15 → should generate cart_coupon_applied event
3. Apply coupon ZZZZTEST99 → should generate cart_coupon_failed event
4. Apply coupon CREDIT565 → should generate cart_coupon_applied event
5. Check that NO event was generated for HYDRATEFIRST (automatic discount filtering)

**In Supabase, run:**
```sql
SELECT "eventType", "couponCode", "couponSuccess", "couponFailReason", "occurredAt"
FROM "CartEvent"
WHERE "shopId" = '[drwater-shop-id]'
  AND "eventType" LIKE 'cart_coupon%'
  AND "occurredAt" > now() - interval '1 hour'
ORDER BY "occurredAt" DESC;
```

If you see a row for HYDRATEFIRST, the filter is broken.

### Test 4 — Failure Recovery Test (run monthly)

This test deliberately breaks the pipeline to verify your monitoring catches it.

**Steps:**
1. In Vercel, temporarily set SUPABASE_URL to a garbage value (e.g., `https://broken.supabase.co`)
2. Redeploy
3. Wait 5 minutes
4. Check UptimeRobot → should show an alert
5. Check /api/health → should return `"status": "down"`
6. Check IngestLog → should show recent rows with success: false
7. Restore the correct SUPABASE_URL
8. Redeploy
9. Run Test 1 to confirm recovery

**Why bother?**
Because if your monitoring doesn't catch a deliberate failure, it won't catch an accidental one either. You'd rather find out now than at 3 AM when a real outage happens.

### Test 5 — Session Join Integrity (run weekly)

```sql
-- How many checkouts can be matched to cart sessions?
SELECT
  COUNT(*) as total_checkouts,
  COUNT(CASE WHEN ce."id" IS NOT NULL THEN 1 END) as matched,
  ROUND(
    COUNT(CASE WHEN ce."id" IS NOT NULL THEN 1 END)::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  ) as join_rate_pct
FROM "CheckoutEvent" ch
LEFT JOIN (
  SELECT DISTINCT "sessionId"
  FROM "CartEvent"
  WHERE "sessionId" IS NOT NULL
) ce ON ch."sessionId" = ce."sessionId"
WHERE ch."occurredAt" > now() - interval '7 days'
  AND ch."sessionId" IS NOT NULL;
```

Target: > 80% join rate. If it drops below 70%, the session linking mechanism needs investigation.

### Test 6 — Data Quality Check (run daily for first 2 weeks, then weekly)

```sql
-- Null field audit
SELECT
  'CartEvent' as "table",
  COUNT(*) as total,
  COUNT(CASE WHEN "sessionId" IS NULL THEN 1 END) as null_session,
  COUNT(CASE WHEN "cartToken" IS NULL THEN 1 END) as null_cart_token,
  COUNT(CASE WHEN "lineItems" IS NULL THEN 1 END) as null_line_items,
  COUNT(CASE WHEN "cartValue" IS NULL OR "cartValue" = 0 THEN 1 END) as zero_cart_value,
  COUNT(CASE WHEN id IS NULL THEN 1 END) as null_id
FROM "CartEvent"
WHERE "occurredAt" > now() - interval '24 hours'

UNION ALL

SELECT
  'CheckoutEvent',
  COUNT(*),
  COUNT(CASE WHEN "sessionId" IS NULL THEN 1 END),
  NULL,
  NULL,
  COUNT(CASE WHEN "totalPrice" IS NULL THEN 1 END),
  COUNT(CASE WHEN id IS NULL THEN 1 END)
FROM "CheckoutEvent"
WHERE "occurredAt" > now() - interval '24 hours';
```

**What to look for:**
- null_id > 0 → The crypto.randomUUID() fix didn't apply everywhere. Critical bug.
- null_session high → Session ID generation or propagation is failing.
- null_line_items high → Cart monitor isn't extracting line items from the response. Check the JS interceptor.
- zero_cart_value high → Cart value calculation is broken or the field isn't being populated.

---

## PART 6: VERCEL LOGS WORKFLOW

Vercel logs are your primary debugging tool when something goes wrong in production. But they're ephemeral (1 hour on free, 3 days on Pro) and noisy. Here's how to use them efficiently.

### How to find what matters

**Step 1: Filter by severity.**
In Vercel dashboard → Deployments → select latest → Logs → filter: `Level: Error`

This removes all the 200 OK noise. You only see failures.

**Step 2: Filter by module.**
Because your logging format uses `[module-name]` prefixes, you can search:
- `[cart/ingest]` — all cart pipeline logs
- `[pixel/ingest]` — all checkout pipeline logs
- `[health]` — health check logs
- `[cron/` — all cron job logs
- `ERROR` — all errors across all modules

**Step 3: Get the timeline.**
When debugging an outage, you need to know: when did it start, when did it end, and what was the first error?

Sort logs by time ascending. Find the first error. That's your root cause. Everything after it is cascade.

### The Vercel → Claude Code debugging pipeline

When you hit a production error you can't solve:

1. Open Vercel logs
2. Filter to the relevant module and time range
3. Copy the FIRST error log entry (not all of them — the first one is what matters)
4. Open Claude Code
5. Paste this prompt:

```
Read SPEC.md and CHANGELOG.md first.

Then debug this production error:

[paste the error log entry]

This error started appearing at [time]. Before that, the system was working.
The last deploy was at [time]. The last code change was [description].

What is the most likely cause? What should I check first?
```

This is 10x more efficient than "my app is broken, help." It gives Claude Code the exact error, the timeline, and the context to diagnose quickly.

### Vercel log retention problem

Free tier: 1 hour retention. This means if something broke at 2 AM and you wake up at 8 AM, the logs are gone. This is why IngestLog exists — it's your permanent log that Vercel can't delete.

When you upgrade to Vercel Pro ($20/month), you get 3-day retention. This is adequate for most debugging. But IngestLog remains the source of truth for pipeline health.

---

## PART 7: DEPLOYMENT CHECKLIST

Run this checklist for EVERY deploy to production. It takes 5 minutes and prevents the kind of failure that cost you 19 hours.

### Pre-deploy

- [ ] All changes committed and pushed
- [ ] CHANGELOG.md updated with this session's changes
- [ ] SPEC.md updated if any contracts or invariants changed
- [ ] No hardcoded API keys, tokens, or secrets in the code
- [ ] No new npm dependencies without documented justification

### Deploy

- [ ] Vercel deploy triggered (automatic via push or manual)
- [ ] Vercel build succeeded (check build logs for warnings)
- [ ] No environment variable changes needed (if yes, set them BEFORE deploying)

### Post-deploy (within 5 minutes of deploy completing)

- [ ] Run Test 1 (Full Pipeline Smoke Test) — add item to cart on drwater, verify row appears in Supabase
- [ ] Check /api/health endpoint — should return status: ok
- [ ] Check Vercel logs for any new errors (filter: Level: Error, last 5 minutes)
- [ ] Check UptimeRobot — all monitors green

### If post-deploy checks fail

1. Do NOT debug in production immediately
2. Check: was it working before the deploy? (Look at IngestLog timestamps)
3. If it was working before: the deploy broke something. Rollback to previous deployment in Vercel dashboard (Deployments → select previous → Promote to Production)
4. Debug the issue locally or in a preview deployment
5. Fix, test, redeploy with the checklist again

---

## PART 8: EVENT DEDUPLICATION STRATEGY

Rebuy Smart Cart fires 3-5 `/cart/update.js` requests for a single customer action. This means your database will contain duplicate events that look like:

```
cart_bulk_updated  | 14:30:01.100 | cartValue: 12500
cart_bulk_updated  | 14:30:01.250 | cartValue: 12500
cart_bulk_updated  | 14:30:01.400 | cartValue: 12500
```

The customer did one thing. Your DB recorded three things. The merchant sees inflated numbers.

### Strategy: Write everything, deduplicate on read

Do NOT try to deduplicate at write time. You want the raw data. Deduplication logic might change (different time windows, different grouping rules). If you throw away data at write time, it's gone forever.

Instead, deduplicate when querying for the dashboard:

**The deduplication rule:**
Events with the same sessionId + same eventType + within 2 seconds of each other = one logical event. Use the LAST one in the group (it has the final state).

**SQL pattern for deduplication:**
```sql
WITH deduped AS (
  SELECT *,
    LAG("occurredAt") OVER (
      PARTITION BY "sessionId", "eventType"
      ORDER BY "occurredAt"
    ) as prev_occurred
  FROM "CartEvent"
  WHERE "shopId" = $1
    AND "occurredAt" > $2
)
SELECT * FROM deduped
WHERE prev_occurred IS NULL
   OR EXTRACT(EPOCH FROM ("occurredAt" - prev_occurred)) > 2;
```

This keeps the first event in each cluster and filters out the rapid-fire duplicates. The 2-second window is tunable — start with 2, adjust based on what you see in drwater's data.

**Where to apply this:**
- Dashboard session list (Cart Activity tab)
- KPI calculations (event counts, conversion rates)
- NOT in IngestLog (that's raw operational data, keep everything)

---

## PART 9: ENVIRONMENT VARIABLE MANAGEMENT

Env vars are the most common source of "deploy broke everything" failures. One typo, one missing variable, and the entire pipeline dies silently.

### Current variables (Vercel)

| Variable | Used by | Critical? | What breaks if wrong |
|----------|---------|-----------|---------------------|
| SUPABASE_URL | Supabase JS client | YES | All reads and writes fail |
| SUPABASE_SERVICE_ROLE_KEY | Supabase JS client | YES | All reads and writes fail |
| DATABASE_URL | Prisma (dashboard reads) | MEDIUM | Dashboard queries fail (being migrated away) |
| DIRECT_URL | Prisma migrations only | LOW | Can't run migrations (dev-only) |
| SHOPIFY_API_KEY | App auth | YES | App can't install or authenticate |
| SHOPIFY_API_SECRET | App auth | YES | App can't install or authenticate |
| CRON_SECRET | Cron endpoint protection | MEDIUM | Cron jobs can't execute |
| RESEND_API_KEY | Email alerts | LOW | Alert emails don't send |

### Rules

1. Never change an env var and deploy simultaneously. Change the var first, wait for Vercel to pick it up, then deploy if needed.
2. Keep a local `.env.template` file in the repo (no values, just variable names) so anyone can see what's needed.
3. If you need to update SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY, do it in the lowest-traffic window (early morning India time = late night US).
4. After changing any env var, run Test 1 (smoke test) immediately.

---

## PART 10: DATA RETENTION AND CLEANUP

### Retention policy (implement before second store)

| Table | Retention | Cleanup method |
|-------|-----------|---------------|
| CartEvent | 90 days (free tier), 1 year (paid tier) | Daily cron deletes old rows |
| CheckoutEvent | 90 days / 1 year | Same cron |
| IngestLog | 30 days | Same cron |
| AlertLog | 90 days | Same cron |
| Baseline | Keep all (small table) | No cleanup needed |
| Shop | Keep all | No cleanup needed |

### Cleanup cron SQL

```sql
-- Run daily at 03:00 UTC via Vercel cron or pg_cron
DELETE FROM "CartEvent" WHERE "occurredAt" < now() - interval '90 days';
DELETE FROM "CheckoutEvent" WHERE "occurredAt" < now() - interval '90 days';
DELETE FROM "IngestLog" WHERE "occurredAt" < now() - interval '30 days';
DELETE FROM "AlertLog" WHERE "sentAt" < now() - interval '90 days';
```

### Before deleting: aggregate

Before the cleanup cron runs, compute daily aggregates and store them:

```sql
-- DailySummary table (create this)
INSERT INTO "DailySummary" ("shopId", "date", "cartEvents", "checkoutEvents",
  "completedOrders", "avgCartValue", "avgOrderValue", "sessionJoinRate")
SELECT
  "shopId",
  DATE("occurredAt") as date,
  COUNT(*) FILTER (WHERE 1=1) as "cartEvents",
  0 as "checkoutEvents", -- computed separately
  0 as "completedOrders",
  AVG("cartValue") as "avgCartValue",
  0 as "avgOrderValue",
  0 as "sessionJoinRate"
FROM "CartEvent"
WHERE DATE("occurredAt") = CURRENT_DATE - 1
GROUP BY "shopId", DATE("occurredAt");
```

This way, when raw events are deleted after 90 days, the merchant still has trend data going back months. The dashboard shows daily aggregates for old data and real-time events for recent data.

---

## PART 11: THE WEEKLY REVIEW RITUAL

Every Monday morning, spend 15 minutes doing this. It catches drift before it becomes a crisis.

1. **Check IngestLog summary** (the bookmarked query from Part 1)
   - Any failures in the last 7 days? What was the error?
   - Is average latency trending up?
   - Are event counts consistent day-over-day?

2. **Check session join rate** (Test 5 query)
   - Still above 80%? If dropping, investigate session ID propagation.

3. **Check data quality** (Test 6 query)
   - Any new null patterns? Any unexpected zero values?

4. **Check UptimeRobot**
   - Any downtime events in the last 7 days?
   - What was the response time trend?

5. **Check Supabase usage**
   - Dashboard → Settings → Usage → Database size
   - Are you on track with retention projections?

6. **Read CHANGELOG.md**
   - What changed this week? Did any Claude Code session leave incomplete work?
   - Are there any TODOs that haven't been addressed?

Total time: 15 minutes. The discipline of doing this weekly is what separates "my app is reliable" from "my app works until it doesn't."

---

## QUICK REFERENCE: WHAT TO DO WHEN THINGS BREAK

### "Events stopped flowing"
1. Check /api/health → is Supabase reachable?
2. Check IngestLog → are there recent failure rows?
3. Open drwater.store DevTools → is the console log appearing?
4. Check Vercel logs → any errors in last hour?
5. Check Supabase dashboard → is the database online?

### "Dashboard shows wrong numbers"
1. Check if it's a deduplication issue (Rebuy firing multiple events)
2. Run the data quality query (Test 6) to check for nulls
3. Check if the dashboard is reading from Prisma (broken) or Supabase JS (working)

### "Got an UptimeRobot alert"
1. Open /api/health directly in browser — what does it say?
2. If "down": check Supabase status page, check Vercel status page
3. If "degraded": check which specific check failed in the response
4. If it recovers on its own within 5 minutes: log it, investigate later
5. If it doesn't recover: start with Vercel logs, then IngestLog

### "Claude Code broke something"
1. Check CHANGELOG.md — what was the last change?
2. In Vercel, rollback to the previous deployment
3. Run Test 1 on the rollback to confirm it's working
4. Debug the failed change locally
5. Update CHANGELOG.md with what went wrong

### "New store installed but events aren't flowing"
1. Is the theme extension enabled? (Shopify admin → Online Store → Themes → App embeds → CheckoutMaxx should be ON)
2. Is the web pixel installed? (Shopify admin → Settings → Customer events → CheckoutMaxx pixel should be active)
3. Is the Shop row in the database? (Check Supabase → Shop table for the new domain)
4. Check the store's DevTools console for the `[CheckoutMaxx] ✓ Active` log
5. If nothing works: check if the store's theme has CSP headers blocking your beacon URL

---

*This document is alive. Update it as you learn new failure modes, add new tests, and refine the process. The version in the repo should always be current.*
