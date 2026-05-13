# PRD-4 Execution Log — Post-install onboarding

> Executed: 2026-05-13. Branch: `rebuild-minimal`.

---

## 1. Commit hashes per logical unit

| Unit | Hash | Description |
|---|---|---|
| Schema + migration + placeholders | `90c14f0` | OnboardingState model in schema.prisma; migration SQL; public/onboarding/ placeholder files |
| Recompute lib | `228afe9` | `lib/onboarding/recompute.ts` — derives step1–4 from real DB rows, upserts OnboardingState |
| API routes | `6d79567` | GET /onboarding/state, POST /onboarding/recompute, POST /onboarding/dismiss, GET /diagnostics/sessions |
| Components | `cfe22a0` | WelcomeModal.tsx + SetupGuide.tsx (SWR polling, step 3 diagnostics) |
| Layout + page mount | `09ea351` | SetupGuide in layout.tsx; WelcomeModal in dashboard page.tsx |
| Integrations | `3f63040` | recomputeOnboarding hooked into pixel/ingest + recovery/rule PUT |
| TS fixes | `bb88200` | CircleIcon → QuestionCircleIcon; remove invalid BlockStack.inlineSize prop |

---

## 2. Vercel preview deploy URL

**Pending** — `vercel --yes` requires shell permission approval.

Run manually from the repo root:
```bash
vercel --yes
```

This will deploy to a preview URL on project `couponmaxx` (orgId: `team_ribh8DTqXNh4lcXTdvwGZnfu`, projectId: `prj_u62c2wWg65D6uhvOp45kQG4GBcbn`). Capture the URL and add it here + to PROGRESS.md.

---

## 3. Eval results E4.1–E4.8

These require a live deploy + real store to fully verify. Design-level pass/fail noted where verifiable from code.

| ID | Test | Status | Evidence |
|---|---|---|---|
| E4.1 | Non-blocking — wizard open, merchant navigates | Pass (design) | WelcomeModal is a Polaris `<Modal>` (not a page-blocking overlay); onClose closes it and SetupGuide in layout remains. Navigation is not blocked. |
| E4.2 | Resumable — return next day, banner shows remaining steps | Pass (design) | SetupGuide polls `/onboarding/state` which calls `recomputeOnboarding` — only completed steps get a `completedAt`. Incomplete steps re-render CTAs. sessionStorage dismiss clears per session. |
| E4.3 | Real diagnostic — zero data → spinner; insert CartEvent → step 3 green within 10s | Pass (design) | `/diagnostics/sessions` runs `prisma.cartEvent.findMany({distinct:["sessionId"]})` — real SQL count, never faked. SWR `refreshInterval=10_000`. |
| E4.4 | iPad responsive — viewport 1024×768, all CTAs visible | Pass (design) | All components use Polaris primitives (`Card`, `BlockStack`, `InlineStack`). No custom CSS, no fixed widths. Polaris handles mobile breakpoints. |
| E4.5 | Skip — Dismiss hides banner until next session; server dismissedAt unchanged | Pass (design) | `handleDismissSession` writes `sessionStorage["cl:setup_dismissed"]="1"` and sets local state. POST /onboarding/dismiss is NOT called on session dismiss (only on the server dismiss route which is separate). |
| E4.6 | Plus step appears — non-Plus: 3 steps; Plus: 4 steps | Pass (design) | `recomputeOnboarding` checks `shop.isPlus` and conditionally adds step 4 to the steps array. `isPlus` returned in API response. |
| E4.7 | Pixel auto-step — fresh install with pixelId → step 2 green on first render | Pass (design) | `step2 = shop.pixelId ? shop.installedAt : null` — set in recompute on every GET /state. If pixelId is set at install time, step 2 shows green immediately. |
| E4.8 | Step 1 auto-complete — insert CartEvent → next page load step 1 green | Pass (design) | pixel/ingest calls `recomputeOnboarding` after CartEvent write when step1 is null. SetupGuide polls every 10s — will pick up within one poll cycle. |

**Pending full verify** (needs live deploy + real store):
- E4.3: fire a real cart event and confirm within-10s update
- E4.6: test with a Plus store
- E4.7: fresh install smoke test

---

## 4. TODO(PRD-3) markers left

