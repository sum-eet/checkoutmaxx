# Plan: Polish + Analytics + Sessions Page + Notifications

## Context

Claim button on checkout works (static-code flow, couponmaxx-23 released). User wants pre-submission polish pass:

1. **Checkout Claim UX bug** — after successful apply, banner auto-dismisses after 5s and Claim button re-appears. Should disappear permanently for the session.
2. **Checkout Claim UI** — currently plain, make it subtle + slightly premium.
3. **Storefront cart banner (smart-recovery)** — currently works (theme extension, has fetch), polish to "liquid glass" aesthetic.
4. **Admin Discounts page** — minimal: today/week claim counts + recent claims list. Uses existing `RecoveryEvent` table.
5. **Admin Sessions page** — pre-strip version was 1092 lines with complex filters. Rebuild a SIMPLIFIED version: sessions table with coupon attempts + outcomes. No charts, no filters, no KPI grid.
6. **Notifications** — merged into Discounts page (unread-claim indicator in nav). Don't build separate notifications page — deferred.

Ship all before Shopify submit per user decision.

## Decisions locked

- Checkout success: banner stays permanently, Claim button never re-appears this session
- Cart storefront banner: upgrade CSS (liquid glass)
- Admin nav: Diagnostics / Sessions / Discounts (3 tabs)
- Analytics scope: counts + recent events, no charts
- Sessions scope: simplified list, no date picker, no complex filters — default to last 7 days
- Reuse existing `RecoveryEvent` + `CartEvent` + `CheckoutEvent` tables — already in rebuilt Prisma schema
- Do not restore `session-utils`, `compute-baselines`, `DateRangePicker` — those were stripped deliberately. Rebuild sessions logic lean.

## Files to modify / create

### Checkout extension
- `extensions/checkout-recovery/src/Checkout.jsx` — remove 5s auto-dismiss timer; keep success state terminal; subtle UI tweaks

### Theme extension
- `extensions/cart-monitor/assets/smart-recovery.css` — rewrite for liquid-glass look (backdrop-filter, translucent bg, soft border)

### Admin layout + nav
- `app/(embedded)/couponmaxx/layout.tsx` — add top nav with 3 tabs (Diagnostics / Sessions / Discounts). Unread-claim dot on Discounts tab.

### New admin pages
- `app/(embedded)/couponmaxx/discounts/page.tsx` — claim analytics (counts + recent list)
- `app/(embedded)/couponmaxx/sessions/page.tsx` — simplified cart sessions list

### New API routes
- `app/api/couponmaxx/claims/route.ts` — counts (today/week) + last 50 RecoveryEvent rows for shop
- `app/api/couponmaxx/sessions/route.ts` — last 7 days of CartEvent rows grouped by sessionId + joined with CheckoutEvent

### Health + diagnostics (touch-up)
- `app/api/couponmaxx/health/route.ts` — already returns what's needed
- `app/(embedded)/couponmaxx/diagnostics/page.tsx` — no change

---

## Phase A — Checkout extension (claim hide + subtle UI)

### `extensions/checkout-recovery/src/Checkout.jsx`

Change 1 — delete success auto-dismiss useEffect:

```jsx
// DELETE this block:
useEffect(() => {
  if (state !== 'success') return;
  const t = setTimeout(() => {
    if (mountedRef.current) setState('idle');
  }, 5000);
  return () => clearTimeout(t);
}, [state]);
```

Success state becomes terminal. Once `success`, component stays on success banner for rest of checkout session.

Change 2 — failed state should also not auto-revert. User clicks Claim → fails → banner stays. Currently failed has no auto-dismiss, fine.

Change 3 — subtle UI. Use `padding`, smaller text, `tone="subdued"`. Polaris checkout components limited; can't do real glass. Achievable:
- Wrap idle row in `<View border="base" padding="base" cornerRadius="base">` for a soft card look
- Dim text color with `tone="subdued"` (already in place)
- Use `Button` variant `plain` instead of `secondary` for softer look
- Reduce emphasis via smaller typography if available

