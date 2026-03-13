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
were exhausted. Prisma Accelerate was attempted as a fix but its TCP tunnel
could not reach Supabase's postgres on port 5432 from external hosts.

**What was tried (in order):**
1. Supabase pooler URL (port 6543) → "Can't reach server" (IPv6 issue on Vercel)
2. Singleton Prisma client (globalThis) → No change (doesn't help serverless cold starts)
3. connection_limit=1 + sslmode params → Still timing out
4. Prisma Accelerate → Wrong DB host given during setup (.com vs .co)
5. Updated Accelerate host in console → API keys have tenant_id baked in, old key routes to old config
6. New Accelerate API key → Entire tenant was bound to wrong host
7. Supabase JS client → WORKED. HTTP/REST, no TCP, no pools.

**What was decided:**
- Ingest endpoints use Supabase JS exclusively (HTTP, not TCP)
- Prisma stays for `prisma migrate dev` only (via DIRECT_URL to port 5432)
- IDs: `crypto.randomUUID()` in every insert (Prisma was generating cuid() client-side)
- Pattern: `waitUntil()` for async writes in ingest routes
- Dashboard reads: migrate to Supabase JS as next priority

**Files changed:**
- lib/supabase.ts (NEW)
- app/api/cart/ingest/route.ts (rewritten)
- app/api/pixel/ingest/route.ts (rewritten)
- prisma/schema.prisma (added directUrl)
- lib/alert-engine.ts, lib/cart-metrics.ts, lib/metrics.ts, scripts/check-funnel.ts (type annotation fixes for --no-engine build)
- package.json (prisma generate --no-engine, then reverted to prisma generate)

---

## 2026-03-13: Dashboard reads migrated from Prisma/Accelerate to Supabase JS

**What broke:** All dashboard pages showed infinite loading states. Confirmed
via Vercel logs: Prisma Accelerate P6008 — "Accelerate was not able to connect
to your database" — `aws-1-ap-northeast-2.supabase.com:5432` unreachable from
Accelerate's proxy.

**Root cause:** Same issue as ingest migration above. Supabase blocks direct TCP
connections on port 5432 from external hosts (including Accelerate's infrastructure).
Accelerate's purpose is to proxy TCP connections — if it can't reach the DB, it fails.

**What was decided:** Migrate ALL database reads from Prisma to Supabase JS.
This removes Prisma from the entire request path. Prisma's role is now schema
management only.

**Files changed:**
- lib/metrics.ts (complete rewrite — getKpiMetrics, getFunnelMetrics, getLiveEventFeed, getTopErrors, getDroppedProducts, getStatusBannerState, getFailedDiscounts, getDistinctCountries)
- lib/cart-metrics.ts (complete rewrite — getCartKPIs, getCartSessions, getSessionTimeline, getCouponStats)
- app/api/cart/all/route.ts (shop lookup → Supabase)
- app/api/cart/session/route.ts (shop lookup → Supabase)
- app/api/cart/sessions/route.ts (shop lookup → Supabase)
- app/api/cart/kpis/route.ts (shop lookup → Supabase)
- app/api/cart/coupons/route.ts (shop lookup → Supabase)
- app/api/alerts/route.ts (complete rewrite — AlertLog queries)
- app/api/alerts/[id]/route.ts (update → Supabase)
- app/api/settings/route.ts (complete rewrite — Shop reads and writes)

**Also fixed in same session:**
- SWR: added `error` destructuring to all dashboard SWR calls — without it, failed fetches leave
  pages in infinite loading state (data stays undefined, skeleton never clears)
- Refresh buttons added to all dashboard pages (Converted, Abandoned, Cart Activity)
- DateRangeSelector added to Cart Activity page
- getCartSessions filter: added `hasCartValue > 0` check — sessions with only
  `cart_bulk_updated` (fired on every page load) now show if the cart had items

**Known issues remaining:**
- pixel/ingest still does synchronous DB writes (Step 6 — TODO)
- IngestLog table not yet created (Step 3 — TODO)
- /api/health endpoint not yet built (Step 4 — TODO)
- 9 non-dashboard API routes still use Prisma (auth, billing, webhooks, debug, jobs)
  These do not affect daily operation but will break if Prisma TCP fails for those flows.

---

## 2026-03-13: SPEC.md and CHANGELOG.md created

**What changed:** Created SPEC.md and CHANGELOG.md in repo root.

**Why:** Session context. Without these files, every Claude Code session starts
cold — it has to rediscover the architecture, the invariants, the store-specific
quirks, and the technology rules from scratch. With these files, the session
starts warm. The Prisma crisis would have been caught earlier if the technology
rule "no TCP in serverless" had been written down.

**Rule going forward:** Every Claude Code session that modifies the codebase
appends a CHANGELOG.md entry before the session ends.

---

## 2026-03-13: Observability layer built (Steps 2, 3, 4, 6)

**Step 2 — Console confirmation log:**
cart-monitor.js now logs one line after the first successful `navigator.sendBeacon()` call:
`[CheckoutMaxx] Active — session: <sessionId>`. Fires once per page load only.
Visible in DevTools on any store running the extension. Costs nothing. Catches
"is the extension even running?" class of failures instantly.

**Step 3 — IngestLog:**
- `lib/ingest-log.ts` (NEW) — shared fire-and-forget helper used by both ingest endpoints
- Both `app/api/cart/ingest` and `app/api/pixel/ingest` now write to IngestLog after every attempt
- Records: endpoint, shopDomain, eventType, success, latencyMs, errorCode, errorMessage
- `supabase/ingestlog-table.sql` (NEW) — run manually in Supabase SQL editor to create the table
- IngestLog writes are async (fire-and-forget via `.then()`) — never block the main write

**Step 4 — /api/health:**
- `app/api/health/route.ts` (NEW) — unauthenticated, public endpoint
- Checks: Supabase reachable, last CartEvent age, last CheckoutEvent age, recent failure count
- Returns `{ status: "ok"|"degraded"|"down", checks: {...}, timestamp }`
- HTTP 503 if Supabase is unreachable, HTTP 200 otherwise
- Uses `Promise.allSettled` — one slow check never blocks the others
- Ready for UptimeRobot keyword monitor

**Step 6 — pixel/ingest waitUntil:**
- `app/api/pixel/ingest/route.ts` restructured — now responds 200 immediately
- All DB work (shop lookup, insert, IngestLog) moved to `waitUntil()` from `@vercel/functions`
- `@vercel/functions` added to dependencies
- Reduces pixel/ingest response time from 684-1140ms to <50ms
- Web Pixel in Shopify checkout sandbox no longer waits for our DB

**Step 5 — Monitoring setup:**
- UptimeRobot (free): 2 monitors — keyword check on /api/health, HTTP check on /api/cart/ingest
- healthchecks.io (free): cron heartbeat — replaces UptimeRobot heartbeat (paid-only)
- `app/api/jobs/evaluate-alerts/route.ts` updated to ping `HEALTHCHECKS_PING_URL` on success,
  `HEALTHCHECKS_PING_URL/fail` on error
- `HEALTHCHECKS_PING_URL` env var to be added in Vercel after healthchecks.io check is created

**Files changed this session:**
- SPEC.md (NEW)
- CHANGELOG.md (NEW)
- lib/ingest-log.ts (NEW)
- app/api/health/route.ts (NEW)
- supabase/ingestlog-table.sql (NEW)
- extensions/cart-monitor/assets/cart-monitor.js (console log)
- app/api/cart/ingest/route.ts (IngestLog wired in)
- app/api/pixel/ingest/route.ts (waitUntil + IngestLog)
- app/api/jobs/evaluate-alerts/route.ts (healthchecks.io ping)
- app/api/alerts/route.ts, alerts/[id]/route.ts, settings/route.ts (Prisma → Supabase)
- app/api/cart/session/route.ts, sessions, kpis, coupons (Prisma → Supabase)
- lib/cart-metrics.ts (hasCartValue filter fix)
- package.json (@vercel/functions added)
