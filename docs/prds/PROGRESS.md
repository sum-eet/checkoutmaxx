# Checkout Lens — Build Progress

> Resumable progress doc. Last update: 2026-05-13 evening.
> Branch: `rebuild-minimal`. Stack: Vercel (Next.js 14) + Supabase + Prisma. UI: default Shopify Polaris + polaris-viz.

---

## ⚡ RESUME THIS CHAT

Claude Code stores this conversation transcript locally. To reopen this exact session:

```bash
claude --resume
```

Then select the session for this project (look for one labeled around the PRD work, ~2026-05-13).

Or list all sessions for this project:
```bash
ls -lt ~/.claude/projects/-Users-sumeetkarwa-Documents-Code-checkout-maxx/
```

Session transcript directory for this conversation:
`~/.claude/projects/-Users-sumeetkarwa-Documents-Code-checkout-maxx/0259baaa-baeb-4baf-b73b-b4f7b1ba9e95/`

In VS Code: open the Claude Code panel → `/resume` slash command → pick session.

---

## 🚨 YOUR ACTIONABLES (nothing done on your side yet)

Run these in order. None of these are destructive but they all need your hands on the terminal / Shopify Partner Dashboard.

### 1. Run PRD-1 migration against Supabase prod
```bash
cd /Users/sumeetkarwa/Documents/Code/checkout-maxx
psql "$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"')" \
  -f prisma/migrations/20260513000000_checkout_event_funnel/migration.sql
```
**What it does:** adds `shippingPrice` column + composite unique index on `CheckoutEvent`.

**Note on earlier error:** when you ran this without `$DIRECT_URL` exported, psql defaulted to local socket. The command above pulls the URL straight from `.env`.

### 2. Run PRD-2 migration against Supabase prod
```bash
# First find the exact filename — should start with 20260514 (or similar)
ls prisma/migrations/ | grep recovery

# Then run
psql "$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"')" \
  -f prisma/migrations/<that-folder>/migration.sql
```
**What it does:** adds `RecoveryRule`, `RecoveryIssue` tables + `Shop.isPlus`, `Shop.planDisplayName`, `Shop.planCheckedAt`, `Shop.partnerDevelopment`, plus `RecoveryRule.allowStacking`.

### 3. Deploy Shopify extension changes
```bash
shopify app deploy --config=shopify.app.toml
```
**What it does:** pushes the pixel changes (5 new funnel events) + the rewritten checkout-recovery extension (dynamic flow + `network_access = true`) to Shopify. Without this, your storefront and checkout won't have the new behaviors even though the API is live on Vercel.

**Note:** this is the CouponMaxx live app config. NOT `shopify.app.checkoutmaxx.toml`.

### 4. Verify webhooks in Partner Dashboard
Open https://partners.shopify.com → CouponMaxx app → Webhooks (or Configuration → Webhook subscriptions).

Confirm these are listed:
- `orders/create` → `https://couponmaxx.vercel.app/api/webhooks/orders-create`
- `shop/update` → `https://couponmaxx.vercel.app/api/webhooks/shop-update`
- (existing) `app/uninstalled`, `app_subscriptions/update`, GDPR webhooks

If `orders/create` or `shop/update` are missing, the PRD-2 code registers them programmatically on install — but verify they actually appear after a fresh install on a test store.

### 5. Smoke-test the latest preview deploy
Latest URL with everything merged: https://couponmaxx-78wtkh3xj-sumeets-projects-09b827d6.vercel.app

- Install / re-install on `20aprtest.myshopify.com`.
- Open the app → confirm 3 pages load: `/checkoutlens` (dashboard), `/checkoutlens/analytics` (deep-dive), `/checkoutlens/recovery` (settings).
- Fire a few cart events on the storefront → confirm they appear in dashboard within 60s.
- If you have access to a Plus store: enable a recovery rule, fire 2 fail attempts at checkout, verify the banner appears.

### 6. Decide next step (no rush)
Two more PRDs queued:
- **PRD-4** (onboarding) — ready to dispatch, depends on PRD-2's `Shop.isPlus` which is now shipped.
- **PRD-3** (billing + gating) — MUST be last. Retrofits `requireFeature()` and `<FeatureGate>` into everything built so far.