Final idle render (drop-in):

```jsx
import { View } from '@shopify/ui-extensions-react/checkout';
// add View to imports

// ...

return (
  <View border="base" cornerRadius="base" padding="base">
    <InlineStack spacing="tight" blockAlignment="center" inlineAlignment="space-between">
      <Text size="small" tone="subdued">Looking for a discount?</Text>
      <Button
        kind="plain"
        appearance="monochrome"
        onPress={handleClaim}
        loading={state === 'applying'}
        disabled={state === 'applying'}
      >
        Claim
      </Button>
    </InlineStack>
  </View>
);
```

Note: `View` + `kind="plain"` + `appearance="monochrome"` are Checkout UI props. Verify in @shopify/ui-extensions-react/checkout exports. If unavailable, fall back to `Button variant="secondary"` + `BlockStack` wrapper. Sonnet: check the types; adjust if compile errors.

### Deploy
```bash
shopify app config use shopify.app.toml
shopify app deploy --force --message "checkout-ext polish + claim-persist-after-success"
```

---

## Phase B — Cart storefront liquid-glass CSS

### `extensions/cart-monitor/assets/smart-recovery.css`

Replace entire file with glass aesthetic. Keep class names identical (`.cmx-recovery-active`, `.cmx-code-pill`, `.cmx-style-*`) so JS selectors stay valid.

```css
/* CouponMaxx Smart Recovery — liquid-glass */

.cmx-recovery-active {
  margin-top: 10px;
  padding: 14px 18px;
  font-size: 13px;
  line-height: 1.5;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 14px;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 4px 20px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  color: #1a1a1a;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.cmx-recovery-active:hover {
  transform: translateY(-1px);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 8px 28px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
}

.cmx-code-pill {
  display: inline-block;
  margin: 0 6px;
  padding: 4px 10px;
  background: linear-gradient(180deg, #1f1f1f 0%, #0d0d0d 100%);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: 'SF Mono', Menlo, monospace;
  letter-spacing: 0.5px;
  cursor: pointer;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.05) inset,
    0 2px 6px rgba(0, 0, 0, 0.12);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  vertical-align: baseline;
}
.cmx-code-pill:hover {
  transform: translateY(-1px);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.05) inset,
    0 4px 10px rgba(0, 0, 0, 0.18);
}
.cmx-code-pill:active { transform: translateY(0); }

/* Minimal — translucent coral tint */
.cmx-style-minimal { color: #8c2a2a; }
.cmx-style-minimal .cmx-code-pill {
  background: linear-gradient(180deg, #29a46c 0%, #1c7a4d 100%);
}

/* Warm */
.cmx-style-warm {
  background: rgba(254, 249, 239, 0.7);
  border: 1px solid rgba(240, 221, 160, 0.45);
  color: #5c4813;
}

/* Green */
.cmx-style-green {
  background: rgba(240, 250, 244, 0.7);
  border: 1px solid rgba(184, 230, 200, 0.45);
  color: #1a5c32;
}
```

Theme extension is published via `shopify app deploy` along with checkout-recovery above — no separate deploy step. Storefront picks up new CSS on next page load (cache-busted by Shopify asset hashing).

---

## Phase C — Admin nav shell

### `app/(embedded)/couponmaxx/layout.tsx`

Inject `<Tabs>` below the page title, 3 tabs, active state tracked via `usePathname`. Use Polaris `Tabs`. Preserve existing AppProvider / frame.

Sketch:
```tsx
'use client';
import { Tabs } from '@shopify/polaris';
import { usePathname, useRouter } from 'next/navigation';

const TABS = [
  { id: 'diagnostics', label: 'Diagnostics', href: '/couponmaxx/diagnostics' },
  { id: 'sessions',    label: 'Sessions',    href: '/couponmaxx/sessions' },
  { id: 'discounts',   label: 'Discounts',   href: '/couponmaxx/discounts' },
];

export default function Layout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const selected = Math.max(0, TABS.findIndex(t => pathname?.startsWith(t.href)));
  return (
    <>
      <div style={{ padding: '0 16px' }}>
        <Tabs
          tabs={TABS.map((t, i) => ({ id: t.id, content: t.label, accessibilityLabel: t.label, panelID: `p-${t.id}` }))}
          selected={selected}
          onSelect={(i) => router.push(TABS[i].href + (typeof window !== 'undefined' ? window.location.search : ''))}
        />
      </div>
      {children}
    </>
  );
}
```

