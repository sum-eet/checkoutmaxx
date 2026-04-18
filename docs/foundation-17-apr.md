# Auth Bible v2 — Full Refactor Plan

## Context

This repo powers **two Shopify apps** from one codebase:
- **CouponMaxx** — Shopify review submission, deployed at `https://couponmaxx.vercel.app`
- **CheckoutMaxx** — personal dev/live variant, deployed at `https://checkoutmaxx-rt55.vercel.app`

Two Vercel projects. Different `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `SHOPIFY_APP_URL`. No code-level branching — pure env config.

**User pain:** Auth breaks on every install/reinstall cycle. Two months of dev, one month since first review submission, still fighting auth. Latest failure: uninstall → reinstall → Shopify dashboard showed 2 installs, backend processed neither. Each debug session surfaces a new "env var mismatch" narrative. This cannot continue.

**Diagnosed root causes** (from code trace of `lib/ensure-shop.ts`, `app/api/auth/callback/route.ts`, `lib/verify-session-token.ts`, `shopify.app.toml`, `shopify.app.checkoutmaxx.toml`, `prisma/schema.prisma`, `.vercel/project.json`):

1. **Shop-creation divergence** — `auth/callback` and `ensureShop` use **different algorithms**. Callback deactivates ALL rows and inserts fresh UUID unconditionally. ensureShop preserves row and upgrades `accessToken`. When both fire during one managed install, callback can OBLITERATE a valid Shop row ensureShop just built → fragmented IDs, orphaned data.
2. **Silent HMAC failure** — `lib/verify-session-token.ts` has no logging. Secret mismatch returns `null`, no trail. `ensureShop` then fails invisibly. Debugging dead-ends.
3. **Schema drift** — DB has partial unique index `Shop_shopDomain_active_unique`, Prisma schema only declares `@@index([shopDomain])`. A fresh `prisma db push` could drop the partial index → concurrent-install bug returns.
4. **`.vercel/project.json` committed** — pins repo to CouponMaxx project. Running `vercel link` for CheckoutMaxx overwrites it. If committed by accident, deployments cross-wire.
5. **No env startup validation** — missing/mismatched `SHOPIFY_API_SECRET` manifests as random 401s later, not as a loud boot error.

**Outcome intended:** one canonical code path for Shop provisioning, loud failure on env misconfig, schema matches DB, Vercel link no longer committed, and a **canonical `AUTH-BIBLE-V2.md`** that Sonnet (and future Claude sessions) must follow verbatim. Stop the loop.

---

## Deliverables

### A. Code changes

1. **New `lib/provision-shop.ts`** — single function `provisionShop(shopDomain, accessToken, scope)` used by BOTH `auth/callback` and `ensureShop`. Single contract:
   - Inside transaction: deactivate all active rows for `shopDomain`, insert new row with fresh UUID, return new `shopId`.
   - Handles 23505 unique-constraint race by re-querying.
   - Always returns a Shop row or throws (no silent failures).
   - Logs: `[provisionShop] shop=X outcome=created|reused_pending|race_resolved`.

2. **Refactor `app/api/auth/callback/route.ts`** — remove inline deactivate+insert block (current lines ~101–172). Replace with single call to `provisionShop()`. Keep HMAC verify, token exchange, pixel/webhook registration.

3. **Refactor `lib/ensure-shop.ts`** — remove inline Shop-creation logic (current lines ~113–156). Replace with call to `provisionShop()`. Keep session-token verify, token-exchange, upgrade-pending-token branch (the ONE case where we reuse a row is when the existing row has `accessToken === "pending_oauth"` and we now have a real token — upgrade in place, don't recreate).

4. **Add logging to `lib/verify-session-token.ts`** — prefix `[verifySessionToken]`. Log on: missing id_token, HMAC mismatch (with truncated hash of secret's first 4 chars so we can eyeball-compare across envs), expired token, missing `dest` claim. Never log raw secret.

5. **New `lib/env-check.ts`** — boot-time validator. Called from `lib/shopify.ts` module-load. Asserts `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL` set. Logs (once) `[env] app=<key-last-4> url=<SHOPIFY_APP_URL>` so every cold start surfaces which app this instance is configured for. Throws if any missing — function fails loud, not silently.

6. **Prisma schema fix** — add partial unique index via `@@unique([shopDomain], where: { isActive: true })` OR document in `prisma/migrations/` that `Shop_shopDomain_active_unique` is DB-managed. Create a new migration capturing the existing DB state so `prisma migrate deploy` is idempotent.

7. **`.gitignore`** — add `.vercel/`. **Also** delete the currently-committed `.vercel/project.json` in a separate commit. Document in bible: each dev runs `vercel link` per machine.

### B. Documentation

8. **`docs/AUTH-BIBLE-V2.md`** — replaces old `AUTH-BIBLE.md`. Structure:
   - **What this codebase is** (two apps, two Vercel projects, one repo)
   - **The ONE install path** (kill "two paths" framing — there is one provisioning function; `auth/callback` and `ensureShop` are just two entry points into it)
   - **What to DO** (rules, each with a why)
   - **What NOT to do** (larger section — specific files not to touch, patterns not to re-introduce, past bugs by commit hash)
   - **Env var contract** per Vercel project (table: CouponMaxx vs CheckoutMaxx expected values)
   - **Testing for Sonnet** (post-change verification commands)
   - **Testing for user** (manual install/uninstall/reinstall scripts with expected log output)
   - **Debug playbook** — symptom → log to grep → likely cause (replaces tribal knowledge)

### C. Archive

9. Move old `docs/AUTH-BIBLE.md` → `docs/archive/AUTH-BIBLE-v1-2026-04-12.md`. Don't delete — historical record of what was once believed.

---

## Critical files (reference list for Sonnet)

**Will modify:**
- `app/api/auth/callback/route.ts` (~lines 101–172 replaced)
- `lib/ensure-shop.ts` (~lines 113–156 replaced; keep pending-token upgrade branch)
- `lib/verify-session-token.ts` (add logging, no logic change)
- `lib/shopify.ts` (import env-check at top)
- `prisma/schema.prisma` (Shop model — unique constraint)
- `.gitignore`
- `docs/AUTH-BIBLE.md` (delete/archive)

**Will create:**
- `lib/provision-shop.ts`
- `lib/env-check.ts`
- `docs/AUTH-BIBLE-V2.md`
- `prisma/migrations/XXXX_shop_partial_unique/migration.sql`
- `docs/archive/AUTH-BIBLE-v1-2026-04-12.md` (moved)

**MUST NOT TOUCH:**
- Any `app/api/pixel/ingest/**`, `app/api/cart/ingest/**`, `app/api/session/ping/**` — these are storefront ingest, never use session tokens, never call ensureShop. Leave alone.
- `app/api/webhooks/app-uninstalled/route.ts` — uninstall path is working. Scope creep = new bugs.
- `app/api/webhooks/gdpr/**` — compliance surface, out of scope.
- `extensions/**` — checkout/pixel extensions are independent of admin auth.
- `app/(admin)/**` page components — no UI changes.
- Billing routes — not part of auth.
- `lib/session-storage.ts` — Prisma-backed, working.
- Any cron job under `app/api/jobs/**`.

---

## AUTH-BIBLE-V2.md — outline of content Sonnet will write

```
# CouponMaxx + CheckoutMaxx Auth Bible v2

## What this codebase is
One Next.js repo → two Shopify apps → two Vercel projects.
Per-project env vars are the ONLY thing that distinguishes them.
No if-statements. No branch logic. Env is the switch.

## The ONE Install Path
provisionShop(shopDomain, accessToken, scope) is THE Shop-creation function.
auth/callback calls it. ensureShop calls it. Nothing else creates Shop rows.
Contract: deactivate all active rows for domain → insert fresh UUID → return.
Exception: pending_oauth upgrade (ensureShop only) — in-place token update, no new row.

## DO
1. Every admin API route: call ensureShop() first.
2. Every redirect + fetch: carry id_token.
3. Env-check runs at boot. If env wrong, app must not start.
4. Log every auth entry: [verifySessionToken], [ensureShop], [AUTH], [provisionShop].
5. Match scopes in all 4 locations.
6. Offline tokens only.
7. Soft-delete on uninstall.

## DON'T (expanded)
1. DON'T add a second Shop-creation code path. Ever. If you feel the urge, extend provisionShop().
2. DON'T touch ingest endpoints during auth work.
3. DON'T commit .vercel/project.json.
4. DON'T hardcode SHOPIFY_APP_URL in code — always read from env.
5. DON'T cache Shop lookups in memory.
6. DON'T skip HMAC verify.
7. DON'T log raw SHOPIFY_API_SECRET — only last-4 hash.
8. DON'T run prisma db push against prod — use migrations.
9. DON'T add feature flags for auth behavior — one path, always.
10. DON'T remove the pending_oauth upgrade branch in ensureShop. It handles the legitimate "token exchange succeeded on second try" case.

## Env var contract
| Var | CouponMaxx | CheckoutMaxx |
|-----|-----------|--------------|
| SHOPIFY_API_KEY | ef34a3eb…33b | 0a60bbe…8d8 |
| SHOPIFY_APP_URL | https://couponmaxx.vercel.app | https://checkoutmaxx-rt55.vercel.app |
| SHOPIFY_API_SECRET | (from partner dash) | (from partner dash) |

Audit quarterly. Mismatches cause silent HMAC fail.

## Testing (Sonnet)
After any auth change:
1. `npm run typecheck` — zero errors.
2. `npm run build` — zero errors.
3. Grep for `crypto.randomUUID()` in app/api/auth + lib/. Must appear ONLY in provision-shop.ts.
4. Grep for `.from("Shop").insert(` — must appear ONLY in provision-shop.ts.
5. Read auth/callback/route.ts and ensure-shop.ts end-to-end. Both should call provisionShop(), not inline insert.
6. Read env-check.ts; confirm it throws on missing vars.

## Testing (user — live install flow)
Do this against CheckoutMaxx dev store:
1. Tail Vercel logs: `vercel logs checkoutmaxx-rt55 --follow`.
2. Uninstall app from dev store admin.
3. Grep logs for `[UNINSTALL] shop=X outcome=deactivated`.
4. Confirm Shop row `isActive=false` in Supabase.
5. Reinstall app from Partner Dashboard.
6. Within 60s, grep logs for EITHER `[AUTH] callback fired` OR `[ensureShop] provisioning fresh shop`.
7. Grep for `[provisionShop] shop=X outcome=created`. Must appear exactly once.
8. Confirm new Shop row has fresh UUID, `isActive=true`, `accessToken != "pending_oauth"`.
9. Open embedded admin. Confirm analytics loads with zero data (fresh install semantics).
10. Reinstall within 5 min — repeat steps 2–9. Must work identically.

## Debug Playbook
| Symptom | First log to grep | Likely cause |
|---------|------------------|--------------|
| "Shop not found" on admin UI | `[ensureShop] shop=X` | id_token missing from fetch or HMAC failing |
| Admin shows stale data | `[provisionShop] outcome=created` | Didn't fire — callback short-circuited |
| 2 installs in Shopify, 0 in DB | `[verifySessionToken] hmac_mismatch` | SHOPIFY_API_SECRET wrong for this Vercel project |
| Uninstall didn't stick | `[UNINSTALL]` | Webhook HMAC fail — check secret |
| Pixel doesn't fire | `[pixelRegistration]` | accessToken = pending_oauth — token exchange failed |

## Past bugs (never regress)
- 8c9da2e: callback was reusing old Shop on reinstall → stale data. Fixed by provisionShop deactivate-all.
- 909e09b: ensureShop had in-memory cache → served stale shop after uninstall. Removed.
```

---

## Verification

**Sonnet self-check after implementation:**
```bash
# 1. No divergent insert paths
grep -rn "from(\"Shop\").insert" app/ lib/  # expect: only lib/provision-shop.ts
grep -rn "crypto.randomUUID" app/api/auth lib/ensure-shop.ts  # expect: only lib/provision-shop.ts

# 2. Env check wired
grep -n "envCheck\|env-check" lib/shopify.ts  # expect: imported at top

# 3. Logging present
grep -n "console.log\|console.warn\|console.error" lib/verify-session-token.ts  # expect: ≥4

# 4. Types + build pass
npm run typecheck
npm run build

# 5. Vercel link file gone
git ls-files .vercel/  # expect: empty
cat .gitignore | grep "^\.vercel"  # expect: match
```

**User manual verification (critical — do in order):**

*Setup* — In Vercel dashboard, confirm both projects have correct `SHOPIFY_API_SECRET` (last 4 chars visible). Screenshot for reference.

*Test 1 — Fresh install* (CheckoutMaxx dev store, never installed):
1. `vercel logs checkoutmaxx-rt55 --follow` in one terminal
2. Install app from Partner Dashboard
3. Expect log sequence: `[env] app=…8d8` → `[AUTH] callback fired` OR `[ensureShop] …` → `[provisionShop] outcome=created` → `[pixelRegistration] registered`
4. Supabase: new Shop row, fresh UUID, `isActive=true`, real accessToken.

*Test 2 — Uninstall → Reinstall within 2 min* (reproduce the reported bug):
1. Uninstall from Shopify admin. Expect `[UNINSTALL]` logs.
2. Reinstall immediately. Expect log sequence same as Test 1. **NEW UUID**, old row `isActive=false`.
3. Admin page: zero data. No stale.

*Test 3 — Prod submission parity* (CouponMaxx against review dev store):
1. Same flow as Test 2 on `couponmaxx.vercel.app`.
2. Confirm `[env] app=…33b` appears in logs (proves correct secret for this project).

*Test 4 — Deliberate env break* (catch the silent failure):
1. In Vercel preview env, set `SHOPIFY_API_SECRET` to wrong value.
2. Deploy. Expect app to fail boot with explicit `[env-check] SHOPIFY_API_SECRET mismatch or missing` — NOT a silent 401 later.
3. Revert env var.

If all 4 tests pass, auth is stable. Archive v1 bible. Stop touching auth files until next Shopify API change.

---

## Execution order for Sonnet

1. Create `lib/provision-shop.ts` (new file, no dependencies).
2. Create `lib/env-check.ts`.
3. Refactor `lib/ensure-shop.ts` to use `provisionShop`.
4. Refactor `app/api/auth/callback/route.ts` to use `provisionShop`.
5. Add logging to `lib/verify-session-token.ts`.
6. Wire `env-check` into `lib/shopify.ts`.
7. Prisma migration for partial unique index.
8. `.gitignore` + remove `.vercel/project.json` from git (keep file locally, just `git rm --cached`).
9. Write `docs/AUTH-BIBLE-V2.md`.
10. Archive `docs/AUTH-BIBLE.md` → `docs/archive/`.
11. Run Sonnet self-check commands. Fix any failures.
12. Hand off to user for manual Tests 1–4.

Do NOT commit until user confirms Tests 1–4 all pass.
