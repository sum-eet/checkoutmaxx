# CheckoutGuard — Full Build Specification
> Version 1.1 | MVP | 30-day build target
> Updated: pressure-tested against Checkout Pulse reviews, API docs confirmed, ICP tightened.

---

## Positioning (Read Before Everything Else)

**Category:** Checkout monitoring and alerts. Not analytics. Not CRO. Not optimization.
Say "monitoring" every time. Never say "optimize."

**ICP:** Shopify stores doing **$10k–$500k/month GMV** on non-Plus plans.
- Below $10k/month = not enough checkout volume for reliable baselines (under ~200 checkout_started events/month). Product cannot generate meaningful alerts. Do not target.
- Above $500k/month = likely on Plus, Checkout Pulse's territory, different budget tier.
- Sweet spot: DTC brands, 1–10 person teams, running paid ads, actively promoting discounts.

**Why monitoring alone is worth $49:**
Checkout Pulse charges $195 for pure monitoring and has paying customers. Monitoring is insurance, and people pay for insurance without needing to use it. The psychological value is: *I will know before my customers do.*

**Why your alerts must include the fix, not just the diagnosis:**
Checkout Pulse's customers are Plus merchants with dedicated CRO teams who know what to do with an alert. Your customers are solo founders and small teams. An alert that says "abandonment spike at payment step" with no next step gets ignored. Every alert in this product must include:
1. What broke (the signal)
2. Why it probably broke (probable cause, 1 sentence)
3. What to do right now (exact action + deep link into Shopify admin where possible)

This is the product difference vs Checkout Pulse. Same monitoring. Smarter alerts.

**Deep-link pattern for all alerts:**
- Discount code issue → `https://{shop}/admin/discounts/{discount_id}`
- Extension error → `https://{shop}/admin/apps`  
- Payment gateway → `https://{shop}/admin/settings/payments`
- Shipping issue → `https://{shop}/admin/settings/shipping`

---

## Part 1: What We Promise (User Stories)

### The One-Line Promise
> "Install in 60 seconds. Know the moment your checkout breaks — and exactly how to fix it."

---

### User Stories

**US-01 — Instant install**
```
As a Shopify store owner,
After installing the app and clicking "Enable Monitoring",
I want the app to be fully active within 60 seconds,
So that I don't need a developer, don't touch any code, and don't configure anything complex.

Acceptance criteria:
- OAuth install flow completes in under 5 steps
- App Pixel is registered automatically on install
- Merchant sees "Your store is now being monitored" confirmation screen
- Zero theme edits required
- Works on Basic, Grow, Advanced, and Plus Shopify plans
```

**US-02 — Live checkout funnel**
```
As a store owner,
After my first 10 checkout events have been received,
I want to see a visual funnel showing exactly where customers drop off,
So that I know which checkout step is leaking revenue right now.

Acceptance criteria:
- Funnel shows 5 steps: Cart → Contact → Shipping → Payment → Complete
- Each step shows: sessions entered, sessions dropped, drop-off %
- Funnel updates with a maximum 60-second delay
- Filterable by: last 24h / 7d / 30d
- Filterable by: device type (mobile / desktop), country
```

**US-03 — Abandonment spike alert**
```
As a store owner,
When my checkout abandonment rate rises more than 20% above my 7-day baseline,
I want to receive an alert via email and/or Slack within 5 minutes,
So that I can investigate and fix the issue before it costs me significant revenue.

Acceptance criteria:
- Baseline is computed from rolling 7-day average completion rate
- Alert fires when current 1-hour window drops >20% below baseline
- Alert contains: current CVR, baseline CVR, estimated lost revenue, which step the drop is concentrated at
- Alert contains a direct link to the dashboard
- Alert contains a "probable cause" line: e.g. "Drop is concentrated at Payment step on mobile — 
  possible payment gateway issue or slow-loading payment extension."
- No alert fires during the first 48h (insufficient baseline data — silent learning period shown in UI)
- Max 1 alert per 2-hour window to prevent spam

Example alert body:
  "Your checkout completion rate dropped to 31% (normally 58%). Drop concentrated at: Payment step.
   Most affected: Mobile users (76% of failures).
   Estimated revenue at risk: ~$840 this hour.
   Probable cause: Payment gateway issue or broken checkout extension on mobile.
   → Check your payment settings: https://{shop}/admin/settings/payments
   → Check active checkout apps: https://{shop}/admin/apps"
```

**US-04 — Failed discount code alert**
```
As a store owner,
When a customer attempts to use a discount code at checkout and receives an error,
I want to be alerted within 5 minutes with the code that failed,
So that I can fix or deactivate the broken promotion immediately.

Technical note: Detected via alert_displayed Web Pixel event. Shopify emits type: 'DISCOUNT_ERROR'
as a named enum when a discount code fails — this is clean, not inferred.

Acceptance criteria:
- Detection via alert_displayed event where type === 'DISCOUNT_ERROR'
- Alert contains: discount code string, number of failures in last hour, direct link to edit the code
- Alert fires after 3+ failures of the same code within a 1-hour window (to filter noise)
- Dashboard shows failed codes log with timestamps
- Alert deep-links directly to the discount in Shopify admin

Example alert body:
  "Your discount code WELCOME10 has failed 14 times in the last hour.
   Customers are trying to use it and being rejected at checkout.
   Probable cause: Code may be expired, usage limit reached, or minimum order not met.
   → Edit this discount now: https://{shop}/admin/discounts/{id}"
```

**US-05 — Broken extension alert**
```
As a store owner,
When a checkout UI extension (upsell, gift, custom field) throws an error,
I want to be alerted immediately,
So that I can contact the app developer or disable the extension before it disrupts purchases.

Acceptance criteria:
- Detection via ui_extension_errored Web Pixel event
- Alert contains: extension name/ID, error message, number of affected sessions
- Fires after first occurrence (not batched — extension errors are always critical)
- Alert deep-links to the app that owns the extension

Example alert body:
  "A checkout extension is throwing errors and may be disrupting purchases.
   Extension: Bold Upsell (3 sessions affected in last 5 minutes)
   Error: 'Cannot read property price of undefined'
   → Disable or contact the app developer: https://{shop}/admin/apps"
```

**US-06 — Payment failure spike alert**
```
As a store owner,
When an unusually high number of customers submit payment info but do not complete the order,
I want to receive an alert,
So that I can check whether my payment gateway has an issue.

Acceptance criteria:
- Detected by: payment_info_submitted events without a following checkout_completed within 10 minutes
- Alert fires when payment failure rate exceeds 15% in any 30-minute window
- Alert contains: failure count, affected payment gateways if identifiable, time window
- Alert deep-links to payment settings + suggests checking gateway status page

Example alert body:
  "22% of payment attempts in the last 30 minutes did not complete (11 of 50).
   Most affected gateway: Stripe.
   Probable cause: Payment gateway outage or card validation issue.
   → Check your payment settings: https://{shop}/admin/settings/payments
   → Check Stripe status: https://status.stripe.com"
```