Preserve search params (id_token) when switching tabs — critical for embedded auth.

Unread badge on Discounts tab: phase 2 nice-to-have. Skip for initial ship if it complicates. Can show count from `/api/couponmaxx/claims?today=true`.

---

## Phase D — Discounts page (analytics + claims feed)

### `app/api/couponmaxx/claims/route.ts` (NEW)

```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAuthenticatedShop } from "@/lib/verify-session-token";
import { getShop } from "@/lib/shop";

export async function GET(req: NextRequest) {
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shop = await getShop(shopDomain);
  if (!shop) return NextResponse.json({ error: "No shop" }, { status: 400 });

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 7);

  const [todayCountRes, weekCountRes, recentRes] = await Promise.all([
    supabase.from("RecoveryEvent").select("*", { count: "exact", head: true })
      .eq("shopId", shop.id).eq("recoveryAction", "show_code")
      .gte("createdAt", todayStart.toISOString()),
    supabase.from("RecoveryEvent").select("*", { count: "exact", head: true })
      .eq("shopId", shop.id).eq("recoveryAction", "show_code")
      .gte("createdAt", weekStart.toISOString()),
    supabase.from("RecoveryEvent")
      .select("id, recoveryCode, failureReason, source, cartValueAtFailure, discountValue, discountType, device, createdAt")
      .eq("shopId", shop.id).eq("recoveryAction", "show_code")
      .order("createdAt", { ascending: false }).limit(50),
  ]);

  return NextResponse.json({
    counts: {
      today: todayCountRes.count ?? 0,
      week: weekCountRes.count ?? 0,
    },
    recent: recentRes.data ?? [],
  });
}
```

### `app/(embedded)/couponmaxx/discounts/page.tsx` (NEW)

Two sections:
1. Top row: two KpiBox-style tiles — "Claims today: N", "Claims this week: N"
2. Table: last 50 claims. Columns: timestamp, code, source (cart_coupon_failed / checkout_claim), device, cart value, discount (% or $)

Use Polaris `Card`, `IndexTable` or simple table. No date picker, no filters.

Re-use `Text`, `Badge`, `Card`, `InlineStack`, `BlockStack` from Polaris. Fetcher pattern from `diagnostics/page.tsx` (id_token enrichment).

---

## Phase E — Sessions page

### `app/api/couponmaxx/sessions/route.ts` (NEW)

Returns last 7 days of sessions for shop, derived from CartEvent grouped by sessionId.

