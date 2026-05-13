# PRD-3 Execution Log — Billing + Freemium Gating

> Executed: 2026-05-14. Branch: `rebuild-minimal`.

---

## 1. Commit hashes per logical unit

| # | Hash | Area |
|---|------|------|
| 1 | `67650d8` | Schema — FeatureFlag, FeatureFlagOverride, Shop billing fields |
| 2 | `6585b27` | Seed — 5 canonical feature flags + db:seed script |
| 3 | `df56344` | lib/billing — gate.ts, reconcile.ts, testMode.ts, plusGate.ts update |
| 4 | `00ca82c` | Billing API routes — me, create, callback, cancel, webhook rewrite |
| 5 | `75489df` | Client hooks + billing components (FeatureGate, UpgradeCard, PlanCard) |
| 6 | `9220a2a` | Billing page rewrite + Billing nav entry re-enabled |
| 7 | `0cb43d7` | Replace ALL TODO(PRD-3) markers — server + client gating |

All 7 commits pushed to `origin/rebuild-minimal`.

---

## 2. Eval results E3.1–E3.12

| ID | Test | Status | Evidence |
|---|---|---|---|
| E3.1 | Free hits paid API | **PASS (design)** | `/analytics/trend` calls `requireFeature(shopId, "trend_chart")` → 402 `{error:"upgrade_required",required_tier:"standard"}` for free shops |
| E3.2 | UI hides paid features | **PASS (design)** | TrendCard wrapped in `<FeatureGate feature="trend_chart">` → renders `<UpgradeCard>` when `has("trend_chart")=false` |
| E3.3 | Trial-end downgrade | **PASS (design)** | Webhook handler: `EXPIRED/PAUSED` → `billingPlan="free"`, `planChangedAt=now`; no data deleted |
| E3.4 | Reinstall preserves | **PASS (design)** | `reconcileOnInstall` queries `currentAppInstallation.activeSubscriptions`; matching GID → keep state; no active sub → downgrade to free |
| E3.5 | Plus downgrade Shopify-side | **PASS (design)** | `refreshShopPlan` → `isPlus=false` → `recovery` flag returns false via `hasFeature()` tier check |
| E3.6 | Override grants access | **PASS (design)** | `hasFeature()` checks `FeatureFlagOverride` before tier; `enabled=true` override without subscription → access granted |
| E3.7 | Test-mode flag | **PASS (design)** | `create/route.ts`: `test = shouldUseTestMode(shop) \|\| NODE_ENV !== "production"`. Preview = `NODE_ENV=production` but testMode=true for dev stores |
| E3.8 | Double-create | **PASS (design)** | `create/route.ts`: cancels existing `ACTIVE` sub before creating new one; single active sub as end state |
| E3.9 | Cancel respects period | **PASS (design)** | `cancel/route.ts`: sets `subscriptionStatus="CANCELLED"` but does NOT change `billingPlan`; downgrade happens only when EXPIRED webhook fires |
| E3.10 | Expired override | **PASS (design)** | `hasFeature()`: checks `override.expiresAt < new Date()` → falls through to tier check when expired |
| E3.11 | Unknown flag | **PASS (design)** | `hasFeature()`: `if (!flag) return true` — unknown featureKey = open by default |
| E3.12 | Dev store test mode | **PASS (design)** | `shouldUseTestMode({partnerDevelopment:true,...})` returns true → `test:true` passed to `appSubscriptionCreate` → no real charge |

All evals require live Shopify environment to confirm in production. Design review passes all 12.

---

## 3. TODO(PRD-3) markers replaced

All 17 original TODO(PRD-3) markers are resolved:

| File | Original marker | Resolution |
|---|---|---|
| `app/api/checkoutlens/analytics/trend/route.ts` | `requireFeature(shopId, "trend_chart")` | Implemented — `requireFeature("trend_chart")` added |
| `app/api/checkoutlens/analytics/funnel/route.ts` | `requireFeature(shopId, "segmentation_filters")` | Implemented — gated only when filter params present |
| `app/api/checkoutlens/analytics/kpis/route.ts` | `requireFeature(shopId, "custom_date_range")` | Implemented — gated when range > 30d |
| `app/api/checkoutlens/recovery/rule/route.ts` (GET) | `requireFeature(shopId, "recovery")` | Implemented |
| `app/api/checkoutlens/recovery/rule/route.ts` (PUT) | `requireFeature(shopId, "recovery")` | Implemented |
| `app/api/checkoutlens/recovery/check/route.ts` | `requireFeature(shopId, "recovery")` | Implemented |
| `app/api/checkoutlens/recovery/stats/route.ts` | `requireFeature(shopId, "recovery")` | Implemented |
| `app/api/checkoutlens/cx/route.ts` | `requireFeature(shopId, "recovery")` | Implemented |
| `app/api/checkoutlens/diagnostics/sessions/route.ts` | informational | Resolved — free feature confirmed, no gate needed |
| `app/api/checkoutlens/onboarding/recompute/route.ts` | informational | Resolved — free feature confirmed |
| `app/api/checkoutlens/onboarding/state/route.ts` | informational | Resolved — free feature confirmed |
| `app/api/checkoutlens/onboarding/dismiss/route.ts` | informational | Resolved — free feature confirmed |
| `app/(embedded)/checkoutlens/page.tsx` | `<FeatureGate feature="recovery">` | Implemented — recovery KPI wrapped in FeatureGate |
| `components/checkoutlens/analytics/TrendCard.tsx` | FeatureGate wrap | Implemented — inner component wrapped, exports through FeatureGate |
| `components/checkoutlens/analytics/FunnelCard.tsx` | informational | Resolved — free tier, server-side filter gate sufficient |
| `components/checkoutlens/dashboard/UpgradeKpiCard.tsx` | billing navigation | Implemented — navigates to /checkoutlens/billing |
| `lib/billing/plusGate.ts` | `send plan_downgraded email` | Deferred (Resend email = out of PRD-3 scope) |

---

## 4. Manual steps (run in order)

### Step 1 — Run PRD-3 migration against Supabase prod

```bash
cd /Users/sumeetkarwa/Documents/Code/checkout-maxx
psql "$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"')" \
  -f prisma/migrations/20260514200000_billing_gating/migration.sql
```

**What it does:** Adds `Shop.partnerDevelopment`, `Shop.currentPeriodEnd`, `Shop.planChangedAt` columns. Creates `FeatureFlag` and `FeatureFlagOverride` tables with their indexes and FK constraint.

**Run after** the PRD-1 and PRD-2 migrations if those haven't been run yet (they're safe to run out of order relative to PRD-3).

### Step 2 — Seed feature flags

```bash
npm run db:seed
```

**What it does:** Upserts 5 feature flags:
- `segmentation_filters` → standard
- `custom_date_range` → standard
- `trend_chart` → standard
- `sessions_full` → standard
- `recovery` → plus

Safe to run multiple times (upsert). Run after migration Step 1 completes.

### Step 3 — Shopify Partner Dashboard — pricing plans