**US-07 — Weekly digest**
```
As a store owner,
Every Monday at 9am (merchant's timezone),
I want to receive a weekly email summary of my checkout health,
So that I have a baseline understanding of performance even when nothing is broken.

Acceptance criteria:
- Email contains: avg checkout CVR for the week, comparison to prior week, top drop-off step, 
  any alerts that fired during the week, and one "suggested focus" based on the data
- Unsubscribable from within the email
- Timezone set during onboarding
```

**US-08 — Alert channel configuration**
```
As a store owner,
I want to configure where I receive alerts (email and/or Slack),
So that I get notified through the tools I actually use.

Acceptance criteria:
- Email: pre-filled from Shopify account email, editable
- Slack: webhook URL input with a test button
- WhatsApp: phone number input (MVP: via Twilio, optional/later)
- Each alert type can be toggled on/off independently
- Changes saved immediately, no publish step
```

---

## Part 2: Technical Build Specification

### Stack Decision (Guardrails — Do Not Deviate)

```
Frontend:       Next.js 14 (App Router) — Shopify App Bridge 4.x embedded app
Backend:        Next.js API routes (same repo)
Database:       Supabase (Postgres) — managed, fast setup, Row Level Security
Queue/Jobs:     Supabase pg_cron for scheduled jobs OR Inngest for event-driven processing
Auth:           Shopify OAuth 2.0 via @shopify/shopify-app-next
Pixel:          Shopify Web Pixels API (App Pixel — registered via API, not manual)
Alerts:         Resend (email) + Slack Incoming Webhooks
Hosting:        Vercel
ORM:            Prisma
Shopify API:    @shopify/shopify-api (Node) — Admin REST + GraphQL
```

**Why these choices:**
- Supabase: gives you Postgres + realtime + auth + cron in one. No separate Redis needed for MVP.
- Inngest (optional): if job queue complexity grows, swap pg_cron for Inngest. Not needed day 1.
- Resend: dead simple transactional email, better deliverability than nodemailer, free tier generous.
- Vercel: zero-config deployment, works perfectly with Next.js, handles serverless functions.

---

### Repository Structure

```
/
├── app/                          # Next.js App Router
│   ├── api/
│   │   ├── auth/                 # Shopify OAuth callbacks
│   │   ├── webhooks/             # Shopify webhook receivers
│   │   │   ├── app-uninstalled/
│   │   │   ├── orders-create/
│   │   │   └── checkouts-update/
│   │   ├── pixel/
│   │   │   └── ingest/           # POST endpoint — receives pixel events
│   │   └── alerts/
│   │       └── test/             # Test alert endpoint
│   ├── (embedded)/               # Shopify App Bridge wrapper
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   │   └── page.tsx          # Main funnel view
│   │   ├── alerts/
│   │   │   └── page.tsx          # Alert history + config
│   │   └── settings/
│   │       └── page.tsx          # Notification preferences
│   └── install/
│       └── page.tsx              # Post-install welcome screen
├── components/
│   ├── funnel/
│   │   ├── FunnelChart.tsx       # Main drop-off visualisation
│   │   └── FunnelStep.tsx
│   ├── alerts/
│   │   ├── AlertCard.tsx
│   │   └── AlertBadge.tsx
│   └── ui/                       # Shared components (Polaris or shadcn)
├── lib/
│   ├── shopify.ts                # Shopify API client init
│   ├── pixel-registration.ts    # Register/deregister App Pixel
│   ├── alert-engine.ts          # Core alert evaluation logic
│   ├── metrics.ts               # Funnel computation functions
│   └── notifications/
│       ├── email.ts             # Resend integration
│       └── slack.ts             # Slack webhook integration
├── prisma/
│   └── schema.prisma
├── jobs/                        # Background processing
│   ├── compute-baselines.ts     # Runs every hour
│   ├── evaluate-alerts.ts       # Runs every 5 minutes
│   └── weekly-digest.ts         # Runs Monday 9am per-shop
├── pixel/
│   └── checkout-monitor.js      # The actual pixel code (sandboxed)
└── supabase/
    └── migrations/              # SQL migrations
```

---

### Database Schema (Prisma)

```prisma
model Shop {
  id                String   @id @default(cuid())
  shopDomain        String   @unique
  accessToken       String
  pixelId           String?  // Shopify pixel ID once registered
  isActive          Boolean  @default(true)
  installedAt       DateTime @default(now())
  timezone          String   @default("UTC")
  
  // Notification config
  alertEmail        String?
  slackWebhookUrl   String?
  alertEmailEnabled Boolean  @default(true)
  alertSlackEnabled Boolean  @default(false)
  
  // Alert toggles
  alertAbandonmentEnabled  Boolean @default(true)
  alertDiscountEnabled     Boolean @default(true)
  alertExtensionEnabled    Boolean @default(true)
  alertPaymentEnabled      Boolean @default(true)

  checkoutEvents    CheckoutEvent[]
  alertLogs         AlertLog[]
  baselines         Baseline[]
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model CheckoutEvent {
  id          String   @id @default(cuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id])
  
  sessionId   String   // client-side checkout token
  eventType   String   // checkout_started | checkout_address_info_submitted | 
                       // checkout_shipping_info_submitted | payment_info_submitted | 
                       // checkout_completed | alert_displayed | ui_extension_errored
  
  // Enrichment fields
  deviceType  String?  // mobile | desktop | tablet
  country     String?
  discountCode String? // extracted from alert_displayed or checkout_completed
  totalPrice  Float?
  currency    String?
  gatewayName String?  // payment gateway from checkout_completed
  errorMessage String? // from ui_extension_errored
  extensionId  String? // from ui_extension_errored
  
  rawPayload  Json     // full event payload stored for debugging
  occurredAt  DateTime // client-side timestamp from pixel event
  receivedAt  DateTime @default(now())

  @@index([shopId, eventType, occurredAt])
  @@index([shopId, sessionId])
  @@index([shopId, occurredAt])
}

model Baseline {
  id         String   @id @default(cuid())
  shopId     String
  shop       Shop     @relation(fields: [shopId], references: [id])
  
  metricName String   // checkout_cvr | payment_failure_rate
  value      Float    // rolling 7-day average
  windowStart DateTime
  windowEnd   DateTime
  computedAt  DateTime @default(now())

  @@index([shopId, metricName])
}

model AlertLog {
  id          String   @id @default(cuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id])
  
  alertType   String   // abandonment_spike | failed_discount | extension_error | payment_failure
  severity    String   // critical | warning | info
  title       String
  body        String   // full alert message
  metadata    Json     // structured data: cvr, baseline, discount_code, etc.
  
  sentEmail   Boolean  @default(false)
  sentSlack   Boolean  @default(false)
  
  firedAt     DateTime @default(now())
  resolvedAt  DateTime?

  @@index([shopId, firedAt])
  @@index([shopId, alertType, firedAt])
}
```