When you're ready: say "dispatch PRD-4" or "dispatch PRD-3" or "do both serially" — I'll launch the subagents.

### 7. Optional cleanup (low priority)
- Unwind the `prisma as any` compat casts added in commit `c1c909b` — they were needed when PRD-5 compiled before PRD-2's schema merged. Now that both have shipped on `b295b84`, full types should work.

---

## What you have NOT been asked to approve / decide

Nothing is waiting on your approval right now. PRD-4 and PRD-3 dispatch is the only open decision, and I'll wait until you say go.

---

## 🆘 IF YOU LOSE THIS CHAT — how to keep going

If `claude --resume` doesn't find this session, open a **fresh** Claude Code session (Opus or Sonnet, doesn't matter for kickoff) and paste:

```
Read /Users/sumeetkarwa/Documents/Code/checkout-maxx/docs/prds/PROGRESS.md
in full. Then read README.md and every PRD-N-*.md in that same folder.
Tell me what's done, what's pending, and what I should do next.
```

That's it. PROGRESS.md + the PRDs are self-contained. Any Claude session can pick up from here.

---

## 📋 READY-TO-PASTE PROMPTS FOR REMAINING PRDS

If you want to dispatch PRD-4 or PRD-3 yourself in a fresh Claude session (Sonnet recommended), paste the prompt below into that session. The session must be running in this repo (`/Users/sumeetkarwa/Documents/Code/checkout-maxx`).

### PROMPT — Dispatch PRD-4 (onboarding)

```
You are executing PRD-4 (Post-install onboarding) for the Checkout Lens
Shopify app. Branch `rebuild-minimal`. Stack: Vercel + Supabase + Prisma.
UI: default Shopify Polaris.

Read first:
1. docs/prds/PROGRESS.md — what's already shipped
2. docs/prds/README.md — shared conventions
3. docs/prds/PRD-4-onboarding-flow.md — the full spec
4. prisma/schema.prisma — current state (Shop.isPlus is now shipped)

Execute PRD-4 in full per the PRD: OnboardingState model + migration,
recompute lib, state/recompute/dismiss API routes, diagnostics/sessions
route, WelcomeModal + SetupGuide components, mount in layout + page,
hook into pixel/ingest and recovery/rule routes. Delete the old
OnboardingBanner.tsx.

Hard rules:
- Default Shopify Polaris only.
- Heavy console.log prefix [PRD-4:area].
- Reuse lib/shop.ts, lib/verify-session-token.ts, lib/prisma.ts.
- Node.js runtime, not Edge.
- Polling via SWR with refreshInterval=10s + hard cap 5min via setTimeout.
- Skip requireFeature() — PRD-3 retrofits. Leave TODO(PRD-3) markers.
- Don't touch billing, dashboard, analytics, recovery — other PRDs.
- Don't run `shopify app dev`. Deploy to Vercel preview.
- Commit per logical unit: schema, recompute lib, APIs, components,
  layout mount, integrations. Messages: feat(prd-4): <area>.

Video asset: leave placeholder file at public/onboarding/recovery-demo.mp4
with a one-line note. User supplies the real asset.

Deliverables (write to docs/prds/PRD-4-EXECUTION-LOG.md):
1. Commit hashes per logical unit.
2. Vercel preview deploy URL.
3. Eval results E4.1–E4.8 — pass/fail with one-line evidence.
4. TODO(PRD-3) markers left.
5. Manual steps user must run (migration SQL, etc).
```

### PROMPT — Dispatch PRD-3 (billing + gating, MUST be last)

Only run this after PRD-4 ships.

