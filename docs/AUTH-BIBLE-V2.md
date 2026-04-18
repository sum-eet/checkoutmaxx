# CouponMaxx Auth Bible v2

> Canonical auth reference. Future Claude sessions and devs must follow this verbatim.
> Supersedes `docs/archive/AUTH-BIBLE-v1-2026-04-12.md`.

---

## What This Codebase Is

One Next.js repo → two Shopify apps → two Vercel projects. This bible covers **CouponMaxx only**.

| App | Vercel Project | Shopify App URL |
|-----|---------------|----------------|
| CouponMaxx | couponmaxx | https://couponmaxx.vercel.app |
| Second app | out of scope — see separate doc | — |

Per-project env vars are the **only** thing that distinguishes them.
No if-statements. No branch logic. Env is the switch.

---

## The ONE Install Path

`provisionShop(shopDomain, accessToken)` in `lib/provision-shop.ts` is **THE** Shop-creation function.

- `app/api/auth/callback/route.ts` calls it.
- `lib/ensure-shop.ts` calls it.
- **Nothing else creates Shop rows.**

### Contract

1. Deactivate ALL rows for `shopDomain` (catches delayed/missed uninstall webhooks).
2. Insert fresh UUID row with supplied `accessToken`.
3. On 23505 unique constraint race: re-query and return the winner.
4. Always returns `{ shopId }` or **throws** — no silent failures.

### The ONE Exception: pending_oauth upgrade

When `ensureShop` finds an existing active row with `accessToken === "pending_oauth"` and token exchange succeeds, it upgrades the token **in-place** (no new row). This handles the legitimate "token exchange succeeded on second try" case. Do not remove this branch from `ensureShop`.

---

## DO