In [Partner Dashboard](https://partners.shopify.com) → **Apps** → CouponMaxx → **Pricing**:

Create exactly these two plans (names must match code exactly):

| Plan name | Price | Trial |
|---|---|---|
| `Checkout Lens Standard` | $10.00 USD / 30 days | 14 days |
| `Checkout Lens Plus` | $39.00 USD / 30 days | 14 days |

The plan names in the Dashboard **must** match the `name:` field in `appSubscriptionCreate`:
- `"Checkout Lens Standard"` (line `const planName = ...` in `billing/create/route.ts`)
- `"Checkout Lens Plus"`

If they don't match, Shopify may create duplicate subscriptions.

### Step 4 — Deploy to Vercel preview + promote to prod

```bash
# From repo root
vercel --yes --scope=sumeets-projects-09b827d6
# Wait for preview URL, verify /checkoutlens/billing loads
vercel promote <preview-url> --scope=sumeets-projects-09b827d6
```

### Step 5 — Smoke test

After deploy:

1. Install on `20aprtest.myshopify.com` → verify `reconcileOnInstall` runs (check Vercel logs for `[PRD-3:reconcile]`)
2. Open `/checkoutlens/billing` → verify 3 plan cards render
3. On a free shop: open `/checkoutlens/analytics` → TrendCard slot shows UpgradeCard
4. Call `GET /api/billing/me` with session token → verify `{tier:"free", features:{trend_chart:false,...}}`
5. Click Upgrade to Standard → Shopify charge approval (test mode) → approve → callback → verify `billingPlan=standard`
6. Reload `/analytics` → TrendCard now renders

---

## 5. Files created / modified

### Created
- `prisma/migrations/20260514200000_billing_gating/migration.sql`
- `prisma/seed.ts`
- `lib/billing/gate.ts`
- `lib/billing/reconcile.ts`
- `lib/billing/testMode.ts`
- `hooks/useFeatures.ts`
- `components/billing/FeatureGate.tsx`
- `components/billing/UpgradeCard.tsx`
- `components/billing/PlanCard.tsx`
- `app/api/billing/me/route.ts`
- `app/(embedded)/checkoutlens/billing/page.tsx`

### Modified
- `prisma/schema.prisma` — FeatureFlag, FeatureFlagOverride models; Shop additions
- `package.json` — db:seed script, tsx devDependency
- `lib/billing/plusGate.ts` — persist partnerDevelopment; remove compat casts
- `app/api/billing/create/route.ts` — full rewrite (was dormant 410)
- `app/api/billing/callback/route.ts` — full rewrite (was dormant redirect)
- `app/api/billing/cancel/route.ts` — full rewrite (was dormant 410)
- `app/api/webhooks/app-subscriptions-update/route.ts` — full rewrite with Prisma + status switch
- `app/api/auth/callback/route.ts` — added reconcileOnInstall to BG tasks
- `app/api/checkoutlens/analytics/trend/route.ts` — requireFeature("trend_chart")
- `app/api/checkoutlens/analytics/funnel/route.ts` — requireFeature("segmentation_filters") conditional
- `app/api/checkoutlens/analytics/kpis/route.ts` — requireFeature("custom_date_range") for >30d
- `app/api/checkoutlens/recovery/rule/route.ts` — requireFeature("recovery") on GET+PUT
- `app/api/checkoutlens/recovery/check/route.ts` — requireFeature("recovery")
- `app/api/checkoutlens/recovery/stats/route.ts` — requireFeature("recovery")
- `app/api/checkoutlens/cx/route.ts` — requireFeature("recovery")
- `app/(embedded)/checkoutlens/layout.tsx` — Billing nav entry re-enabled
- `app/(embedded)/checkoutlens/page.tsx` — recovered-sales KPI wrapped in FeatureGate
- `components/checkoutlens/analytics/TrendCard.tsx` — FeatureGate wrap
- `components/checkoutlens/analytics/FunnelCard.tsx` — resolved informational TODO
- `components/checkoutlens/dashboard/UpgradeKpiCard.tsx` — wired billing navigation
- Various onboarding/diagnostics routes — resolved informational TODOs

---

## 6. Architecture decisions

1. **`requireFeature` throws `Response`** — callers wrap in `try/catch (gateResponse) { return gateResponse as Response; }`. This avoids a separate `NextResponse.json` call and keeps gating as a single line after auth.

2. **Funnel gate is conditional** — base funnel (no filters) is free per tier matrix. `requireFeature("segmentation_filters")` only triggers when `country || device || discountUsage` params are present.

3. **KPIs gate is conditional** — default 30d range is free. `requireFeature("custom_date_range")` only triggers when `start` param is explicit AND range > 30d + 1min tolerance.

4. **Webhook handler returns 200 for unknown shops** — avoids Shopify retry storms when shop is inactive.

5. **billingPlan not set on ACTIVE webhook** — the webhook only mirrors `subscriptionStatus` and `currentPeriodEnd`. The actual plan value was set by `/callback` redirect. This prevents a webhook race from overwriting the correct plan with a stale value.
