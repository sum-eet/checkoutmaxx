# Storefront Verification — Submission Runbook

## Context

`rebuild-minimal` branch live on `couponmaxx.vercel.app`. Auth/install/uninstall/reinstall fully verified. Diagnostics page working. This doc covers the remaining tests before Partners submission.

**Test store:** `20aprtest.myshopify.com`
**Shop id:** `2b92bc40-ead9-4c4d-a33f-8693f230ad81`
**App client:** `ef34a3eb07ec4333b42d63385823433b`

**Workflow constraint:** no dev tunneling. Everything runs against prod `couponmaxx.vercel.app`. Diagnose from Vercel runtime logs only.

---

## One-time setup (Sumeet)

Before storefront testing, confirm extensions are live on 20aprtest:

1. **Web pixel** — Admin → Settings → Customer events → CouponMaxx shows `Connected`. If missing, reinstall app first.
2. **Cart monitor** — Admin → Online Store → Themes → Customize → App embeds → toggle `CouponMaxx cart-monitor` ON → Save.
3. **Checkout extension** — Admin → Settings → Checkout → Customize → Add app block → `checkout-recovery` → place after discount field → Save.

---

## Test 1 — Cart events

Open `https://20aprtest.myshopify.com` in incognito (no ad-blockers). Keep Vercel logs open.

**Steps:**
1. Add any product to cart
2. Open cart page
3. Try applying an invalid coupon code

**Expected Vercel logs:**
```
[cart/ingest] ok shop=20aprtest.myshopify.com event=cart_item_added
[cart/ingest] ok shop=20aprtest.myshopify.com event=cart_coupon_failed
```

**Verify DB:**
```sql
SELECT "eventType", count(*), max("occurredAt") AS last
FROM "CartEvent"
WHERE "shopId" = '2b92bc40-ead9-4c4d-a33f-8693f230ad81'
GROUP BY 1 ORDER BY last DESC;
```

---

## Test 2 — Checkout pixel events

**Steps:**
1. Add product → proceed to checkout
2. Fill email → continue (don't need to complete purchase)

**Expected Vercel logs:**
```
[pixel/ingest] ok shop=... event=checkout_started
```

**Verify DB:**
```sql
SELECT "eventType", count(*), max("occurredAt") AS last
FROM "CheckoutEvent"
WHERE "shopId" = '2b92bc40-ead9-4c4d-a33f-8693f230ad81'
GROUP BY 1 ORDER BY last DESC;
```

---

## Test 3 — Checkout claim button

Extension renders "Looking for a coupon? Claim it →" below the discount field at checkout.

### 3a — Claim button (proactive)

At checkout, click **"Claim it →"**. Expected:
- Spinner → discount auto-applied OR recovery code shown
- Vercel log: `[CMX] checkout_claim: generated code <CODE> for shop 20aprtest.myshopify.com`
- Shopify admin → Discounts → new code `SAVE-XXXX` with 10% off, 1-use limit

**Verify DB:**
```sql
SELECT "recoveryCode", "source", "discountValue", "createdAt"
FROM "RecoveryEvent"
WHERE "shopId" = '2b92bc40-ead9-4c4d-a33f-8693f230ad81'
ORDER BY "createdAt" DESC LIMIT 5;
```

### 3b — Failed code flow

Type `BADCODE123` in discount field → Apply → code fails → extension should offer recovery code.

### 3c — If claim button not visible

Extension may need deploying. Run from repo root:
```bash
shopify app config use shopify.app.toml
shopify app deploy
```
Then re-enable block in checkout editor.

---

## Test 4 — GDPR webhooks

Partners dashboard → App `couponmaxx` → API access → GDPR mandatory webhooks → Send test notification for each:

| Webhook | Expected log | Expected status |
|---|---|---|
| `customers/data_request` | `[webhook] customers/data-request` | 200 |
| `customers/redact` | `[webhook] customers/redact` | 200 |
| `shop/redact` | `[webhook] shop/redact` | 200 |

---

## Test 5 — Diagnostics final check

After Tests 1–4, open app in Shopify admin. Expected:

| Row | Expected |
|---|---|
| Shop installed + active | Green |
| Has access token | Yes |
| Has pixel ID | Yes |
| Pixel events | Green |
| Cart events | Green |
| Last claim code generated | Green + code |

---

## Test 6 — Stale webhook race guard

1. Uninstall from Shopify admin
2. Reinstall immediately: `/api/auth/begin?shop=20aprtest.myshopify.com`
3. Wait 2–5 min for delayed uninstall webhook

Expected log:
```
[UNINSTALL] stale webhook — installedAt(...) > triggered(...), skip
```
Shop stays `isActive=true`.

---

## Failure playbook

| Symptom | Cause | Fix |
|---|---|---|
| No `[cart/ingest]` logs | Cart monitor app embed not enabled | Enable in theme customize → App embeds |
| `[cart/ingest] shop not found` | Shop row inactive | Reinstall app |
| No `[pixel/ingest]` logs | Web pixel not connected or ad-blocker | Check Customer events, use incognito |
| `[CX] show_nothing reason=rate_limited` | Same session hit claim twice within 10min | New incognito session |
| Claim button not visible | checkout-recovery block not added | Checkout editor → add block |

---

## Submit

Once all tests pass:

1. Partners dashboard → CouponMaxx → Submit for review
2. Metadata unchanged — no re-entry needed

**Post-approval merge:**
```bash
git checkout couponmaxx-submission
git merge rebuild-minimal
git push
```
