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

## 2026-03-13: Cart timeline page URLs + cart value $0 bug fix

**Cart value $0 with products:** `lastWithValue` was finding any event with `cartValue != null`
including cartValue=0. Rebuy's attribute-sync calls return `total_price=0` even when
the cart has items — this was overwriting the real value. Fixed to require `cartValue > 0`.
Modal header also fixed to show "—" not "$0.00".

**Page URLs in timeline:** Every timeline event now shows the page path where it happened.
"Left the page · /products/hydrofixx", "Opened page · /collections/all",
item events show page appended to cart value. This data was always in CartEvent.pageUrl,
just not surfaced.

**Files changed:**
- lib/cart-metrics.ts
- app/(embedded)/dashboard/cart/page.tsx

---

## 2026-03-13: Cart Activity page improvements

**What changed:**

KPI cards split — `cartsOpened` now shows "X with products · Y empty" sub-label.
New "With products" card added. Conversion % now uses product carts as denominator
(not all 403 opens, most of which are empty cart page visits).

Products column — "Empty cart" (subdued) instead of "—" for sessions with no items.

Cart value display — "— → $0.00" fixed. Now shows "—" for empty carts. Arrow
only shown when cart value genuinely changed (e.g. "$50.00 → $114.99").

Timeline labels — `cart_bulk_updated` now shows "Opened page (empty cart)" or
"Cart updated". `cart_cleared` shows "Cleared cart". No more raw event type
strings in the modal.

Timeline modal — fetch errors now logged to console. Silent empty state
(when API call fails mid-fetch) is now debuggable.

**Files changed:**
- lib/cart-metrics.ts (CartKPIs type + getCartKPIs + getSessionTimeline labels)
- app/(embedded)/dashboard/cart/page.tsx (KPI cards, table columns, modal)

---

## 2026-03-13: Fix cart/ingest silent data loss — waitUntil()

**What broke:** IngestLog showed `TypeError: fetch failed` on cart events
(cart_bulk_updated, cart_page_hidden). 6-8 failures per hour. CartEvent rows
were not being written despite the endpoint returning 200.

**Root cause:** `void processEvent(req)` fires the async function but returns
the response immediately. Vercel treats the function as done once the response
is sent and kills the execution context — cutting the Supabase HTTP request
mid-flight. The request body (`req.text()`) was also being read AFTER the
response was sent, which is invalid on a consumed request stream.

**Fix:** Same pattern applied to pixel/ingest earlier today:
- Read and parse body synchronously before responding
- Pass parsed data (not the request object) to `processEvent()`
- Wrap `processEvent()` in `waitUntil()` so Vercel keeps the function alive
- `SKIP_EVENTS` set moved to module level (minor cleanup)

**Also fixed in same session:**
- Added GET handler to `/api/cart/ingest` — UptimeRobot HTTP monitors use GET,
  POST-only endpoint was returning 405 which UptimeRobot read as "down"

**Files changed:**
- app/api/cart/ingest/route.ts

---

## 2026-03-14: Fix date range filter — DateRangeSelector no longer resets on range switch

**Bug:** Switching ranges (e.g. 24h → 1h → 24h) reset the active button back to
24h every time. Root cause: the `if (loading) return (...)` early return rendered
a completely different component tree that didn't include DateRangeSelector.
React unmounted it on every range switch (new SWR key = isLoading=true = early
return fires), wiping its local `active` state back to "24h".

**Fix:** Removed the early return entirely. Page now always renders the same
component tree. Loading state is handled inline — KPI cards show skeleton cards,
the session table shows SkeletonBodyText, DateRangeSelector stays mounted and
never loses its active preset state.

**Files changed:**
- app/(embedded)/dashboard/cart/page.tsx

---

## 2026-03-14: Current state of all dashboard pages — what each page shows

### Navigation structure
4 pages in the embedded app sidebar:
1. Converted Carts (`/dashboard/converted`) — default landing page
2. Abandoned Carts (`/dashboard/abandoned`)
3. Cart Activity (`/dashboard/cart`)
4. Notifications (`/dashboard/notifications`) + Settings (`/dashboard/settings`)

---

### Page 1 — Converted Carts (`/dashboard/converted`)

**Data sources:** `/api/metrics` (checkout funnel) + `/api/cart/all` (cart KPIs)

**KPI row (3 cards):**
- **Cart Additions** — total cart sessions opened in the selected range. Sparkline
  shows hourly distribution across the day. Sub-label: "X% reached checkout".
  Clicking navigates to Cart Activity page.
- **Checkout Starts** — sessions that reached Shopify checkout (from CheckoutEvent
  where eventType = checkout_started). Sub-label: "X% of cart additions".