```
You are executing PRD-3 (Billing + freemium gating) for the Checkout Lens
Shopify app. Branch `rebuild-minimal`. Stack: Vercel + Supabase + Prisma.
UI: default Shopify Polaris.

This is the LAST PRD. It retrofits gating into PRD-1, PRD-2, PRD-4, PRD-5
work already shipped. Look for `TODO(PRD-3)` markers in:
- app/api/checkoutlens/analytics/{funnel,trend,kpis}/route.ts
- app/api/checkoutlens/dashboard/route.ts
- components/checkoutlens/analytics/{FunnelCard,TrendCard}.tsx
- components/checkoutlens/dashboard/KpiCard.tsx (recovered-sales gate)
- and grep `TODO(PRD-3)` for any I missed.

Read first:
1. docs/prds/PROGRESS.md
2. docs/prds/README.md — shared conventions
3. docs/prds/PRD-3-billing-freemium.md — full spec
4. prisma/schema.prisma

Execute PRD-3 in full:
- Schema: FeatureFlag, FeatureFlagOverride, Shop additions
  (currentPeriodEnd, planChangedAt, partnerDevelopment).
- Seed: 5 feature flags (segmentation_filters, custom_date_range,
  trend_chart, sessions_full → standard; recovery → plus).
- lib/billing/{gate,reconcile,testMode}.ts.
- hooks/useFeatures.ts (SWR-cached).
- components/billing/{FeatureGate,UpgradeCard,PlanCard}.tsx.
- app/api/billing/{create,callback,cancel,me}/route.ts — full rewrite per
  PRD-3 §6. Use shouldUseTestMode(shop) + NODE_ENV check on `test:` flag.
- app/api/webhooks/app-subscriptions-update/route.ts — full status handling.
- Modify app/api/auth/callback/route.ts to call reconcileOnInstall after
  shop row work.
- Rewrite app/(embedded)/checkoutlens/billing/page.tsx + re-enable nav.
- Replace EVERY TODO(PRD-3) marker:
  - API routes: add `await requireFeature(shopId, "<key>")` after auth.
  - Components: wrap in <FeatureGate feature="<key>" fallback={<UpgradeCard/>}>.

Tier matrix (Free / Standard $10 / Plus $39):
- Free: basic KPIs + funnel (30d only) + failed-discounts.
- Standard: + segmentation, custom date range, trend chart, sessions full.
- Plus: + recovery (PRD-2). Plus tier ONLY available on Shopify Plus stores.

Hard rules:
- Default Shopify Polaris only.
- BillingInterval.Every30Days (raw enum EVERY_30_DAYS). trialDays: 14.
  Never compute trial-end yourself — mirror from webhooks.
- USD currency. Shopify FX'es per store.
- `test: shouldUseTestMode(shop) || NODE_ENV !== "production"`.
- Two-layer gating MANDATORY (server + client).
- Heavy console.log prefix [PRD-3:area].
- Node.js runtime, not Edge.
- Webhook verify HMAC first.
- Use shop.plan.partnerDevelopment to detect dev stores → forces test mode.
- Commit per logical unit. Messages: feat(prd-3): <area>.

Deliverables (write to docs/prds/PRD-3-EXECUTION-LOG.md):
1. Commit hashes per logical unit.
2. Vercel preview deploy URL.
3. Eval results E3.1–E3.12 — pass/fail with one-line evidence.
4. List of TODO(PRD-3) markers REPLACED (should be all of them).
5. Manual steps: migration SQL run, `npm run db:seed`, Shopify Partner
   Dashboard pricing setup (Standard $10 + Plus $39 plans in
   Plans section, must match code names "Checkout Lens Standard" /
   "Checkout Lens Plus").
```

---

## 🔑 KEY FACTS TO REMEMBER

- **Branch:** `rebuild-minimal` (not `main`).
- **Live app:** CouponMaxx → `couponmaxx.vercel.app`, client ID `ef34a3eb07ec4333b42d63385823433b`, config `shopify.app.toml`. Product is being rebranded to **Checkout Lens** but the Vercel domain + Shopify client ID stay the same until you flip DNS.
- **Dev store for testing:** `20aprtest.myshopify.com` (staff login in `docs/app-store-listing.md`).
- **Frozen sibling app:** CheckoutMaxx → `checkoutmaxx-rt55.vercel.app`, config `shopify.app.checkoutmaxx.toml`. Runs `drwater.store`. Don't cross the wires.
- **Pricing tiers (final, after rename):** Free / Standard $10 / Plus $39. NOT "Pro".
- **Code paths:** all `checkoutlens` lowercase (not `couponmaxx`).
- **localStorage keys:** `cl:` prefix (not `cm:`).

---

## 🌐 ALL DEPLOY URLS

