# CheckoutMaxx — Next Steps (Detailed)

> Written: 2026-03-13
> Context: The ingest pipeline was fixed today after a 19-hour outage.
> Events are flowing again. Dashboard loads. Everything below assumes
> you're starting from this baseline.
>
> No code in this document. Just decisions, sequence, and reasoning.

---

## THE LOGIC BEHIND THE SEQUENCE

Every step below is ordered by a single principle: **reduce the risk of invisible failure before adding anything new.** You just lost 19 hours of data because nobody was watching. Before you add a single new feature, a single new event, or a single new store — you need to be certain that if something breaks again, you'll know within 5 minutes.

The sequence is:
1. First, verify what you fixed today actually works
2. Then, make sure you can never go dark again
3. Then, remove the remaining time bomb (Prisma Accelerate)
4. Then, get your documentation house in order
5. Then, use drwater as your learning lab for 1-2 weeks
6. Then, polish and ship

Every step below tells you: what to do, why it's in this position, how long it should take, and what "done" looks like.

---

## WEEK 1: STABILISE AND WATCH

---

### Step 1: Verify today's fix is actually working end-to-end

**When:** Today (March 13), before you close your laptop.

**Why this is first:**
You made a significant change to both ingest endpoints today. The fix works in theory — Supabase JS over HTTP instead of Prisma over TCP. But you need to see real rows in the database from real customer behavior, not just from your test. Drwater is a live store doing ~25 orders/day. If the fix is working, there should be new CartEvent and CheckoutEvent rows appearing within hours.

**What to do:**
Open Supabase dashboard. Go to the CartEvent table. Sort by createdAt descending. Look for rows with timestamps after 13:00 today (when you deployed the fix). There should be some by now — drwater gets cart activity throughout the day.

Do the same for CheckoutEvent. Checkout events are less frequent (maybe a few per hour during business hours), so there might be fewer, but there should be at least some by end of day.

Check one CartEvent and one CheckoutEvent that share the same sessionId. If you find a matching pair, the session join is working.

Check that the id field is populated on new rows (not null). This confirms the crypto.randomUUID() fix.

Check that lineItems is populated (not null) on cart_item_added events. If it's null, the cart monitor JS isn't extracting line items from the /cart response properly.

**How long:** 15 minutes of looking at Supabase tables.

**What "done" looks like:**
- New CartEvent rows exist after 13:00 today with non-null ids
- New CheckoutEvent rows exist after 13:00 today with non-null ids
- At least one session has matching sessionId across both tables
- lineItems is populated on cart_item_added events

**If it's NOT working:**
Check Vercel logs for errors on the ingest endpoints. The most likely issue is an environment variable problem (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set correctly in Vercel). The second most likely issue is a table name mismatch (Supabase JS uses exact table names — case-sensitive. "CartEvent" not "cartevent").

---

### Step 2: Add the console confirmation log to cart-monitor.js

**When:** Tomorrow morning (March 14).

**Why this is second:**
This is the fastest observability win. Zero infrastructure needed. After this, anyone (you, a merchant, a collaborator) who opens DevTools on a store running CheckoutMaxx can immediately see if the system is alive. Right now, if you open DevTools on drwater, there's no way to tell if CheckoutMaxx is running unless you watch the Network tab for beacon requests.

**What to do:**
In the cart monitor theme extension JS, after the first successful sendBeacon call, log one line to the console. The log should include the session ID so you can trace it through to the database if needed.

Only log once per page load (not on every event). Only log after confirmed beacon success (not on script load, not on event capture, only after the beacon URL returned successfully or the navigator.sendBeacon() call returned true).

**How long:** 30 minutes including testing on drwater.

**What "done" looks like:**
Open drwater.store in incognito → add item to cart → open DevTools console → see the CheckoutMaxx active line with session ID.

---

### Step 3: Create the IngestLog table in Supabase

**When:** March 14.

**Why this is third:**
The console log (Step 2) tells you the client side is working. IngestLog tells you the server side is working. Together, they cover the full pipeline. Without IngestLog, your only way to know if writes are succeeding is to manually check the CartEvent/CheckoutEvent tables — which is what you've been doing, and which is why the 19-hour outage went unnoticed.

