# Sonnet Rewrite Prompt — Phase 3 (Auth + Pixel + Compliance)

**Paste everything below the `---` into Sonnet. Nothing above.**

---

You are executing a full rewrite of the Shop-row lifecycle and pixel registration in this Shopify app. Four days of patches have failed. Stop patching. Rewrite to the spec.

## Your source of truth

`docs/AUTH-AND-PIXEL-V3.md`. Read it end-to-end before you touch any code. Every decision you make must align with it. If the spec and your instinct disagree, the spec wins — re-read the "What this spec explicitly forbids" section.

## Scope

You are writing:

1. `supabase/create-shop.sql` — the atomic RPC (per spec)
2. `lib/shop.ts` — new module with `getShop`, `createShop`, `upgradeToken` (per spec)
3. `lib/pixel.ts` — new module with `ensurePixel`, `deletePixel` (per spec)
4. `lib/verify-session-token.ts` — split `getShopFromRequest` into `getAuthenticatedShop` (no `?shop` fallback) + `getShopFromPublicRequest` (per compliance Fix 1)
5. `app/api/auth/callback/route.ts` — rewrite per spec, linear + `waitUntil`
6. Repoint imports across every file that currently uses `ensureShop`, `provisionShop`, `getActiveShop`, `registerAppPixel`, `deregisterAppPixel`, `isTruthyActive`, or `getShopFromRequest`
7. DELETE: `lib/ensure-shop.ts`, `lib/provision-shop.ts`, `lib/get-active-shop.ts`, `lib/is-active.ts`, `lib/pixel-registration.ts`

Everything else stays untouched — see the "Files NOT TOUCHED" section of the spec.

## Non-negotiable rules

1. **One commit.** All changes above land together or none do. No shim files, no parallel old/new code paths.
2. **`npx tsc --noEmit` must pass.** Pre-existing `__tests__/` errors are OK. Any new error in `app/` or `lib/` is a bug you fix before finishing.
3. **No new exports beyond what the spec lists.** If you catch yourself writing a helper that sounds like `ensureActiveShop`, `findOrCreateShop`, `resolveShop`, etc. — stop. The spec forbids it.
4. **No caching layer** in front of `getShop`. No `shopCache` Map, no Redis, nothing. The indexed query is fast enough.
5. **No try/catch swallowing** in `createShop` beyond 23505 race handling. If the DB is down, let it throw — the caller returns 500.
6. **`ensurePixel` NEVER throws.** Returns `string | null`. One retry max.
7. **`waitUntil` from `@vercel/functions`** is the only background-work primitive. No bare `.catch(() => {})` promises after `return NextResponse.*`.
8. **Do NOT commit.** Sumeet commits.
9. **Do NOT run any Supabase SQL yourself.** Produce the SQL file; Sumeet runs it.
10. **Do NOT modify** `extensions/**`, `app/api/couponmaxx/cx/route.ts` logic (imports only), `app/api/cart/ingest/route.ts` logic (imports only + swap to `getShopFromPublicRequest`), `app/api/pixel/ingest/route.ts` logic (imports only + swap to `getShopFromPublicRequest`), or any admin UI page.

## Order of work

1. **Read `docs/AUTH-AND-PIXEL-V3.md` fully.** Bookmark it mentally.
2. **Write `supabase/create-shop.sql`** (exactly as specified in the spec).
3. **Write `lib/shop.ts`** with the three functions. Use `@supabase/supabase-js` call `.rpc('create_shop', ...)` for `createShop`. Handle the 23505 race-loser case by re-reading and returning the winner's id.
4. **Write `lib/pixel.ts`** with `ensurePixel` and `deletePixel`. Follow the pixel state machine in the spec exactly. No extra retry.
5. **Split `lib/verify-session-token.ts`**: keep `verifySessionToken` untouched; rename `getShopFromRequest` → `getAuthenticatedShop` (strip the final `?shop` fallback); add a new `getShopFromPublicRequest` that does the body/URL extraction WITHOUT token verification.
6. **Rewrite `app/api/auth/callback/route.ts`** per spec. Structure: verify HMAC → exchange → store session → `createShop` → `waitUntil(Promise.all([ensurePixel+pixelId update, registerWebhooks]))` → redirect. Delete the `oldShop` lookup block. Delete the old `backgroundWork` function.
7. **Repoint every caller.** Grep for each deleted symbol. Use the migration pattern in the spec's "Caller migration" section.
8. **Delete the 5 old files.** Do NOT leave re-export shims.
9. **Run `npx tsc --noEmit`.** Fix every new error in `app/` or `lib/`.
10. **Run these verification greps** (must all return zero results in `app/` and `lib/`, excluding the deleted files themselves):
    ```
    grep -rn 'ensureShop\|provisionShop\|getActiveShop\|isTruthyActive\|registerAppPixel\|deregisterAppPixel' app/ lib/
    grep -rn 'getShopFromRequest' app/ lib/     # should only find the definition site
    grep -rn '\.eq("isActive", true)' app/ lib/ # only the uninstall webhook may keep this
    grep -rn 'shopCache' app/ lib/              # must be zero
    ```

## Report back to Sumeet with

1. Confirm `npx tsc --noEmit` result (paste any `app/`/`lib/` errors; zero is the goal).
2. Paste the output of the four verification greps above.
3. Paste the full final contents of `lib/shop.ts` and `lib/pixel.ts`.
4. Paste the full final contents of the rewritten `app/api/auth/callback/route.ts`.
5. List every file whose imports you repointed (one line each: `path — which symbol(s) swapped`).
6. List the files you deleted.
7. Paste the full `supabase/create-shop.sql` content ready for Sumeet to run in Supabase.
8. Remind Sumeet of the two verify-only compliance items (billing plan listing match + `subscriptionStatus` column default).

Do NOT report back until ALL items above are green.

## If you get stuck

- If a caller uses some old pattern not covered by the migration guide (e.g. it does token-exchange inside the route), preserve its behaviour by calling `getShop` + `upgradeToken` in the route, NOT by smuggling logic back into `lib/shop.ts`.
- If a Supabase call returns an unexpected shape, log and return null — don't invent a parse.
- If the spec is genuinely ambiguous on a specific line of code, STOP and ask Sumeet. Do not guess.

## Out of scope (do NOT touch, even if tempted)

- Read-replica lag investigation (deferred).
- Historical event migration (deferred).
- IngestLog fetch failure (separate bug).
- `read_themes` scope change (requires new Shopify review).
- Any UI text changes.
- The extension (`extensions/checkout-recovery/**`).
- Cleaning up `scripts/check-funnel.ts` (cosmetic, post-submission).

After you finish and Sumeet commits + pushes + deploys, Sumeet will:
- Run `supabase/create-shop.sql` in Supabase.
- On test store: uninstall, `DELETE FROM "Shop" WHERE "shopDomain" = 'testingstoresumeet.myshopify.com'`, reinstall.
- Verify diagnostics green + Fire test pixel + Fire test claim.
- Submit to Shopify.

That's the endgame. Your rewrite makes it possible.