| When | URL |
|---|---|
| After PRD-1 | https://couponmaxx-cf7uyp0xn-sumeets-projects-09b827d6.vercel.app |
| After PRD-5 | https://couponmaxx-p68k7qeqw-sumeets-projects-09b827d6.vercel.app |
| After PRD-2 (latest, all 3 PRDs merged on commit `b295b84`) | https://couponmaxx-78wtkh3xj-sumeets-projects-09b827d6.vercel.app |

When you ship PRD-4 + PRD-3, append the new URLs here.

---

## Status overview

| PRD | Title | Status | Deploy URL |
|---|---|---|---|
| 1 | Checkout Pulse parity (analytics deep-dive) | ✅ Shipped | https://couponmaxx-cf7uyp0xn-sumeets-projects-09b827d6.vercel.app |
| 5 | Dashboard home (hero `/checkoutlens` page) | ✅ Shipped | https://couponmaxx-p68k7qeqw-sumeets-projects-09b827d6.vercel.app |
| 2 | Coupon recovery (Plus-only) | ✅ Shipped | https://couponmaxx-78wtkh3xj-sumeets-projects-09b827d6.vercel.app |
| 4 | Post-install onboarding | ✅ Shipped (commits 90c14f0–bb88200) | Pending `vercel --yes` — run manually |
| 3 | Billing + freemium gating | ⏸ Pending dispatch (must ship LAST) | — |

PRD-5 and PRD-2 merged cleanly on commit `b295b84` — both shipped in parallel from independent file scopes.
PRD-4 shipped on 2026-05-13 (commits 90c14f0→bb88200). See `docs/prds/PRD-4-EXECUTION-LOG.md`.

---

## What each PRD delivered

### PRD-1 — Analytics deep-dive (`/checkoutlens/analytics`)
**Commits (7):**
| # | Hash | Area |
|---|------|------|
| 1 | `136a269` | Schema — `shippingPrice` + composite unique `@@unique([shopId, sessionId, eventType])` on `CheckoutEvent` |
| 2 | `b5c00f1` | Pixel — 5 funnel event subscriptions (`checkout_started` → `checkout_completed`) |
| 3 | `d54bf46` | `/api/pixel/ingest` — country priority resolution + synthesized `checkout_started` upsert |
| 4 | `be3c417` | `lib/analytics/{checkoutFunnel,checkoutTrend,failedDiscounts,kpis}.ts` |
| 5 | `37997b3` | 5 API routes under `/api/checkoutlens/analytics/` |
| 6 | `5a94396` | `components/checkoutlens/{DateRangePicker,analytics/*}.tsx` |
| 7 | `473e979` + `6d02ecc` | Page rewrite + DataPoint key fix |

**Eval results:**
| Eval | Status | Notes |
|---|---|---|
| E1.1 Perf FCP < 2s | Pending | Needs prod DB seed + Lighthouse |
| E1.2 No double-count | Pending | Needs psql INSERT test |
| E1.3 Filter consistency | Pass (design) | All widgets re-fetch on URL param change |
| E1.4 Empty state | Pass (design) | `<EmptyState heading="We need more data">` |
| E1.5 Cache TTL | Pass (design) | `unstable_cache` TTL=3600s |
| E1.6 Date picker one-fetch | Pass (design) | `useEffect` deps on `searchParams.toString()` |
| E1.7 Timezone | Pass (design) | `Intl.DateTimeFormat` with shop tz |
| E1.8 Free-tier UpgradeCard | Deferred PRD-3 | `<FeatureGate>` not built yet |
| E1.9 API /trend 402 | Deferred PRD-3 | `requireFeature()` not built yet |
| E1.10 No synthesized overcount | Pass (design) | Synthesized `checkout_started` upsert ensures `s1 ≥ s5` |

**Decisions during execution:**
1. `resolveShopId` doesn't exist as named — used existing `getAuthenticatedShopAndToken` + `ensureShop`.
2. `unstable_cache` tags must be `string[]` (not functions) in Next 14 — used `["analytics"]`.
3. Ingest main insert via Supabase (fire-and-forget); synthesized upsert via Prisma (needs named unique key).
4. Installed `@shopify/polaris-viz@^16.16.0` (was missing).
5. `prisma/migrations/` was gitignored — unignored so SQL migrations are tracked.