- **Checkout Completes** — completed orders (checkout_completed events). Shows CVR%
  as sub-label and a +/- delta badge vs baseline CVR (previous period comparison).

**Funnel chart:** Line chart showing % of sessions surviving each checkout step:
Cart → Checkout → Contact → Address → Shipping → Payment → Completed.
Dashed reference line shows baseline CVR. Note: Completed can exceed Payment
because Shop Pay / Apple Pay skip intermediate steps.

**Funnel Steps table:** Same data as chart in tabular form — step name, session
count, % of total.

**Checkout CVR table:** Raw numbers — checkoutsStarted, completedOrders, CVR,
baselineCVR, cvrDelta in percentage points.

---

### Page 2 — Abandoned Carts (`/dashboard/abandoned`)

**Data sources:** `/api/metrics` (funnel, errors, dropped products, failed discounts)

**KPI row (4 cards):**
- Sessions Started — checkouts that began
- Sessions Dropped — sessions that didn't complete
- Drop Rate — % dropped
- Completed — orders that went through

**Checkout Funnel (visual bar chart):**
Each checkout step shown as a horizontal bar, sized relative to the first step.
Between steps: drop count and drop % (red if ≥30% dropped, grey otherwise).
Steps: Cart → Checkout → Contact → Address → Shipping → Payment → Completed.
This is the most important view for identifying where customers abandon.

**Top Errors table:** Errors fired during checkout (from Web Pixel alert_displayed
events). Shows error type and count. Examples: invalid discount code, payment
failure, address validation error.

**Dropped Products table:** Products that were in the cart when a session abandoned.
Shows product title, how many carts contained it at drop, and % of total drops.
Tells you which products have high abandonment association.

**Failed Discount Codes table:** Discount codes that returned errors during checkout.
Shows code, attempt count, last seen date, and the raw error message from Shopify.

---

### Page 3 — Cart Activity (`/dashboard/cart`)

**Data sources:** `/api/cart/all` (sessions, KPIs, coupons from CartEvent table)

**Date range selector:** 1h / 24h / 7d / 30d / Custom. Stays mounted across
range switches — no longer resets. Refresh button passes range params to
correctly bust server-side cache.

**KPI row (4 cards, 3 are clickable filters):**
- **Carts opened** — total distinct sessions. Sub-label: "X with products · Y empty".
  Not clickable (shows everything).
- **With products** *(clickable)* — sessions where cart had at least one item
  (cartValue > 0 or lineItems present or cartItemCount > 0). Click filters the
  session list to only these. Active state shows blue outline.
- **Coupon attempted** *(clickable)* — sessions where at least one coupon event
  fired (applied, failed, or recovered). Click filters to coupon sessions only.
- **Reached checkout** *(clickable)* — sessions where cart_checkout_clicked fired
  OR any CheckoutEvent exists. Click filters to checkout sessions only.

**Recovery banner:** Only shown when recoveredCarts > 0. Shows "X customers
unlocked a discount by adding items after a failed coupon — $Y recovered".

**Cart Sessions tab (default):**
Table with columns: Time (start + session duration), Country, Device, Products
(line items or item count or "Empty cart"), Cart value (start → end if changed,
"—" if $0), Coupons (pills — green if applied, red if failed, ^ prefix if
recovered), Outcome (Ordered / Checkout / Abandoned badge), View link.
When filter is active, only matching sessions shown. Empty state has "Clear
filter" button.

**Session timeline modal (opened via View):**
Header: cart value, item count, outcome (Abandoned / Reached checkout / Order completed).
Products in cart section: line items with quantity and price.
Full journey section: every CartEvent + CheckoutEvent for the session in
chronological order. Each event shows: timestamp, elapsed since previous event
(+Xs / +Xm Ys), Cart/Checkout badge, human-readable label, detail line (cart
value, page URL). Events colour-coded: green for positive (coupon applied,
order complete), red for negative (coupon failed).

**Coupon Intelligence tab:**
Table: Code, Attempts, Success rate (green if ≥50%, red if <50%), Avg cart
value, "Unlocked after fail" (sessions where customer added items to qualify),
Last used date.

---

### Data collection — what feeds the DB

**cart-monitor.js (theme extension, runs on every storefront page):**
Intercepts fetch + XHR calls to /cart/, /cart.js, /discount/ endpoints.
Fires these events to /api/cart/ingest:
- cart_item_added, cart_item_changed, cart_item_removed
- cart_coupon_applied, cart_coupon_failed, cart_coupon_recovered, cart_coupon_removed
- cart_bulk_updated (Rebuy/theme attribute syncs — mostly noise)
- cart_checkout_clicked (click listener on checkout buttons)
- cart_page_hidden (visibilitychange = tab switch / close)
- cart_drawer_opened, cart_drawer_closed (MutationObserver on drawer element)
- cart_atc_clicked (click listener on add-to-cart buttons)
Also fires a session ping to /api/session/ping on every page load.
Console log on load: `[CheckoutMaxx] Loaded — shop: X session: cart_XXXXX`