```ts
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAuthenticatedShop } from "@/lib/verify-session-token";
import { getShop } from "@/lib/shop";

export async function GET(req: NextRequest) {
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shop = await getShop(shopDomain);
  if (!shop) return NextResponse.json({ error: "No shop" }, { status: 400 });

  const since = new Date(); since.setDate(since.getDate() - 7);

  // Pull cart events
  const { data: cartRows } = await supabase
    .from("CartEvent")
    .select("sessionId, eventType, couponCode, couponSuccess, cartValue, device, country, occurredAt")
    .eq("shopId", shop.id)
    .gte("occurredAt", since.toISOString())
    .order("occurredAt", { ascending: true })
    .limit(2000);

  // Group by sessionId
  const bySession = new Map<string, any>();
  for (const r of cartRows ?? []) {
    if (!bySession.has(r.sessionId)) {
      bySession.set(r.sessionId, {
        sessionId: r.sessionId,
        startedAt: r.occurredAt,
        lastSeenAt: r.occurredAt,
        device: r.device,
        country: r.country,
        cartValue: r.cartValue ?? 0,
        couponAttempts: [],
        reachedCheckout: false,
        completed: false,
      });
    }
    const s = bySession.get(r.sessionId);
    s.lastSeenAt = r.occurredAt;
    if (r.cartValue) s.cartValue = r.cartValue;
    if (r.eventType === "cart_coupon_applied" || r.eventType === "cart_coupon_failed") {
      s.couponAttempts.push({ code: r.couponCode, success: r.couponSuccess, at: r.occurredAt });
    }
    if (r.eventType === "cart_checkout_clicked") s.reachedCheckout = true;
  }

  // Join with CheckoutEvent to detect completion
  const sessionIds = Array.from(bySession.keys()).slice(0, 200);
  if (sessionIds.length) {
    const { data: coRows } = await supabase
      .from("CheckoutEvent")
      .select("sessionId, eventType")
      .eq("shopId", shop.id)
      .in("sessionId", sessionIds);
    for (const r of coRows ?? []) {
      const s = bySession.get(r.sessionId);
      if (!s) continue;
      if (r.eventType === "checkout_started") s.reachedCheckout = true;
      if (r.eventType === "checkout_completed") s.completed = true;
    }
  }

  const sessions = Array.from(bySession.values())
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
    .slice(0, 100);

  return NextResponse.json({ sessions });
}
```

### `app/(embedded)/couponmaxx/sessions/page.tsx` (NEW)

Simple table. Columns: started at, device+country, cart value, coupon attempts (count + first code), status (Abandoned / Checkout started / Completed). No row click panel in v1 — can add later.

Use Polaris `Card` + basic table. ~120 lines.

---

## Phase F — Deploy + verify

1. Typecheck: `npx tsc --noEmit` — zero errors required
2. Commit:
   ```
   phase-6: checkout hide-claim-after-success + cart glass CSS + sessions + discounts pages
   ```
3. Push: `git push origin rebuild-minimal` — Vercel auto-deploys
4. `shopify app deploy --force` to ship extension changes (checkout + cart CSS)
5. Release new version in Partners

### Manual verification on 20aprtest

1. Hard-reload checkout → claim button visible, subtle bordered look
2. Click Claim → code applies → success banner stays → no Claim button re-appears
3. Storefront cart: enter invalid coupon → smart-recovery banner appears with new glass style
4. Admin → Diagnostics tab loads
5. Admin → Sessions tab → see last 7 days of sessions with coupon attempts
6. Admin → Discounts tab → see claim counts + recent claims
7. Submit to Shopify

## DO NOT

- Do NOT reintroduce `session-utils`, `DateRangePicker`, `KpiBox`, `LineChartInCard`, `compute-baselines` etc. Those were stripped deliberately — rebuild lean.
- Do NOT add slack/klaviyo/email/cron code back.
- Do NOT add date picker to new pages — fixed 7-day window.
- Do NOT add charts / recharts — tables only.
- Do NOT restore any deleted `app/(embedded)/couponmaxx/*` pages wholesale from pre-strip commits. Write fresh.
- Do NOT add `network_access` to extension toml — release gets blocked until submission approved.
- Do NOT break diagnostics page — only add nav around it.
- Do NOT run `shopify app dev` — single `shopify app deploy` only.

## Rollback

- UI extension: Partners → Versions → release prior `couponmaxx-23` (static-code version).
- Web app: Vercel → promote previous deployment.

## Ship order

1. Phase A (checkout fix) — lowest risk, visible immediately
2. Phase B (cart CSS) — co-deploys with A
3. Phase C (admin nav) — frontend only
4. Phase D (discounts API + page)
5. Phase E (sessions API + page)
6. Phase F (test, deploy, submit)

One commit per phase acceptable; combined commit also fine if each compiles cleanly.

## Out of scope (defer to v1.1)

- Unread-claim badge count on nav
- Session detail side panel (click row)
- CSV export
- Date range picker
- Charts
- Notifications inbox page
- Per-code analytics drill-in
- Merchant rules config page (recovery settings UI)