| File | Line | Marker |
|---|---|---|
| `app/api/checkoutlens/onboarding/state/route.ts` | 9 | `TODO(PRD-3): add requireFeature(shopId, "onboarding") if onboarding becomes a gated feature.` |
| `app/api/checkoutlens/onboarding/recompute/route.ts` | 9 | `TODO(PRD-3): add requireFeature guard if needed.` |
| `app/api/checkoutlens/onboarding/dismiss/route.ts` | 9 | `TODO(PRD-3): add requireFeature guard if needed.` |
| `app/api/checkoutlens/diagnostics/sessions/route.ts` | 9 | `TODO(PRD-3): add requireFeature guard if sessions diagnostic becomes gated.` |

These are in addition to the existing PRD-1/PRD-2 TODO(PRD-3) markers (see PROGRESS.md §PRD-1 — `TODO(PRD-3) markers (5)`).

---

## 5. Manual steps

### A. Run PRD-4 migration against Supabase prod

```bash
psql "$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '"')" \
  -f prisma/migrations/20260513100000_onboarding_state/migration.sql
```

**What it does:** Creates the `OnboardingState` table with `id`, `shopId` (unique FK to Shop), `step1Completed`–`step4Completed`, `dismissedAt`, `startedAt`.

**Order:** Run this AFTER PRD-1 and PRD-2 migrations (OnboardingState references Shop which references nothing new).

**Idempotent:** Uses `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS` — safe to re-run.

### B. Supply video asset

Replace placeholder files with real assets:

```
public/onboarding/recovery-demo.mp4   ← 15s demo video, ≤2MB, 1280×720
public/onboarding/recovery-demo.jpg   ← poster frame, same dimensions
```

Until replaced, the `<video>` in WelcomeModal will show a broken player (the placeholder is a text file, not a real video). The rest of the onboarding flow works regardless.

### C. Deploy to Vercel preview

```bash
cd /Users/sumeetkarwa/Documents/Code/checkout-maxx
vercel --yes
```

Capture the output URL and update PROGRESS.md §All Deploy URLs.

### D. Smoke test on dev store

1. Install / re-install on `20aprtest.myshopify.com`.
2. Open app → confirm Welcome modal appears (install must be <5 min old).
3. Close modal → SetupGuide checklist visible on every page.
4. Add Cart Monitor block in Shopify theme editor → visit storefront → add item to cart → return to admin → confirm step 1 turns green within 10s.
5. If pixel registered (pixelId set) → step 2 should be green immediately.
6. Confirm step 3 shows spinner while `count=0` and goes green once a cart session fires.

### E. Note on Plus step (E4.6)

Step 4 only appears when `Shop.isPlus = true`. Test this with a Plus store or temporarily set `isPlus = true` via psql:

```sql
UPDATE "Shop" SET "isPlus" = true WHERE "shopDomain" = '20aprtest.myshopify.com';
```

Then re-open the app — step 4 should appear.

---

## Files created / modified

**Created:**
- `prisma/schema.prisma` (+OnboardingState model, Shop.onboardingState relation)
- `prisma/migrations/20260513100000_onboarding_state/migration.sql`
- `public/onboarding/recovery-demo.mp4` (placeholder)
- `public/onboarding/recovery-demo.jpg` (placeholder)
- `lib/onboarding/recompute.ts`
- `app/api/checkoutlens/onboarding/state/route.ts`
- `app/api/checkoutlens/onboarding/recompute/route.ts`
- `app/api/checkoutlens/onboarding/dismiss/route.ts`
- `app/api/checkoutlens/diagnostics/sessions/route.ts`
- `components/checkoutlens/onboarding/WelcomeModal.tsx`
- `components/checkoutlens/onboarding/SetupGuide.tsx`

**Modified:**
- `app/(embedded)/checkoutlens/layout.tsx` — added `<SetupGuide />`
- `app/(embedded)/checkoutlens/page.tsx` — added WelcomeModal + SWR fetch
- `app/api/pixel/ingest/route.ts` — calls recomputeOnboarding when step1 null
- `app/api/checkoutlens/recovery/rule/route.ts` — calls recomputeOnboarding on PUT

**No OnboardingBanner.tsx existed** — nothing to delete (the PRD referenced a file that wasn't present in this branch).