**What to do:**
Create the IngestLog table directly in Supabase SQL editor (not via Prisma migration — this is an operational table, not a schema-managed table). The schema is in your master context file, Section 10A.

Then update both ingest endpoints to write an IngestLog row after every write attempt. On success: log the endpoint, shopDomain, eventType, success: true, and latencyMs. On failure: log all of the above plus errorCode and errorMessage.

**Important decision:** Do you write IngestLog synchronously or async?

Write it async (fire and forget). The IngestLog write should never slow down or block the main event write. If the IngestLog write itself fails, that's acceptable — you lose an observability row, not a customer event. Log IngestLog failures to console.error only (so they appear in Vercel logs).

**How long:** 1-2 hours including updating both endpoints and testing.

**What "done" looks like:**
Add an item to cart on drwater. Check IngestLog table in Supabase. See a row with success: true, latencyMs populated, and a recent timestamp.

---

### Step 4: Build the /api/health endpoint

**When:** March 14-15.

**Why this is fourth:**
IngestLog tells you what happened. The health endpoint tells you the current state. It's the difference between "here's the history of all writes" and "is the system healthy RIGHT NOW?" You need both, but IngestLog first (because health depends on being able to query recent data).

**What to do:**
Create a new API route at /api/health. It should query Supabase for: the most recent CartEvent, the most recent CheckoutEvent, the count of failed IngestLog entries in the last hour, and whether Supabase is reachable at all.

Return a JSON response with status: "ok", "degraded", or "down". The rules:
- "down" if Supabase is unreachable (return HTTP 503)
- "degraded" if last CartEvent is more than 30 minutes old during business hours, or if there are more than 5 failed ingests in the last hour
- "ok" otherwise

Do NOT put this behind authentication. It needs to be publicly accessible for UptimeRobot to ping it. Do NOT include any sensitive data in the response (no tokens, no shopIds, no event content).

**How long:** 1 hour.

**What "done" looks like:**
Hit https://checkoutmaxx-rt55.vercel.app/api/health in your browser. See a JSON response with status: "ok" and recent timestamps for last events.

---

### Step 5: Set up UptimeRobot

**When:** March 15. Immediately after the health endpoint is live.

**Why this is fifth:**
This is the external watchdog. Everything so far (console log, IngestLog, health endpoint) lives inside your own infrastructure. If Vercel goes down, or if your app crashes entirely, none of those can alert you. UptimeRobot pings from outside and catches the total-failure scenario.

**What to do:**
Create a free UptimeRobot account. Set up three monitors:

Monitor 1: HTTP keyword check on /api/health, looking for the word "ok" in the response, every 5 minutes. Alert via email.