---

### The Pixel Code

This is the JS that runs inside Shopify's sandboxed pixel iframe. It lives at `/pixel/checkout-monitor.js` and is registered via API.

```javascript
// pixel/checkout-monitor.js
// IMPORTANT: This runs in a sandboxed Web Worker — no DOM access, no fetch(), use sendBeacon only

import {register} from '@shopify/web-pixels-extension';

register(({analytics, browser, init}) => {
  const INGEST_URL = 'https://YOUR_VERCEL_URL/api/pixel/ingest';
  const shopDomain = init.context?.document?.location?.hostname;

  function send(eventType, payload) {
    const body = JSON.stringify({
      shopDomain,
      eventType,
      sessionId: payload.checkout?.token || payload.cartId || null,
      occurredAt: new Date().toISOString(),
      deviceType: init.context?.navigator?.userAgent?.includes('Mobile') ? 'mobile' : 'desktop',
      country: payload.checkout?.shippingAddress?.country || null,
      data: payload,
    });
    // sendBeacon is the ONLY reliable way to send data from a pixel sandbox
    browser.sendBeacon(INGEST_URL, body);
  }

  analytics.subscribe('checkout_started', (event) => {
    send('checkout_started', event.data);
  });

  analytics.subscribe('checkout_contact_info_submitted', (event) => {
    send('checkout_contact_info_submitted', event.data);
  });

  analytics.subscribe('checkout_address_info_submitted', (event) => {
    send('checkout_address_info_submitted', event.data);
  });

  analytics.subscribe('checkout_shipping_info_submitted', (event) => {
    send('checkout_shipping_info_submitted', event.data);
  });

  analytics.subscribe('payment_info_submitted', (event) => {
    send('payment_info_submitted', event.data);
  });

  analytics.subscribe('checkout_completed', (event) => {
    const checkout = event.data.checkout;
    send('checkout_completed', {
      ...event.data,
      // Extract discount codes explicitly
      discountCodes: checkout?.discountApplications
        ?.filter(d => d.type === 'DISCOUNT_CODE')
        ?.map(d => d.title) || [],
      totalPrice: checkout?.totalPrice?.amount,
      currency: checkout?.currencyCode,
      gateway: checkout?.transactions?.[0]?.gateway,
    });
  });

  analytics.subscribe('alert_displayed', (event) => {
    // This fires on checkout validation errors including failed discount codes
    send('alert_displayed', event.data);
  });

  analytics.subscribe('ui_extension_errored', (event) => {
    send('ui_extension_errored', event.data);
  });
});
```

---

### Pixel Ingest Endpoint

```typescript
// app/api/pixel/ingest/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  // sendBeacon sends as text/plain — must parse manually
  const text = await req.text();
  
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { shopDomain, eventType, sessionId, occurredAt, deviceType, country, data } = body;

  // Look up shop
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop || !shop.isActive) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // Extract enrichment fields based on event type
  let discountCode = null;
  let totalPrice = null;
  let gatewayName = null;
  let errorMessage = null;
  let extensionId = null;

  if (eventType === 'checkout_completed') {
    discountCode = data.discountCodes?.[0] || null;
    totalPrice = parseFloat(data.totalPrice) || null;
    gatewayName = data.gateway || null;
  }

  if (eventType === 'alert_displayed') {
    // Try to extract discount code from alert message
    // Shopify alert messages for discount errors contain the code
    errorMessage = data.message || data.alert?.message || null;
    // Heuristic: if message contains known discount error strings
    if (errorMessage?.toLowerCase().includes('discount') || 
        errorMessage?.toLowerCase().includes('coupon') ||
        errorMessage?.toLowerCase().includes('promo')) {
      discountCode = extractDiscountCodeFromAlert(errorMessage, data);
    }
  }

  if (eventType === 'ui_extension_errored') {
    errorMessage = data.error?.message || null;
    extensionId = data.extensionId || null;
  }

  // Write to DB — fire and forget, respond fast
  await prisma.checkoutEvent.create({
    data: {
      shopId: shop.id,
      sessionId: sessionId || 'unknown',
      eventType,
      deviceType,
      country,
      discountCode,
      totalPrice,
      currency: data.currency || null,
      gatewayName,
      errorMessage,
      extensionId,
      rawPayload: data,
      occurredAt: new Date(occurredAt),
    },
  });

  return NextResponse.json({ ok: true });
}

function extractDiscountCodeFromAlert(message: string, data: any): string | null {
  // Shopify error format: "Enter a valid discount code"
  // We store the raw message and try to link back to session's attempted codes
  // For MVP: store the alert context and correlate in alert engine
  return data?.checkout?.discountCode || null;
}
```

---

### Alert Engine