1. Every admin API route: call `ensureShop()` first.
2. Every redirect + fetch: carry `id_token`.
3. Env-check runs at boot (`lib/env-check.ts` imported from `lib/shopify.ts`). If env wrong, app must not start.
4. Log every auth entry point: `[verifySessionToken]`, `[ensureShop]`, `[AUTH]`, `[provisionShop]`.
5. Match scopes in all 3 locations: `shopify.app.toml`, `lib/shopify.ts`, partner dashboard.
6. Offline tokens only.
7. Soft-delete on uninstall (set `isActive=false`, don't delete row).
8. **Pixel registration must be idempotent.** Query `query { webPixel { id } }` first. If present → `webPixelUpdate`. If not → `webPixelCreate`. Both paths must return the pixel ID.

---

## DON'T

1. **DON'T add a second Shop-creation code path. Ever.** If you feel the urge, extend `provisionShop()`.
2. **DON'T touch ingest endpoints during auth work.** `app/api/pixel/ingest/**`, `app/api/cart/ingest/**`, `app/api/session/ping/**` never use session tokens. Leave alone.
3. **DON'T commit `.vercel/project.json`.** Each dev runs `vercel link` per machine. `.vercel/` is gitignored.
4. **DON'T hardcode `SHOPIFY_APP_URL` in code** — always read from env.
5. **DON'T cache Shop lookups in memory.**
6. **DON'T skip HMAC verify.**
7. **DON'T log raw `SHOPIFY_API_SECRET`** — only first-4 hint (`secret.slice(0, 4)`) for cross-env comparison.
8. **DON'T run `prisma db push` against prod** — use migrations. Partial unique index `Shop_shopDomain_active_unique` is DB-managed (see `prisma/migrations/20260417000000_shop_partial_unique/migration.sql`).
9. **DON'T add feature flags for auth behavior** — one path, always.
10. **DON'T remove the `pending_oauth` upgrade branch in `ensureShop`.**
16. **DON'T call `webPixelCreate` unconditionally.** Extension-declared pixels persist across uninstall/reinstall in Shopify's backend. Always query first and update if present.
11. **DON'T touch `app/api/webhooks/app-uninstalled/route.ts`** — uninstall path is working.
12. **DON'T touch `app/api/webhooks/gdpr/**`** — compliance surface.
13. **DON'T touch billing routes** — out of auth scope.
14. **DON'T touch `lib/session-storage.ts`** — Prisma-backed, working.
15. **DON'T touch any cron job under `app/api/jobs/**`.**

---

## Env Var Contract

| Var | CouponMaxx |
|-----|-----------|
| `SHOPIFY_API_KEY` | ends in `…33b` |
| `SHOPIFY_APP_URL` | `https://couponmaxx.vercel.app` |
| `SHOPIFY_API_SECRET` | from Partner Dashboard |
| `DATABASE_URL` | Supabase pooled connection |
| `DIRECT_URL` | Supabase direct connection |

**Audit quarterly.** Secret mismatch causes silent HMAC fail → `[verifySessionToken] hmac_mismatch secret_hint=XXXX`.

> CheckoutMaxx deployment is out of scope for this bible. See [separate doc] if testing there.

Cold start log always shows: `[env] app=<key-last-4> url=<SHOPIFY_APP_URL>`. Use this to confirm which project is running.

---

## Testing (Sonnet — after any auth change)

```bash
# 1. No divergent insert paths
grep -rn 'from("Shop").insert' app/ lib/      # expect: only lib/provision-shop.ts
grep -rn 'crypto.randomUUID' app/api/auth lib/ensure-shop.ts  # expect: zero hits

# 2. Env check wired
grep -n 'envCheck\|env-check' lib/shopify.ts  # expect: import + call present

# 3. Logging present in verify-session-token
grep -n 'console\.' lib/verify-session-token.ts  # expect: ≥4 hits

# 4. Types + build pass
npm run typecheck
npm run build

# 5. Vercel link file not committed
git ls-files .vercel/   # expect: empty output
```

---

## Testing (User) — CouponMaxx only

**Prerequisite unit tests** — Sonnet runs these, you just verify:
```bash
npm test __tests__/lib/provision-shop.test.ts
npm test __tests__/lib/env-check.test.ts
npm test __tests__/lib/verify-session-token.test.ts
```
All must pass before any Shopify testing.

**Local dev session** — `shopify app dev --config=shopify.app.toml`

> ⚠️ **WARNING:** This CLI command TEMPORARILY REWRITES CouponMaxx's `application_url` in the Shopify Partner Dashboard to a Cloudflare tunnel URL. Risks:
> - Shopify reviewer opening app during your session hits your localhost
> - If laptop sleeps or you SIGKILL the CLI, URL may not restore
> - CouponMaxx could be stuck pointing at dead tunnel URL

Mitigation:
- Run in short windows (20–30 min max)
- Exit with Ctrl+C (clean exit), never kill
- After exit, verify `shopify.app.toml` has `application_url = "https://couponmaxx.vercel.app"`
- Verify Partner Dashboard shows same URL at https://partners.shopify.com
- If URL stuck: run `shopify app deploy` to re-push correct TOML

**Test on a personal dev store — NOT the Shopify review store.**

---

### Test 1 — Fresh install

1. Terminal: tail dev server output.
2. Install CouponMaxx from Partner Dashboard.
3. Expected log sequence:
   - `[env] app=e33b url=https://...` (cold start identity check)
   - `[AUTH] callback fired` OR `[ensureShop] provisioning fresh shop`
   - `[provisionShop] outcome=created`
   - `[pixelRegistration] registered`
4. Supabase: new Shop row, fresh UUID, `isActive=true`, real `accessToken` (not `"pending_oauth"`).

### Test 2 — Uninstall → reinstall within 2 min (the reported bug)

1. Uninstall from Shopify admin. Expect `[UNINSTALL] shop=X outcome=deactivated` logs.
2. Immediately reinstall. Expect same log sequence as Test 1. **New UUID.** Old row `isActive=false`.
3. Admin page: zero stale data.

### Test 3 — Deliberate env break (catches silent failure)

1. Temporarily set `SHOPIFY_API_SECRET` to `"wrong"` in local `.env`.
2. Restart dev server. Expect boot throw: `[env-check] MISSING or placeholder: SHOPIFY_API_SECRET`.
3. Revert env var.

### Test 4 — Prod push

1. Unit tests green + Tests 1–2 green → push to CouponMaxx Vercel project during low-traffic window.
2. Vercel logs first request: confirm `[env] app=e33b url=https://couponmaxx.vercel.app`.
3. If wrong last-4 or wrong URL logged → **rollback in Vercel dashboard immediately**.
4. Install on personal dev store (NOT review store). Repeat Tests 1–2 against deployed URL.
5. If green → stop. Do not touch.

If Test 4 fails: rollback, fix, restart from Test 1.

---

## Debug Playbook

| Symptom | First log to grep | Likely cause |
|---------|------------------|--------------|
| "Shop not found" on admin UI | `[ensureShop] shop=X` | `id_token` missing from fetch or HMAC failing |
| Admin shows stale data | `[provisionShop] outcome=created` | Didn't fire — callback short-circuited |
| 2 installs in Shopify, 0 in DB | `[verifySessionToken] hmac_mismatch` | `SHOPIFY_API_SECRET` wrong for this Vercel project |
| Uninstall didn't stick | `[UNINSTALL]` | Webhook HMAC fail — check secret |
| Pixel doesn't fire | `[pixelRegistration]` | `accessToken = pending_oauth` — token exchange failed |
| App won't boot at all | `[env-check]` | Missing env var — check Vercel project settings |
| `[ensureShop:bg] Pixel registration failed: settings already set` | `[registerAppPixel]` | Old code. Check `lib/pixel-registration.ts` uses update-or-create pattern. |

---

## Past Bugs (never regress)

- `8c9da2e`: callback was reusing old Shop on reinstall → stale data. Fixed by `provisionShop` deactivate-all.
- `909e09b`: `ensureShop` had in-memory cache → served stale shop after uninstall. Removed.
- **2026-04-17**: `auth/callback` and `ensureShop` used divergent Shop-creation algorithms. Callback could obliterate a valid row `ensureShop` just built. Fixed by `provisionShop` as single canonical path.
- **2026-04-17**: `shopRecord.pixelId` in callback background work was always `null` — pixel deregistration never fired on reinstall. Fixed by capturing `oldPixelId` before `provisionShop` call.

---

## File Map

| File | Role |
|------|------|
| `lib/provision-shop.ts` | THE canonical Shop creation function |
| `lib/ensure-shop.ts` | Session-token verify + token exchange → calls provisionShop |
| `app/api/auth/callback/route.ts` | OAuth callback → calls provisionShop |
| `lib/verify-session-token.ts` | JWT verify with logging |
| `lib/env-check.ts` | Boot-time env validator |
| `lib/shopify.ts` | Shopify SDK init; imports envCheck |
| `app/api/webhooks/app-uninstalled/route.ts` | Sets isActive=false — DO NOT TOUCH |
| `prisma/migrations/20260417000000_shop_partial_unique/migration.sql` | Partial unique index for Shop table |