**TODO(PRD-3) markers (5):**
- `app/api/checkoutlens/analytics/funnel/route.ts` — `requireFeature(shopId, "segmentation_filters")`
- `app/api/checkoutlens/analytics/trend/route.ts` — `requireFeature(shopId, "trend_chart")`
- `app/api/checkoutlens/analytics/kpis/route.ts` — `requireFeature(shopId, "custom_date_range")`
- `components/checkoutlens/analytics/FunnelCard.tsx` — FeatureGate wrap note
- `components/checkoutlens/analytics/TrendCard.tsx` — FeatureGate + UpgradeCard

---

### PRD-5 — Hero dashboard (`/checkoutlens`)
**Commits (5):**
| # | Hash | Area |
|---|------|------|
| 1 | `c2dae31` | API route `GET /api/checkoutlens/dashboard` |
| 2 | `094b8cb` | `KpiCard`, `UpgradeKpiCard`, `HeatmapGrid` components |
| 3 | `9bcf3ed` | Full rewrite of `/checkoutlens` page — hero dashboard |
| 4 | `d5ffb33` | `scripts/seed-dashboard.ts` — 100K event perf helper |
| 5 | `f0a409e` | Seed script — conditional dotenv require |

**Key design notes:**
- Single aggregator endpoint returns all widget data in one response (avoids N round-trips).
- `unstable_cache` TTL 300s with tag `shop:{shopId}:dashboard`.
- Recovered-sales KPI uses `prisma as any` cast — TODO(PRD-2-merge) since PRD-2 wasn't merged when PRD-5 wrote this. Build fix `c1c909b` resolved compile.
- Drop-off heatmap uses Polaris `<Badge tone>` for color (no custom CSS).

---

### PRD-2 — Coupon recovery (Plus-only)
**Commits (9+ for PRD-2 alone):**
| # | Hash | Area |
|---|------|------|
| 1 | (schema migration) | Schema — `RecoveryRule`, `RecoveryIssue`, Shop additions (`planDisplayName`, `isPlus`, `planCheckedAt`) + `allowStacking` |
| 2 | `cdb0120` | Plus gate, shop plan refresh on install, register `orders/create` + `shop/update` webhooks |
| 3 | `7f1cef0` | Recovery rule API — GET/PUT with Plus gate |
| 4 | `b569599` | `/check`, `/cx`, `/stats` APIs — race-safe issuance, code collision retry |
| 5 | `2a5df90` | Webhook handlers — `orders/create` (attribution) + `shop/update` (plan refresh) |
| 6 | `83fe27a` | Rewrite `checkout-recovery` extension to dynamic flow + enable `network_access` |
| 7 | `2c89ad5` | `cart-monitor` `smart-recovery.js` — POST `/check` on each `cart_coupon_failed` |
| 8 | `0b989ea` | Settings UI page + `PlusGateBanner` + `RecoveryStatsSidebar` |
| 9 | `5c9dcaf` | Recovery nav entry in layout |

**Routes live in build:**
- `ƒ /api/checkoutlens/cx`
- `ƒ /api/checkoutlens/recovery/check`
- `ƒ /api/checkoutlens/recovery/rule`
- `ƒ /api/checkoutlens/recovery/stats`
- `ƒ /api/webhooks/orders-create`
- `ƒ /api/webhooks/shop-update`
- `○ /checkoutlens/recovery` (7.11 kB)

**Key behaviors:**
- `requirePlus(shopId)` first line of every PRD-2 API route. 402 + `{error:"plus_only"}` on fail.
- Race-safe `RecoveryIssue` create: catch P2002, re-fetch existing row.
- `discountCodeBasicCreate` mutation with code-collision retry (1×). If retry fails → `code_generation_failed` returned, no DB row inserted.
- `combinesWith` maps `allowStacking` to `orderDiscounts`, `productDiscounts`, `shippingDiscounts`.
- Plus refresh: on install + `shop/update` webhook + if `planCheckedAt` is null/24h+ old on any API hit.

---

## Manual steps owed (in order)