```typescript
// lib/alert-engine.ts
// This runs every 5 minutes via cron job

import { prisma } from './prisma';
import { sendEmail } from './notifications/email';
import { sendSlack } from './notifications/slack';

const ALERT_COOLDOWN_MINUTES = 120; // 2 hours between same alert type
const ABANDONMENT_THRESHOLD = 0.20; // 20% drop below baseline
const PAYMENT_FAILURE_THRESHOLD = 0.15; // 15% payment failure rate
const DISCOUNT_FAILURE_MIN_COUNT = 3; // min failures before alerting

export async function evaluateAlerts() {
  const shops = await prisma.shop.findMany({ where: { isActive: true } });
  
  for (const shop of shops) {
    await Promise.allSettled([
      checkAbandonmentSpike(shop),
      checkFailedDiscounts(shop),
      checkExtensionErrors(shop),
      checkPaymentFailures(shop),
    ]);
  }
}

async function checkAbandonmentSpike(shop: any) {
  if (!shop.alertAbandonmentEnabled) return;
  if (await isOnCooldown(shop.id, 'abandonment_spike')) return;

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Current window CVR
  const [started, completed] = await Promise.all([
    prisma.checkoutEvent.count({
      where: { shopId: shop.id, eventType: 'checkout_started', occurredAt: { gte: oneHourAgo } }
    }),
    prisma.checkoutEvent.count({
      where: { shopId: shop.id, eventType: 'checkout_completed', occurredAt: { gte: oneHourAgo } }
    }),
  ]);

  if (started < 10) return; // Not enough data

  const currentCVR = completed / started;

  // Get baseline
  const baseline = await prisma.baseline.findFirst({
    where: { shopId: shop.id, metricName: 'checkout_cvr' },
    orderBy: { computedAt: 'desc' },
  });

  if (!baseline) return; // Still in learning period

  const drop = (baseline.value - currentCVR) / baseline.value;

  if (drop >= ABANDONMENT_THRESHOLD) {
    const estimatedLostRevenue = await estimateLostRevenue(shop.id, started, currentCVR, baseline.value);
    
    await fireAlert(shop, {
      alertType: 'abandonment_spike',
      severity: 'critical',
      title: `Checkout abandonment spike detected`,
      body: `Your checkout completion rate dropped to ${(currentCVR * 100).toFixed(1)}% (normally ${(baseline.value * 100).toFixed(1)}%) — a ${(drop * 100).toFixed(0)}% drop.\nEstimated revenue at risk this hour: ~$${estimatedLostRevenue}.\nProbable cause: Payment gateway issue, broken checkout extension, or a recent theme/app change.\nAction: Review your active checkout apps and payment settings.`,
      metadata: { currentCVR, baseline: baseline.value, drop, estimatedLostRevenue, started, completed },
      actionUrl: paymentsAdminUrl(shop.shopDomain),
      actionLabel: 'Check payment settings in Shopify',
    });
  }
}

async function checkFailedDiscounts(shop: any) {
  if (!shop.alertDiscountEnabled) return;
  if (await isOnCooldown(shop.id, 'failed_discount')) return;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Find alert_displayed events that look like discount failures
  const discountAlerts = await prisma.checkoutEvent.findMany({
    where: {
      shopId: shop.id,
      eventType: 'alert_displayed',
      occurredAt: { gte: oneHourAgo },
      discountCode: { not: null },
    },
  });

  // Group by discount code
  const grouped: Record<string, number> = {};
  for (const event of discountAlerts) {
    if (event.discountCode) {
      grouped[event.discountCode] = (grouped[event.discountCode] || 0) + 1;
    }
  }

  for (const [code, count] of Object.entries(grouped)) {
    if (count >= DISCOUNT_FAILURE_MIN_COUNT) {
      await fireAlert(shop, {
        alertType: 'failed_discount',
        severity: 'critical',
        title: `Discount code "${code}" is failing at checkout`,
        body: `Your code "${code}" has failed ${count} times in the last hour — customers are being rejected at checkout.\nProbable cause: Code may be expired, usage limit reached, or minimum order requirement not met.\nAction: Open the discount in Shopify admin and check its status, expiry date, and usage count.`,
        metadata: { code, failureCount: count },
        actionUrl: discountAdminUrl(shop.shopDomain),
        actionLabel: `Edit discount "${code}" in Shopify`,
      });
    }
  }
}

async function checkExtensionErrors(shop: any) {
  if (!shop.alertExtensionEnabled) return;
  
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const errors = await prisma.checkoutEvent.findMany({
    where: {
      shopId: shop.id,
      eventType: 'ui_extension_errored',
      occurredAt: { gte: fiveMinutesAgo },
    },
  });

  if (errors.length === 0) return;

  // Group by extension
  const grouped: Record<string, { count: number; message: string }> = {};
  for (const err of errors) {
    const key = err.extensionId || 'unknown';
    grouped[key] = {
      count: (grouped[key]?.count || 0) + 1,
      message: err.errorMessage || 'Unknown error',
    };
  }

  for (const [extId, { count, message }] of Object.entries(grouped)) {
    const alreadyAlerted = await isOnCooldown(shop.id, `extension_error_${extId}`);
    if (alreadyAlerted) continue;

    await fireAlert(shop, {
      alertType: 'extension_error',
      severity: 'critical',
      title: `Checkout extension is broken`,
      body: `Extension ${extId} has thrown errors in ${count} checkout session(s) in the last 5 minutes.\nError: "${message}"\nProbable cause: A recent app update introduced a bug, or there's a conflict with your current theme.\nAction: Disable this extension immediately to restore checkout, then contact the app developer.`,
      metadata: { extensionId: extId, count, message },
      actionUrl: appsAdminUrl(shop.shopDomain),
      actionLabel: 'Manage checkout apps in Shopify',
    });
  }
}

async function checkPaymentFailures(shop: any) {
  if (!shop.alertPaymentEnabled) return;
  if (await isOnCooldown(shop.id, 'payment_failure')) return;

  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const paymentAttempts = await prisma.checkoutEvent.count({
    where: { shopId: shop.id, eventType: 'payment_info_submitted', occurredAt: { gte: thirtyMinutesAgo } }
  });

  if (paymentAttempts < 5) return;

  // Find sessions where payment was submitted but no checkout_completed followed
  const submittedSessions = await prisma.checkoutEvent.findMany({
    where: { shopId: shop.id, eventType: 'payment_info_submitted', occurredAt: { gte: thirtyMinutesAgo } },
    select: { sessionId: true, gatewayName: true },
  });

  const completedSessionIds = new Set(
    (await prisma.checkoutEvent.findMany({
      where: { 
        shopId: shop.id, 
        eventType: 'checkout_completed',
        occurredAt: { gte: thirtyMinutesAgo },
        sessionId: { in: submittedSessions.map(s => s.sessionId) }
      },
      select: { sessionId: true },
    })).map(e => e.sessionId)
  );

  const failedSessions = submittedSessions.filter(s => !completedSessionIds.has(s.sessionId));
  const failureRate = failedSessions.length / paymentAttempts;

  if (failureRate >= PAYMENT_FAILURE_THRESHOLD) {
    const topGateway = getMostCommonGateway(failedSessions);
    await fireAlert(shop, {
      alertType: 'payment_failure',
      severity: 'critical',
      title: `Payment failures are unusually high`,
      body: `${(failureRate * 100).toFixed(0)}% of payment attempts in the last 30 minutes did not complete (${failedSessions.length} of ${paymentAttempts}).\nMost affected gateway: ${topGateway}.\nProbable cause: Payment gateway outage, card validation issue, or a broken checkout extension interfering with payment submission.\nAction: Check your payment settings and verify ${topGateway}'s status page.`,
      metadata: { failureRate, failedCount: failedSessions.length, totalAttempts: paymentAttempts, topGateway },
      actionUrl: paymentsAdminUrl(shop.shopDomain),
      actionLabel: `Check ${topGateway} settings in Shopify`,
    });
  }
}

// ---- Helpers ----

async function isOnCooldown(shopId: string, alertType: string): Promise<boolean> {
  const cooldownStart = new Date(Date.now() - ALERT_COOLDOWN_MINUTES * 60 * 1000);
  const recent = await prisma.alertLog.findFirst({
    where: { shopId, alertType, firedAt: { gte: cooldownStart } },
  });
  return !!recent;
}