**checkout-monitor.js (Web Pixel, runs in Shopify checkout sandbox):**
Subscribes to Shopify analytics events and sends to /api/pixel/ingest:
- checkout_started, checkout_contact_info_submitted,
  checkout_address_info_submitted, checkout_shipping_info_submitted,
  payment_info_submitted, checkout_completed
- alert_displayed (discount errors, payment failures)
- ui_extension_errored
Also fires a session ping to /api/session/ping on checkout_started.
Console log: `[CheckoutMaxx] Checkout active — session: cart_XXXXX`
Session ID is shared with cart session via cart attribute `_cmx_sid`.

---

## 2026-03-14: Fix 24h Refresh showing stale data + session ping confirmed working

**Refresh button bug:** Refresh called `/api/cart/all?shop=...&refresh=1` without
date range params. Server cache key is `shopId:startParam` — without the start
param it invalidated the wrong key (`today`), leaving the 24h cached response
stale. Fix: pass current `rangeQuery` in the refresh call so the correct cache
entry is invalidated.

**Session ping confirmed end-to-end:** cart_session_started and
checkout_session_started both writing to SessionPing table. IngestLog shows
success=true after SessionPing table was created in Supabase SQL editor.

**Coupon tracking confirmed:** Full coupon session captured —
HYDRATEFIRST failed, BRUH failed + removed, NAHICHALEGA failed.
Correct cart value $124.98, reached checkout. Timeline shows +elapsed between
events. Country=IN confirmed.

**Files changed:**
- app/(embedded)/dashboard/cart/page.tsx (Refresh passes rangeQuery)

---

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
country, device, pageUrl, occurredAt. Run supabase/sessionping-table.sql
in Supabase SQL editor before testing.

**Files changed:**
- supabase/sessionping-table.sql (NEW — run manually in Supabase SQL editor)
- app/api/session/ping/route.ts (NEW)
- extensions/cart-monitor/assets/cart-monitor.js (pingUrl in CONFIG + session ping)
- extensions/cart-monitor/blocks/cart-monitor.liquid (data-ping-url attribute)
- extensions/checkout-monitor/src/index.js (checkout session ping + console log)
- app/api/health/route.ts (SessionPing checks, new status logic)
- lib/ingest-log.ts (endpoint type widened to string)

---

## 2026-03-14: Latency tracking — drawer events, ATC click, elapsed time in timeline

**What changed:**

**cart_drawer_opened / cart_drawer_closed (cart-monitor.js)**
MutationObserver watches the cart drawer element for attribute changes (`class`,
`aria-hidden`, `style`, `inert`, `data-state`). Fires `cart_drawer_opened` when
the drawer becomes visible and `cart_drawer_closed` when it hides. Tries these
selectors in order: `cart-drawer`, `#CartDrawer`, `.cart-drawer`,
`.rebuy-cart__flyout`, `[data-cart-drawer]`. Retries after 2.5s if the drawer
element isn't in the DOM yet (handles SPAs and lazy-loaded drawers). Includes
`pageUrl` in the event payload.

**cart_atc_clicked (cart-monitor.js)**
Extended the existing click listener to detect add-to-cart button clicks via:
`name="add"`, `data-add-to-cart`, `data-product-add`, `.product-form__cart-submit`,
`.add-to-cart`, or `form[action*="/cart/add"]`. Fires before the `/cart/add.js`
fetch completes — this is the click latency anchor (time from click to
`cart_item_added` = true ATC button → network latency). Includes `pageUrl` and
`triggerText` in payload.

**Elapsed time in timeline modal (cart/page.tsx)**
Each event in the session timeline now shows elapsed time since the previous
event (e.g. `+12s`, `+3m 45s`) below the clock time. First event shows no
elapsed (nothing to diff against). Uses `formatElapsed()` helper.

**Session duration in table (cart/page.tsx)**
Time column now shows two lines: the session start time and the total duration
(e.g. `7m 20s`). Uses `formatDuration()` helper.

**Timeline labels (lib/cart-metrics.ts)**
Added human labels for the three new event types:
- `cart_drawer_opened` → "Opened cart drawer"
- `cart_drawer_closed` → "Closed cart drawer"
- `cart_atc_clicked` → "Clicked add to cart"

**Files changed:**
- extensions/cart-monitor/assets/cart-monitor.js
- lib/cart-metrics.ts
- app/(embedded)/dashboard/cart/page.tsx

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