```bash
# 1. PRD-1 migration — adds shippingPrice + composite unique on CheckoutEvent
psql "$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '\"')" \
  -f prisma/migrations/20260513000000_checkout_event_funnel/migration.sql

# 2. PRD-2 migration — adds Shop.isPlus/planDisplayName/planCheckedAt + RecoveryRule + RecoveryIssue
# Filename starts with 20260514000000_ — check `ls prisma/migrations/` for exact name
ls prisma/migrations/
psql "$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '\"')" \
  -f prisma/migrations/20260514*/migration.sql

# 3. Deploy Shopify extension changes (pixel + checkout-recovery)
shopify app deploy --config=shopify.app.toml

# 4. Verify webhooks in Partner Dashboard
# https://partners.shopify.com → app → Webhooks
# Confirm: orders/create AND shop/update are subscribed
```

**Vercel deploys to verify (latest = b295b84 has all 3 PRDs merged):**
- Latest preview: https://couponmaxx-78wtkh3xj-sumeets-projects-09b827d6.vercel.app
- Promote to prod when smoke tests pass: `vercel deploy --prod` or `/deploy prod`

---

## Open items / known gaps

1. **PRD-3 deferred items** — every gated feature has a `TODO(PRD-3)` marker. PRD-3 retrofits `requireFeature()` (server) and `<FeatureGate>` (client). Currently every paid feature is open to all stores. Acceptable per founder spec (no paying users yet).
2. **`prisma as any` casts** — `c1c909b` added compat casts so PRD-5 could compile before PRD-2 merged. With PRD-2 now merged, these should ideally be unwound — TODO for cleanup pass.
3. **Evals pending real prod data** — E1.1 (perf at 10k sessions), E1.2 (no double-count), E2.x stacking + race tests need real Plus store + seeded data to verify.
4. **PRD-4 onboarding not started** — depends on `Shop.isPlus` which is now shipped via PRD-2. Ready to dispatch.
5. **Recovery extension config** — `network_access = true` set; allowed domain `couponmaxx.vercel.app`. If/when DNS flips to `checkoutlens.vercel.app`, update extension toml.

---

## Next session checklist (when you resume)

1. Confirm all 4 manual steps above are done.
2. Smoke-test latest preview URL: install on `20aprtest.myshopify.com`, walk through analytics + dashboard + recovery settings.
3. Decide: dispatch PRD-4 (onboarding) now? Needs no further prereqs.
4. After PRD-4: dispatch PRD-3 (billing) — LAST. It retrofits gates everywhere.
5. Unwind `prisma as any` compat casts once you're confident everything compiles cleanly with full schema.

---

## Reference: file structure built so far

```
app/(embedded)/checkoutlens/
  page.tsx                     ← PRD-5 hero dashboard
  analytics/page.tsx           ← PRD-1 deep-dive
  recovery/page.tsx            ← PRD-2 settings
  layout.tsx                   ← updated nav (PRD-2 added Recovery entry)

app/api/checkoutlens/
  analytics/{funnel,trend,failed-discounts,filter-options,kpis}/route.ts  ← PRD-1
  dashboard/route.ts           ← PRD-5
  recovery/{rule,check,stats}/route.ts  ← PRD-2
  cx/route.ts                  ← PRD-2 (extended)

app/api/webhooks/
  orders-create/route.ts       ← PRD-2 (attribution)
  shop-update/route.ts         ← PRD-2 (plan refresh)
  app-subscriptions-update/    ← existing (PRD-3 will extend)

components/checkoutlens/
  DateRangePicker.tsx          ← PRD-1
  PlusGateBanner.tsx           ← PRD-2
  analytics/{FilterBar,FunnelCard,TrendCard,FailedDiscountsCard,KpiRow}.tsx  ← PRD-1
  dashboard/{KpiCard,UpgradeKpiCard,HeatmapGrid}.tsx  ← PRD-5
  recovery/RecoveryStatsSidebar.tsx  ← PRD-2

lib/
  analytics/{checkoutFunnel,checkoutTrend,failedDiscounts,kpis,dashboardAggregator}.ts
  billing/plusGate.ts          ← PRD-2

extensions/
  checkout-monitor/src/index.js          ← PRD-1 5 new subscriptions
  checkout-recovery/src/Checkout.tsx     ← PRD-2 dynamic flow
  cart-monitor/assets/smart-recovery.js  ← PRD-2 /check call

prisma/migrations/
  20260513000000_checkout_event_funnel/  ← PRD-1
  20260514000000_*/                       ← PRD-2 (recovery rule + issue)

scripts/
  seed-dashboard.ts            ← PRD-5
```