async function fireAlert(shop: any, alert: {
  alertType: string;
  severity: string;
  title: string;
  body: string;
  metadata: object;
  actionUrl?: string;   // Deep link into Shopify admin — REQUIRED for every alert type
  actionLabel?: string; // Button/link text
}) {
  const log = await prisma.alertLog.create({
    data: {
      shopId: shop.id,
      ...alert,
      sentEmail: false,
      sentSlack: false,
    },
  });

  const dashboardUrl = `https://YOUR_APP_URL/dashboard?shop=${shop.shopDomain}`;
  // Every alert MUST have an actionUrl — this is what makes alerts actionable
  // for solo founders who don't know what to do when something breaks.
  const actionUrl = alert.actionUrl || `https://${shop.shopDomain}/admin`;
  const actionLabel = alert.actionLabel || 'Open Shopify Admin';

  if (shop.alertEmailEnabled && shop.alertEmail) {
    await sendEmail({
      to: shop.alertEmail,
      subject: `⚠️ ${alert.title}`,
      body: `${alert.body}\n\n→ ${actionLabel}: ${actionUrl}\n\nView full dashboard: ${dashboardUrl}`,
    });
    await prisma.alertLog.update({ where: { id: log.id }, data: { sentEmail: true } });
  }

  if (shop.alertSlackEnabled && shop.slackWebhookUrl) {
    await sendSlack({
      webhookUrl: shop.slackWebhookUrl,
      title: alert.title,
      body: alert.body,
      actionUrl,
      actionLabel,
      dashboardUrl,
    });
    await prisma.alertLog.update({ where: { id: log.id }, data: { sentSlack: true } });
  }
}

// DEEP LINK HELPERS — use these when constructing every alert
function discountAdminUrl(shopDomain: string, discountId?: string): string {
  if (discountId) return `https://${shopDomain}/admin/discounts/${discountId}`;
  return `https://${shopDomain}/admin/discounts`;
}
function appsAdminUrl(shopDomain: string): string {
  return `https://${shopDomain}/admin/apps`;
}
function paymentsAdminUrl(shopDomain: string): string {
  return `https://${shopDomain}/admin/settings/payments`;
}

async function estimateLostRevenue(shopId: string, sessions: number, currentCVR: number, baselineCVR: number): Promise<number> {
  const recent = await prisma.checkoutEvent.aggregate({
    where: { shopId, eventType: 'checkout_completed' },
    _avg: { totalPrice: true },
  });
  const avgOrderValue = recent._avg.totalPrice || 50;
  const missedConversions = Math.round(sessions * (baselineCVR - currentCVR));
  return Math.round(missedConversions * avgOrderValue);
}