Monitor 2: HTTP check on /api/cart/ingest (just checking the endpoint responds — even a 400 means it's alive), every 5 minutes.

Monitor 3: Heartbeat monitor. You'll wire your alert engine cron to ping the heartbeat URL at the end of each run. If the cron stops, UptimeRobot alerts you.

Set up alert contacts: your email and your Slack webhook if you have one.

**How long:** 30 minutes.

**What "done" looks like:**
All three monitors showing green in UptimeRobot dashboard. Test Monitor 1 by temporarily making /api/health return "down" — UptimeRobot should alert within 10 minutes.

---

### Step 6: Fix the pixel ingest latency

**When:** March 15-16.

**Why now:**
Your master context documents pixel ingest response time at 684-1140ms. That's because pixel/ingest is still doing synchronous DB writes — it waits for the Supabase insert to complete before responding. Cart/ingest was already fixed with fire-and-forget, but pixel/ingest wasn't.

This matters because the Web Pixel runs inside Shopify's checkout sandbox. Slow pixel responses can affect checkout UX. Even though Shopify's pixel sandbox is somewhat isolated, there's no reason to leave this slow when the fix is trivial.

**What to do:**
Apply the same async write pattern from cart/ingest to pixel/ingest. Use waitUntil() from @vercel/functions (not void promises — Vercel can kill the function before void promises resolve). Respond immediately with 200, let the DB write happen in the background.

**How long:** 30 minutes. It's copying the existing pattern from cart/ingest.

**What "done" looks like:**
Check Vercel logs for pixel/ingest requests. Response times should drop from 684-1140ms to under 100ms. Also check IngestLog — pixel endpoint should still show successful writes despite the async pattern.

---

### Step 7: Migrate dashboard reads from Prisma to Supabase JS

**When:** March 16-19. One file per day.

**Why now:**
Your master context says Prisma Accelerate still has the wrong database host configured. This means every dashboard read query is either failing silently or hitting the wrong endpoint entirely. The dashboard might look like it's working because it falls back gracefully (shows empty states), but the data it's showing might be stale or missing.

This is a ticking bomb. Every day you leave it, there's a chance a merchant (or you) looks at the dashboard, sees wrong numbers, and loses trust in the product. More practically: if you're about to spend a week analyzing drwater's data (the next phase), you need the dashboard to actually work.

**What to do:**
Migrate the 7 files listed in your master context, Section 10 Priority 2. Do them in order of simplest to most complex:

Day 1: app/api/cart/kpis/route.ts (simple aggregation)
Day 2: app/api/cart/sessions/route.ts (list with filters)
Day 3: app/api/cart/coupons/route.ts (filtered list)
Day 4: app/api/cart/session/route.ts (single session with joined events)
Day 5: lib/cart-metrics.ts (Cart Activity tab data)
Day 6: lib/metrics.ts (Converted/Abandoned tabs — most complex)
Day 7: lib/alert-engine.ts (cron job)

For each file, the pattern is the same: replace prisma.tableName.findMany() with supabase.from('TableName').select(). The Supabase JS query syntax is different but straightforward for these use cases.

Run the full smoke test (Test 1 from the operational playbook) after each file migration to confirm nothing broke.

After all 7 are done: remove @prisma/client and @prisma/extension-accelerate from production dependencies. Keep prisma as a devDependency for migrations. Delete the DATABASE_URL (Accelerate URL) from Vercel env vars. Delete lib/prisma.ts.

**Critical:** Generate Supabase types before starting the migrations. Run `npx supabase gen types typescript --project-id voohvpscahyosapcxbfn` and save the output to lib/database.types.ts. Then use these types in the Supabase client initialization. This gives you type safety that replaces what Prisma was providing.

**How long:** 1-2 hours per file. Total: 7-14 hours across the week.

**What "done" looks like:**
- All 5 dashboard tabs load with real data
- Prisma is removed from production bundle
- Accelerate API key deleted from Vercel
- lib/prisma.ts deleted
- Only Prisma artifact remaining: prisma as a devDependency for `prisma migrate dev`

---

### Step 8: Create SPEC.md and CHANGELOG.md in the repo

**When:** March 17 (mid-week, once the first few migrations are done).

**Why now and not earlier:**
You could argue this should be Step 1. But the reality is: you need to stabilize the system first. Writing documentation while the system is actively half-broken means you're documenting a moving target. By mid-week, IngestLog is live, health endpoint is live, UptimeRobot is watching, and the Prisma migration is underway. The system is stable enough to document accurately.

**What to do:**
Create both files in the repo root using the templates from the operational playbook (Part 2 and Part 3). Fill in the SPEC.md with the actual current contracts (payload fields, endpoint behaviors, data invariants). Fill in the CHANGELOG.md with the Prisma crisis entry and each day's migration work.

**How long:** 1 hour for initial creation. Then 5-10 minutes per Claude Code session to maintain.

**What "done" looks like:**
Both files exist in repo root. SPEC.md accurately describes the current system. CHANGELOG.md has entries from March 13 onwards. The next Claude Code session starts by reading them and can correctly summarize the system state.

---

## WEEK 2: LEARN FROM DRWATER'S DATA

---

### Step 9: Let drwater run for 7 clean days

**When:** March 17-24 (overlapping with the tail end of migrations).

**Why a full week:**
You need a complete dataset with no gaps, no bugs, no silent failures. The 19-hour outage on March 12-13 means your data before today is useless. You need 7 fresh days where every event is captured correctly, every session ID is linked, and every timestamp is accurate.

This isn't a passive waiting step. During this week, you should:
- Check IngestLog every morning (the bookmarked query — 30 seconds)
- Check UptimeRobot dashboard daily (10 seconds)
- Run the data quality query (Test 6) every 2-3 days
- Run the session join rate query (Test 5) at the end of the week
- Check Vercel logs for any errors every 2 days

**What to do:**
Nothing new. Just watch the data accumulate and verify it's clean. Resist the urge to add new features during this week. The temptation will be strong — "I could quickly add cart_drawer_closed while I'm waiting." Don't. You're building confidence in the pipeline. If you change the pipeline while it's being validated, you've invalidated the validation.

**What "done" looks like:**
By March 24, you have:
- 7 days × ~100 cart events/day = ~700 CartEvent rows
- 7 days × ~25 checkout events/day = ~175 CheckoutEvent rows
- Zero gaps in IngestLog (no missing hours)
- Session join rate measured and recorded
- Data quality audit showing acceptable null rates

---

### Step 10: Analyze drwater's data — extract real insights

**When:** March 24-26.

**Why this matters more than you think:**
This step isn't about building features. It's about understanding what the data actually tells you. The insights you extract here become: (a) the proof that CheckoutMaxx works, (b) the pitch for your next merchant, (c) the guide for which dashboard views matter and which are noise, and (d) the basis for deciding which new events to add.

**What to analyze:**

**Funnel analysis:**
How many unique sessions started with a cart event? Of those, how many reached checkout_started? Of those, how many completed checkout_completed? Where's the biggest drop-off?

You already know drwater's CVR is ~50% cart-to-order. But that's the Shopify number. Your data will tell you the story INSIDE that 50%. Maybe 90% of people who start checkout complete it (meaning the problem isn't checkout friction, it's getting people to click Checkout in the first place). Or maybe 70% start checkout but only 50% finish (meaning there's friction in the checkout flow). These are completely different problems with completely different solutions.

**Device and country breakdown:**
What percentage of cart events are mobile vs desktop? Does conversion rate differ by device? Is the country detection working (or still showing VPN-distorted data)?

**Coupon behavior:**
How many customers apply coupons? What's the success vs failure rate? Is HYDRATEFIRST being correctly filtered out? Are there any coupon codes being tried that drwater doesn't know about (customers trying random codes)?

**Time patterns:**
When do most cart events happen? When do most checkouts happen? Is there a pattern to abandonment (e.g., more abandonment late at night)?

**Session duration:**
For sessions that convert, how long between first cart event and checkout_completed? For sessions that abandon, how long between first cart event and last activity?

**What to do with the insights:**
Write them up. Seriously — write a short document that says "Here's what CheckoutMaxx found on drwater.store in its first week." This document becomes your sales collateral. It's the before-and-after proof that the product provides value.

Share the insights with drwater's team (if you have a relationship there). Their reaction will tell you which metrics they care about and which they don't. If they get excited about the coupon data but don't care about time patterns, that tells you where to invest in the dashboard UI.

**How long:** 2-3 hours of SQL queries and analysis. 1 hour to write it up.

**What "done" looks like:**
A 1-2 page document (can be informal) that tells the story of drwater's cart-to-order funnel using real data from CheckoutMaxx. At least 3 specific insights that drwater wouldn't have known without this tool.

---

## WEEK 3: HARDEN AND ADD VALUE

---

### Step 11: Implement event deduplication on the dashboard

**When:** March 25-26.

**Why now:**
Your data analysis in Step 10 will almost certainly reveal the Rebuy duplication issue. You'll see sessions with 3-5 cart_bulk_updated events within 1 second when the customer did one thing. Before you show the dashboard to anyone else (another merchant, a reviewer, a potential customer), this needs to be clean.

**What to do:**
Add the deduplication logic at the query layer (not the write layer — keep all raw data). The rule: events with the same sessionId + same eventType + within 2 seconds of each other collapse into one, keeping the last event in the cluster.

Apply this to: session list view, KPI calculations, and event counts. Do NOT apply to IngestLog (operational data stays raw).

Test on drwater data: compare event counts before and after deduplication. The deduplicated numbers should feel right — they should roughly match the number of actual customer actions you'd expect given drwater's traffic.

**How long:** 2-3 hours.

**What "done" looks like:**
Cart Activity tab shows clean, deduplicated event counts. A session with Rebuy's rapid-fire updates shows as one logical event, not five.

---

### Step 12: Add cart_drawer_closed event

**When:** March 26-27.

**Why this is the first new event:**
This is the highest-value new event from the strategy doc analysis. A customer opening the cart, looking at it, and closing it without clicking Checkout is the clearest abandonment signal you can capture. Nobody else captures this. It's unique to CheckoutMaxx because you're running JS on the storefront (not just in the checkout).

**What to do:**
In the cart monitor JS, detect when the cart drawer closes without a checkout click. The implementation depends on how Rebuy Smart Cart works — it's likely a DOM mutation (a CSS class change or a visibility change on the cart drawer element). You'll need to observe the cart drawer element and fire the event when it transitions from visible to hidden without a preceding checkout_clicked event.

This is where it gets theme-specific. Rebuy's cart drawer has specific CSS classes and DOM structure. You need to figure out the detection mechanism for Rebuy, and also think about how this would work on other themes (for the second store). Ideally, you'd detect cart close in a theme-agnostic way (watching for visibility changes on the element that contains the cart), but you might need a theme-specific approach for the first implementation.

**How long:** 3-4 hours. The DOM observation logic needs careful testing.

**What "done" looks like:**
Open drwater → add item → open cart drawer → close cart drawer without clicking Checkout → check Supabase → cart_drawer_closed event exists with correct sessionId and timestamp.

---

### Step 13: Add country detection via Shopify Liquid

**When:** March 27-28.

**Why now:**
Your master context documents that country detection is unreliable (Indian customer with VPN showing as GB). You're about to analyze data by country and show it in the dashboard. If the country field is wrong, that entire analysis is wrong. Fix the input before you build views on top of it.

**What to do:**
In the cart monitor's .liquid file (the theme app extension), inject Shopify's localization.country.iso_code into a global JS variable. The cart monitor JS reads this variable instead of doing client-side IP geolocation. This gives you Shopify's server-side country detection, which is based on the customer's account/shipping settings and is not affected by VPNs.

For CheckoutEvents, use the checkout.shippingAddress.countryCode from the Web Pixel payload once the customer has entered their shipping address.

**How long:** 1-2 hours.

**What "done" looks like:**
New CartEvent rows in Supabase have correct country values that match the customer's actual location, not their VPN exit node. Test by browsing drwater with and without VPN — both should show the correct country.

---

### Step 14: Build the daily summary cron

**When:** March 28-29.

**Why now:**
You've got IngestLog, health endpoint, and UptimeRobot catching acute failures. The daily summary catches slow degradation — trends that develop over days, not minutes. Event counts dropping gradually, latency creeping up, join rates declining. These are the problems that kill you slowly.

**What to do:**
Create a Vercel cron job that runs once daily at midnight UTC. It queries the last 24 hours of IngestLog, CartEvent, and CheckoutEvent, computes the summary metrics (event counts, failure count, average latency, session join rate, alerts fired), and sends the result via Resend to your email.

Also have the cron ping UptimeRobot's heartbeat URL at the end of its run. If the cron stops working, UptimeRobot will notice within the heartbeat's expected interval.

**How long:** 2-3 hours.

**What "done" looks like:**
Wake up tomorrow morning to an email with yesterday's CheckoutMaxx summary. All numbers look reasonable. UptimeRobot heartbeat monitor is green.

---

## WEEK 3-4: POLISH AND PREPARE FOR SECOND STORE

---

### Step 15: Decide on event deduplication threshold for non-Rebuy stores

**When:** March 29.

**Why this needs a decision:**
The 2-second deduplication window works for Rebuy. But your second store might use a different cart app (Ajax Cart, Slide Cart, native Shopify cart) that has different timing characteristics. Before going to the second store, decide: is the deduplication logic configurable per store, or is it a global setting?

Recommendation: Make it a global setting for now (2 seconds), but build it so the threshold is a constant that can easily be changed to a per-store config later. Don't over-engineer this.

**How long:** 30 minutes of thinking + a note in SPEC.md.

---

### Step 16: Review and polish the dashboard UI

**When:** March 30 - April 2.

**Why now and not earlier:**
You now have: clean data from 2+ weeks, deduplication working, country detection fixed, and a new high-value event (cart_drawer_closed). You know from Step 10 which metrics drwater's team actually cares about. You can now make informed decisions about what to show prominently and what to hide.

**What to focus on:**
- The funnel visualization — does it clearly show the drop-off at each step?
- The session timeline — when you click a session, does the timeline make sense?
- The KPI cards — are the numbers correct after deduplication?
- Mobile responsiveness — Shopify admin is used on mobile, your embedded app needs to work there too
- Loading states — do tabs show loading spinners while data fetches, or do they show blank/broken states?
- Error states — if a query fails, does the tab show a helpful message or a white screen?

Don't redesign everything. Polish what exists. Fix anything that's confusing or broken. Make sure a merchant who has never seen the product can understand what they're looking at within 30 seconds.

**How long:** 3-5 days of focused UI work.

**What "done" looks like:**
You can screen-record a 60-second walkthrough of the dashboard that makes sense to someone who has never seen it before. No broken states, no confusing numbers, no empty tabs.

---

### Step 17: Start the Shopify app review process

**When:** April 1. In parallel with UI polish.

**Why in parallel:**
The Shopify app review process takes 2-4 weeks. They'll review your app for performance, security, privacy, and UX. They'll give you feedback on what to fix. Starting now means you get their feedback while you're still in polish mode — you can incorporate their requests without a separate cycle.

**What to do:**
Submit your app for review through the Shopify Partners dashboard. You'll need: a complete App Store listing (name, description, screenshots, pricing), a privacy policy (required), and a working app that meets their guidelines.

The App Store listing copy should lead with the monitoring angle. "Know instantly when your checkout breaks" is the hook. "Works on all Shopify plans" is the differentiator. Include at least 3 screenshots: the funnel view, the session timeline, and the alert notification.

Pricing to list: Free tier (7-day retention, basic funnel), Starter at $29/month (30-day retention, alerts), Growth at $69/month (90-day retention, Slack alerts, full analytics).

**How long:** 2-3 hours to prepare the submission. Then 2-4 weeks of waiting (with possible back-and-forth for fixes).

**What "done" looks like:**
App submitted for review. App Store listing drafted with copy, screenshots, and pricing.

---

### Step 18: Find and install on second store

**When:** April 2-5.

**Why this is critical:**
Drwater is your dev store. You know it intimately. You know its theme, its cart app, its traffic patterns. The second store tests every assumption you made that was drwater-specific. If CheckoutMaxx only works on stores with Rebuy Smart Cart, it's not a product — it's a drwater plugin.

**What to look for in a second store:**
- Different industry (not health/wellness — try fashion, home goods, food)
- Different cart mechanism (not Rebuy — try native Shopify cart, Slide Cart, or no cart drawer at all)
- Some real traffic (at least 5-10 orders/day, enough to generate data)
- A merchant who will actually look at the dashboard and give you feedback
- Someone in your network who you can support directly

**How to find them:**
DTC founder communities, Shopify subreddit, Twitter/X DTC community, personal network. Offer free installation for 30 days in exchange for feedback and a review.

**What to do during installation:**
Walk them through the install. Watch them use the dashboard. Take notes on every question they ask and every confusion they have. Their questions ARE your product roadmap.

After installation, run the full smoke test. Then monitor for 48 hours — check IngestLog, check event counts, check that the cart monitor JS works with their theme. The first 48 hours on a new store will surface bugs you've never seen.

**How long:** 1-2 days for finding and installing. Then 1 week of monitoring.

**What "done" looks like:**
Second store installed, events flowing, dashboard showing their data. At least 3 days of clean data without gaps. Merchant has seen the dashboard and given initial feedback.

---

### Step 19: Implement the data retention cron

**When:** April 5-7.

**Why now:**
You now have two stores generating data. Before you add more, establish the retention policy so data doesn't grow unbounded. At 2 stores with ~200 events/day combined, you'll generate ~6MB/month. That's nothing, but the habit of running retention cleanup should be established before it matters.

**What to do:**
Create a daily Vercel cron job that deletes rows older than 90 days from CartEvent, CheckoutEvent, and IngestLog. Before deleting, aggregate the day's data into a DailySummary table (total events, conversion rate, average cart value per store per day). This way, merchants can still see trend data beyond 90 days, just not individual events.

**How long:** 2-3 hours.

**What "done" looks like:**
Cron runs daily. DailySummary table is being populated. No data older than 90 days in the event tables (you won't see this effect immediately, but the mechanism is in place).

---

### Step 20: Collect first reviews

**When:** April 7-14.

**Why this is a distinct step:**
Reviews are not a side effect of having a good product. They're a deliberate activity. On the Shopify App Store, 0 reviews = invisible. 5 reviews = you start appearing in search. This is the highest-leverage marketing activity you can do right now.

**What to do:**
Ask drwater's team for a review. Be specific: "Could you leave a review mentioning what insight CheckoutMaxx gave you about your checkout funnel?" Specific reviews convert other merchants.

Ask your second store for a review after they've had 1-2 weeks with the product.

Reach out to 3-4 more stores in your network. Offer free 30-day trials in exchange for an honest review. Install the app for them, provide white-glove support, make sure it's working, then ask for the review.

**How long:** This is an ongoing activity, not a one-time task. But the concentrated push should be 1-2 weeks.

**What "done" looks like:**
5 reviews on the Shopify App Store, all 4-5 stars, each mentioning a specific benefit.

---

## SUMMARY: THE CALENDAR VIEW

| Date | Step | Focus |
|------|------|-------|
| Mar 13 (today) | Step 1 | Verify fix is working |
| Mar 14 | Steps 2-3 | Console log + IngestLog table |
| Mar 15 | Steps 4-5 | Health endpoint + UptimeRobot |
| Mar 15-16 | Step 6 | Fix pixel ingest latency |
| Mar 16-22 | Step 7 | Migrate 7 Prisma files to Supabase JS |
| Mar 17 | Step 8 | Create SPEC.md + CHANGELOG.md |
| Mar 17-24 | Step 9 | Let drwater run clean for 7 days |
| Mar 24-26 | Step 10 | Analyze drwater data, extract insights |
| Mar 25-26 | Step 11 | Event deduplication on dashboard |
| Mar 26-27 | Step 12 | Add cart_drawer_closed event |
| Mar 27-28 | Step 13 | Fix country detection via Liquid |
| Mar 28-29 | Step 14 | Daily summary cron |
| Mar 29 | Step 15 | Deduplication threshold decision |
| Mar 30 - Apr 2 | Step 16 | Dashboard UI polish |
| Apr 1 | Step 17 | Submit for Shopify app review |
| Apr 2-5 | Step 18 | Second store installation |
| Apr 5-7 | Step 19 | Data retention cron |
| Apr 7-14 | Step 20 | Collect first 5 reviews |

Total timeline: ~4 weeks from today to "real business with 2+ stores, reviews, and a polished product."

---

## THE THREE THINGS TO REMEMBER

1. **Observability before features.** Steps 2-6 exist so that Steps 12-20 don't result in another 19-hour outage. Don't skip them. Don't rush through them.

2. **Data before polish.** The week of clean drwater data (Step 9) and the analysis (Step 10) will teach you more about what to build than any amount of brainstorming. Let the data tell you what matters.

3. **Reviews before scale.** 5 reviews on the App Store is worth more than 50 features. The reviews get you distribution. Distribution gets you merchants. Merchants get you data. Data gets you insights. Insights get you a better product. That's the flywheel.

---

*Print the calendar view. Check off each step as it's done. Update CHANGELOG.md as you go.*