function getMostCommonGateway(sessions: any[]): string {
  const counts: Record<string, number> = {};
  for (const s of sessions) {
    if (s.gatewayName) counts[s.gatewayName] = (counts[s.gatewayName] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
}
```

---

### Baseline Computation Job

```typescript
// jobs/compute-baselines.ts
// Runs every hour via cron

import { prisma } from '@/lib/prisma';

export async function computeBaselines() {
  const shops = await prisma.shop.findMany({ where: { isActive: true } });

  for (const shop of shops) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Only compute baseline after 48h of data (silent learning period)
    const firstEvent = await prisma.checkoutEvent.findFirst({
      where: { shopId: shop.id },
      orderBy: { occurredAt: 'asc' },
    });
    if (!firstEvent || firstEvent.occurredAt > fortyEightHoursAgo) continue;

    const [started, completed] = await Promise.all([
      prisma.checkoutEvent.count({
        where: { shopId: shop.id, eventType: 'checkout_started', occurredAt: { gte: sevenDaysAgo } }
      }),
      prisma.checkoutEvent.count({
        where: { shopId: shop.id, eventType: 'checkout_completed', occurredAt: { gte: sevenDaysAgo } }
      }),
    ]);

    if (started < 20) continue; // Not enough data for reliable baseline

    const cvr = completed / started;

    await prisma.baseline.create({
      data: {
        shopId: shop.id,
        metricName: 'checkout_cvr',
        value: cvr,
        windowStart: sevenDaysAgo,
        windowEnd: new Date(),
      },
    });
  }
}
```

---

### Shopify App Pixel Registration

```typescript
// lib/pixel-registration.ts
// Called immediately after OAuth install completes

import { shopifyApi } from '@shopify/shopify-api';

export async function registerAppPixel(shop: string, accessToken: string): Promise<string> {
  // Register the App Pixel via GraphQL Admin API
  const client = new shopifyApi.clients.Graphql({ session: { shop, accessToken } });

  const response = await client.query({
    data: {
      query: `
        mutation webPixelCreate($webPixel: WebPixelInput!) {
          webPixelCreate(webPixel: $webPixel) {
            userErrors { field message }
            webPixel { id settings }
          }
        }
      `,
      variables: {
        webPixel: {
          settings: JSON.stringify({ 
            shopDomain: shop,
            ingestUrl: process.env.NEXT_PUBLIC_APP_URL + '/api/pixel/ingest'
          }),
        },
      },
    },
  });

  const pixelId = response.body.data?.webPixelCreate?.webPixel?.id;
  if (!pixelId) throw new Error('Pixel registration failed');
  return pixelId;
}

export async function deregisterAppPixel(shop: string, accessToken: string, pixelId: string) {
  const client = new shopifyApi.clients.Graphql({ session: { shop, accessToken } });
  await client.query({
    data: {
      query: `
        mutation webPixelDelete($id: ID!) {
          webPixelDelete(id: $id) {
            userErrors { field message }
            deletedWebPixelId
          }
        }
      `,
      variables: { id: pixelId },
    },
  });
}
```

---

### Cron Job Setup (Vercel)

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/jobs/evaluate-alerts",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/jobs/compute-baselines",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/jobs/weekly-digest",
      "schedule": "0 9 * * 1"
    }
  ]
}
```

---

## Part 3: Build Phases (30-Day Roadmap)

### Phase 1 — Days 1–7: Foundation
**Goal: Install flow works end to end. Events are being received and stored.**

- [ ] Scaffold Next.js app with Shopify App Bridge 4.x
- [ ] Implement OAuth install flow (`@shopify/shopify-app-next`)
- [ ] Set up Supabase project + run Prisma migrations
- [ ] Implement App Pixel registration on install (auto, no merchant action)
- [ ] Build `/api/pixel/ingest` endpoint
- [ ] Write pixel code (`checkout-monitor.js`), test all 7 event subscriptions
- [ ] Deploy to Vercel, test against a real dev store
- [ ] Confirm events are flowing into DB

**Exit criteria:** Install a test app on a dev Shopify store, go through checkout, see 6 events in the DB.

---

### Phase 2 — Days 8–14: Alert Engine
**Goal: Alerts fire correctly. Email delivery works.**

- [ ] Build `compute-baselines` job + wire to Vercel cron
- [ ] Build `evaluate-alerts` job — all 4 alert types
- [ ] Implement 2-hour cooldown logic
- [ ] Implement 48h silent learning period
- [ ] Set up Resend account, build email templates (plain text first, styled later)
- [ ] Build Slack webhook sender + test button in settings UI
- [ ] Write unit tests for alert threshold logic (Jest)
- [ ] Manually trigger each alert type against test data

**Exit criteria:** Seed DB with fake events that breach each threshold. Receive all 4 alert types via email.

---

### Phase 3 — Days 15–21: Dashboard
**Goal: The funnel view is live and accurate.**

- [ ] Build funnel metrics query in `lib/metrics.ts`
- [ ] Build `FunnelChart` component (Recharts or Chart.js — keep it simple)
- [ ] Add time range filter (24h / 7d / 30d)
- [ ] Add device type filter (mobile / desktop)
- [ ] Add country filter
- [ ] Build alert history page (list of past alerts, status, metadata)
- [ ] Build settings page (email, Slack, alert toggles)
- [ ] Implement weekly digest email job

**Exit criteria:** Dashboard accurately shows funnel from real test checkout sessions. Filters work.

---

### Phase 4 — Days 22–28: Polish + App Store Prep
**Goal: Ready for Shopify App Store submission.**

- [ ] Post-install welcome screen with "Your store is now being monitored" confirmation
- [ ] 48h learning period banner shown in UI when baseline not yet available
- [ ] Error handling on all API routes (graceful failures, no 500s shown to merchant)
- [ ] Shopify App Store listing: screenshots, description, privacy policy page
- [ ] GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact`
- [ ] App uninstall webhook: deregister pixel, mark shop inactive
- [ ] Rate limiting on `/api/pixel/ingest` (protect against pixel spam)
- [ ] Load test ingest endpoint with 1000 events/minute
- [ ] Submit to Shopify App Store review

**Exit criteria:** App passes Shopify's review checklist. Installs cleanly on 3 different test stores.

---

### Days 29–30: Buffer
Handle review feedback, fix edge cases, onboard first real merchant manually.

---

## Part 4: Guardrails — What Claude Code Must Not Do

These are hard rules. Do not deviate without explicit instruction.

1. **No third-party analytics SDKs inside the pixel.** Only `sendBeacon`. No fetch, no XHR, no external scripts loaded from within the pixel sandbox.

2. **No localStorage or sessionStorage in the pixel.** The pixel runs in a sandboxed Web Worker. These APIs do not exist there.

3. **No storing raw PII in CheckoutEvent.** The `rawPayload` field stores the full event for debugging but must be stripped of: email, phone, full name, card numbers before storage. Write a `sanitizePayload()` function called before every DB write.

4. **No blocking the ingest endpoint.** The POST to `/api/pixel/ingest` must respond in under 200ms. All heavy processing (alert evaluation, metric computation) happens in background jobs, never in the ingest path.

5. **No Shopify Plus-only APIs.** Every feature must work on non-Plus plans. Do not use Checkout Extensibility APIs (`checkout.liquid`, checkout UI extensions read APIs). Use only: Web Pixels API, Admin REST API, Admin GraphQL API, Webhooks.

6. **Alert cooldown is non-negotiable.** Never fire the same alert type for the same shop twice within 2 hours. The cooldown check must happen before any notification is sent, not after.

7. **Baseline learning period is non-negotiable.** Never evaluate abandonment spike alerts for a shop with less than 48 hours of data OR less than 20 checkout_started events. Show a "Learning your store's patterns" state in the UI.

8. **All Shopify webhooks must be HMAC verified.** Use `shopify.webhooks.validate()` before processing any webhook payload. Return 401 on failure.

9. **One pixel per shop.** Before registering a new pixel on install, check if `shop.pixelId` already exists and delete the old one first. Prevents duplicate pixel events.

10. **Vercel cron endpoints must be protected.** All `/api/jobs/*` endpoints must verify the `Authorization: Bearer CRON_SECRET` header. Set `CRON_SECRET` in Vercel env vars.

---

## Part 5: Environment Variables

```bash
# Shopify
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=https://your-app.vercel.app
SHOPIFY_SCOPES=read_orders,read_checkouts,write_pixels,read_analytics

# Database
DATABASE_URL=postgresql://...  # Supabase connection string

# Notifications
RESEND_API_KEY=

# Jobs
CRON_SECRET=  # Random 32-char string, protects cron endpoints

# App
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

---

## Part 6: Shopify App Scopes Required

```
read_orders          — for order webhooks (cross-reference with checkout events)
read_checkouts       — for checkout webhooks (server-side funnel data)
write_pixels         — to register and manage the App Pixel
read_analytics       — for store-level analytics context
```

No write permissions to orders, products, or customers. Minimal scope = faster App Store approval.

---

### Pricing Implementation (Shopify Billing API)

```typescript
// Two tiers — implement from day 1, don't bolt on later
// Do NOT start at $15-$29. $49 is correct. Here's why:
// - Checkout Pulse charges $195 for pure monitoring. $49 is already a 75% discount.
// - If one alert saves a merchant from a broken discount during a campaign weekend,
//   that's $500+ saved. $49/month is nothing in that context.
// - $15-$29 signals "nice to have tool." $49 signals "revenue insurance."
// - Start at $49. Offer 14-day free trial. Discount to $29 only if conversion data demands it.

const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    features: [
      '7-day data retention',
      'Funnel dashboard (read-only)',
      'Email alerts — up to 3/month',
      'Limited to stores with <500 monthly checkout sessions'
    ],
    checkoutEventLimit: 500,
    alertLimit: 3,
  },
  pro: {
    name: 'Pro',
    price: 49, // USD/month — do not lower without A/B test evidence
    features: [
      'Unlimited checkout event tracking',
      'Email + Slack alerts (unlimited)',
      '90-day data retention',
      'Weekly digest email',
      'Device + country breakdown',
      'Deep-link fix suggestions in every alert',
      'All 4 alert types: abandonment, discount, extension, payment'
    ],
    checkoutEventLimit: null,
    alertLimit: null,
  },
};

// ICP FLOOR ENFORCEMENT:
// Stores with < 200 checkout_started events in their first 7 days 
// should see a message: "Your store is being monitored. Alerts will activate
// once we've seen enough checkout activity to establish your baseline (usually 2-3 days)."
// Do NOT disable the app for them — just show the learning state clearly.
```

---

---

## Part 8: UI Architecture

### Stack & Design System
- **Framework:** Next.js 14 App Router, embedded in Shopify Admin via App Bridge 4.x
- **Component library:** Shopify Polaris — use it for EVERYTHING. Every button, card, badge, table, navigation item, date picker, skeleton loader, toast, modal, and icon must be a Polaris component. Zero custom CSS frameworks. Zero Tailwind. Zero shadcn. Polaris only. This makes the app feel native to Shopify and speeds up App Store approval.
- **Charts only:** Recharts — the one exception where Polaris has no equivalent. Use it for funnel bars and sparklines only.
- **Date range picker:** Use Polaris `DatePicker` component with a custom preset selector (Today / Last 24h / Last 7 days / Last 30 days / Custom range). Custom range opens a Polaris date picker modal. Do not build a custom date picker.

---

### Navigation (App Bridge embedded nav)

```
Left nav:
  ├── Monitor          ← default route /
  ├── Alerts           ← /alerts  (show Polaris Badge with unread count if >0)
  └── Settings         ← /settings
```

Three items. No more. No sub-navigation in MVP.

---

### Page 1: Monitor `/`

This is the primary page. Merchants spend 90% of their time here.

#### Layout (top to bottom)

**1. Status Banner (always visible, full width)**

A Polaris `Banner` component that changes state based on current health:

```
🟢  [tone="success"]   "Checkout healthy — no issues detected in the last 60 minutes"
🔴  [tone="critical"]  "Active alert: Discount code WELCOME10 is failing at checkout  →  [View alert]"
🟡  [tone="warning"]   "Learning your store's patterns — alerts activate in ~2 days"
⚫  [tone="info"]      "Monitoring paused — pixel not receiving events. [Troubleshoot]"
```

Only one banner shows at a time. Critical takes priority over warning.

**2. Date Range Selector (right-aligned, below banner)**

Polaris `ButtonGroup` with presets: `1h` | `24h` | `7d` | `30d` | `Custom`

Clicking `Custom` opens a Polaris `Modal` containing a `DatePicker` with from/to selection.
Selected range affects ALL data on the page below it.
Default on load: `24h`.

**3. Top KPI Cards (single row, 4 cards)**

Polaris `Card` components in a responsive grid:

```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Checkouts       │ │ Completed        │ │ Checkout CVR    │ │ Revenue at Risk  │
│ Started         │ │ Orders           │ │                 │ │ (from alerts)    │
│                 │ │                  │ │                 │ │                  │
│  247            │ │  89              │ │  36%            │ │  $0              │
│  ↑ vs yesterday │ │  ↑ vs yesterday  │ │  ↓ 4pts vs avg  │ │  (all clear)     │
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
```

- "Revenue at Risk" shows estimated lost revenue during any currently active alert, $0 when healthy.
- CVR delta shows vs the 7-day baseline with a Polaris `Badge` tone (success/warning/critical).

**4. Checkout Funnel (horizontal progress bars)**

Polaris `Card` with title "Checkout Funnel", containing a custom bar component built with divs + inline styles (no chart lib needed for this — it's just colored bars).

```
Cart ──────────────────────────────────────── 100%   247 sessions
     ████████████████████████████████████████

Contact ──────────────────────────────────── 84%    208 sessions  (39 dropped)
        ████████████████████████████████░░░░

Shipping ─────────────────────────────────── 71%    175 sessions  (33 dropped)
         ██████████████████████████████░░░░░

Payment ──────────────────────────────────── 48%    118 sessions  (57 dropped) ← RED if >20% vs baseline
        ████████████████████░░░░░░░░░░░░░░░░

Complete ─────────────────────────────────── 36%    89 sessions
         ███████████████░░░░░░░░░░░░░░░░░░░░
```

Steps with anomalous drop-off (>20% vs baseline) shown with Polaris `Badge tone="critical"` next to the drop %.
On hover over any step bar: Polaris `Tooltip` showing the absolute drop count and delta vs baseline.

Below the funnel, two filter pills (Polaris `Filters` / `ChoiceList`):
- Device: All / Mobile / Desktop
- Country: All / [top 5 countries seen in data]

These filter the entire funnel and all tables below.

**5. Two-column panel: Errors + Dropped Products**

Polaris `Grid` with two `Card` components side by side (stack on mobile).

**Left card — "Top Errors Before Drop-off"**

Polaris `IndexTable` (simple, no row selection needed):

```
Error Type          | Count  | Trend
DISCOUNT_ERROR      |  31    |  ↑ vs yesterday  [critical badge]
Payment drop-off    |  19    |  → same
Extension error     |   3    |  new today       [warning badge]
Input validation    |   8    |  ↓ improving
```

Clicking any row opens a Polaris `Modal` with a list of the raw events — timestamps, device, country, and the specific error message. This is the drill-down without building a separate page.

**Right card — "Products in Abandoned Carts"**

Polaris `IndexTable`:

```
Product                    | In Dropped Carts | % of Drops
Hoodie (Black, M)          |  22              |  28%
Running Shoes (Size 10)    |  15              |  19%
Summer Dress (Blue, S)     |  11              |  14%
```

This data comes from: for all `checkout_started` sessions that never reached `checkout_completed`, extract the line items from the `checkout_started` event payload and aggregate by product title + variant.

No click-through needed on MVP — just the table.

**6. Live Error Feed (bottom of page)**

Polaris `Card` with title "Recent Events" and a Polaris `DataTable` or custom list, auto-refreshing every 30 seconds:

```
Time         Type                  Detail                        Device    Country
2 min ago    🔴 DISCOUNT_ERROR     Code "WELCOME10" rejected     Mobile    US
5 min ago    ⚫ Completed          $84.00 · Hoodie (Black, M)    Desktop   UK
9 min ago    🟡 Payment drop-off   Reached payment, no order     Mobile    CA
14 min ago   🔴 DISCOUNT_ERROR     Code "WELCOME10" rejected     Mobile    US
22 min ago   ⚫ Completed          $124.00 · Shoes + Socks       Desktop   AU
```

Color coding via Polaris `Badge`:
- `tone="critical"` → red → DISCOUNT_ERROR, extension error
- `tone="warning"` → yellow → payment drop-off
- No badge (neutral) → completed orders

Show last 50 events max. No infinite scroll for MVP — just the 50 most recent.

---

### Page 2: Alerts `/alerts`

**Tab bar (Polaris `Tabs`):** Active | History

**Active tab:**

If no active alerts: Polaris `EmptyState` with green checkmark icon and copy "No active alerts — your checkout is running smoothly."

If alerts exist: Polaris `IndexTable` with one row per alert:

```
Alert                          | Fired        | Status         | Action
Discount WELCOME10 failing     | 12 min ago   | 🔴 Active      | [Fix in Shopify ↗]  [Mark resolved]
```

"Fix in Shopify" opens the deep link in a new tab.
"Mark resolved" sets `resolvedAt` timestamp and moves to History tab.

**History tab:**

Polaris `IndexTable` with full alert history:

```
Alert                      | Fired        | Resolved     | Sent via   | ROI saved
Discount SUMMER20 failing  | Mar 8, 2:14p | Mar 8, 2:31p | Email      | $340
Abandonment spike          | Mar 5, 7:02p | Mar 5, 7:45p | Email+Slack| $210
Extension error (Bold)     | Mar 1, 9:11a | —            | Email      | —
```

"ROI saved" column — see Part 9.

Date range selector at top (same presets as Monitor page) to filter history.

---

### Page 3: Settings `/settings`

Single scrollable page. Polaris `Layout` with sections.

**Section 1 — Notifications**
```
Email alerts
[email input, pre-filled from Shopify account email]  [Save]

Slack webhook URL
[text input]  [Test]  [Save]
Note: WhatsApp notifications coming in v2.
```

Each alert type has a Polaris `SettingToggle` (on/off):
- Abandonment spike alerts
- Failed discount code alerts
- Checkout extension errors
- Payment failure spike alerts

**Section 2 — Alert Sensitivity**

Polaris `RangeSlider` for each threshold:
- Abandonment threshold: 10% — 50% (default: 20%)
  Label: "Alert me when checkout CVR drops more than [X]% below my baseline"
- Discount failure count: 1 — 10 (default: 3)
  Label: "Alert me after a discount code fails [X] times in one hour"
- Payment failure rate: 5% — 30% (default: 15%)
  Label: "Alert me when [X]% of payment attempts don't complete"

**Section 3 — Pixel Health**

Polaris `Card` showing:
```
Status:     🟢 Connected
Last event: 4 minutes ago
Events today: 847
Plan:       Pro ($49/month)  [Manage billing ↗]
```

If no events in 30+ minutes: show Polaris `Banner tone="warning"` with troubleshooting steps (check if pixel is blocked, check store's cookie consent settings).

---

### Component File Structure (what Claude Code should create)

```
components/
  monitor/
    StatusBanner.tsx         ← green/red/yellow health state
    DateRangeSelector.tsx    ← preset buttons + custom modal
    KpiCards.tsx             ← 4-up metric cards
    CheckoutFunnel.tsx       ← horizontal bar funnel
    ErrorsTable.tsx          ← top errors with drill-down modal
    DroppedProductsTable.tsx ← products in abandoned carts
    LiveEventFeed.tsx        ← auto-refreshing events list
  alerts/
    ActiveAlerts.tsx
    AlertHistory.tsx
    AlertRow.tsx
  settings/
    NotificationSettings.tsx
    ThresholdSettings.tsx
    PixelHealth.tsx
  shared/
    PageWrapper.tsx          ← Polaris Page + nav wrapper
    EmptyState.tsx           ← reusable empty states
```

---

## Part 9: ROI Tracking

### The Concept
Every time an alert fires and the merchant resolves it, the app calculates the revenue recovered. This number is displayed prominently to make churn psychologically painful ("this app has saved me $4,200 this year — I'm not cancelling a $49/month subscription").

### How ROI is Calculated Per Alert Type

**Discount code alert ROI:**
```
When alert fires:
  - Record: time_alert_fired, discount_code, failure_count_at_alert_time

When merchant clicks "Mark resolved":
  - Record: time_resolved
  - Query: how many successful uses of that discount code occurred AFTER time_resolved in next 24h
  - Estimate: (successful_uses_post_resolution × avg_order_value) = revenue_recovered

Display: "You fixed WELCOME10 — estimated $340 in discount-driven orders recovered in 24h after fix"
```

**Abandonment spike alert ROI:**
```
When alert fires:
  - Record: time_alert_fired, cvr_at_alert_time, baseline_cvr, checkout_sessions_per_hour

When merchant clicks "Mark resolved":
  - Record: time_resolved
  - Measure: CVR 1 hour AFTER resolution vs CVR at time of alert
  - If CVR recovered toward baseline:
      recovered_sessions = sessions_in_next_hour × (cvr_after - cvr_during_alert)
      roi = recovered_sessions × avg_order_value

Display: "Checkout CVR recovered from 31% → 58%. Estimated $840 in orders recovered."
```

**Extension error ROI:**
```
- Compare checkout CVR in the 30 minutes before the error started 
  vs the 30 minutes after merchant marks resolved
- Delta × sessions × AOV = estimated recovery
```

**Payment failure ROI:**
```
- Same pattern: payment success rate before alert vs after resolution
- Delta × sessions × AOV
```

### Where ROI is Shown

**1. Alert History table** — "ROI saved" column (see Page 2 above)

**2. Monitor page KPI cards** — 4th card changes meaning over time:
- During active alert: "Revenue at risk: ~$X/hour"
- When all clear: "Revenue protected: $X this month" (sum of all resolved alert ROIs in current month)

**3. Settings page — a dedicated "Your ROI" summary card:**
```
┌─────────────────────────────────────────────────────┐
│  CheckoutGuard has protected your revenue           │
│                                                     │
│  This month:    $1,240 recovered                    │
│  This year:     $4,200 recovered                    │
│  Alerts fired:  12  |  Resolved: 11  |  Ignored: 1  │
│                                                     │
│  vs. your plan cost ($49/month): 25× ROI            │
└─────────────────────────────────────────────────────┘
```

That "25× ROI" line is the anti-churn weapon. A merchant who sees that never cancels.

### ROI Data Model Addition (add to Prisma schema)

```prisma
model AlertLog {
  // ... existing fields ...
  
  // ROI tracking fields
  resolvedAt        DateTime?
  resolvedBy        String?    // 'merchant' | 'auto' (if CVR recovered on its own)
  roiEstimatedUsd   Float?     // calculated on resolution
  roiMethodology    String?    // human-readable explanation of how ROI was calculated
  
  // Snapshot at time of alert (for ROI calculation)
  cvrAtAlert        Float?
  baselineCvrAtAlert Float?
  aovAtAlert        Float?
  sessionsPerHourAtAlert Int?
}
```

### Important Honesty Guardrail
ROI estimates are always labeled "estimated" — never "saved" or "earned." The tooltip on every ROI number must say: *"Estimated based on checkout recovery rate after alert was resolved. Actual revenue impact may vary."* Do not overstate. Merchants trust honest estimates; inflated numbers destroy credibility.

---

*End of specification. Version 1.2 — final for Claude Code handoff.*