import prisma from "./prisma";
import { sendAlertEmail } from "./send-email";
import { sendSlackMessage } from "./send-slack";

const ALERT_COOLDOWN_MINUTES = 120;
const ABANDONMENT_THRESHOLD = 0.20;
const PAYMENT_FAILURE_THRESHOLD = 0.15;
const DISCOUNT_FAILURE_MIN_COUNT = 3;

export async function evaluateAlerts() {
  const shops = await prisma.shop.findMany({ where: { isActive: true } });
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  for (const shop of shops) {
    // Silent learning period: skip shops with < 48h of data
    const firstEvent = await prisma.checkoutEvent.findFirst({
      where: { shopId: shop.id },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    });
    if (!firstEvent || firstEvent.occurredAt > fortyEightHoursAgo) continue;

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
  if (await isOnCooldown(shop.id, "abandonment_spike")) return;

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [started, completed] = await Promise.all([
    prisma.checkoutEvent.count({
      where: { shopId: shop.id, eventType: "checkout_started", occurredAt: { gte: oneHourAgo } },
    }),
    prisma.checkoutEvent.count({
      where: { shopId: shop.id, eventType: "checkout_completed", occurredAt: { gte: oneHourAgo } },
    }),
  ]);

  if (started < 10) return;

  const currentCVR = completed / started;

  const baseline = await prisma.baseline.findFirst({
    where: { shopId: shop.id, metricName: "checkout_cvr" },
    orderBy: { computedAt: "desc" },
  });

  if (!baseline) return;

  const threshold = shop.abandonmentThreshold ?? ABANDONMENT_THRESHOLD;
  const drop = (baseline.value - currentCVR) / baseline.value;

  if (drop >= threshold) {
    const aov = await getAOV(shop.id);
    const missedConversions = Math.round(started * (baseline.value - currentCVR));
    const estimatedLostRevenue = Math.round(missedConversions * aov);

    await fireAlert(shop, {
      alertType: "abandonment_spike",
      severity: "critical",
      title: "Checkout abandonment spike detected",
      body: `Your checkout completion rate dropped to ${(currentCVR * 100).toFixed(1)}% (normally ${(baseline.value * 100).toFixed(1)}%) — a ${(drop * 100).toFixed(0)}% drop.\nEstimated revenue at risk this hour: ~$${estimatedLostRevenue}.\nProbable cause: Payment gateway issue, broken checkout extension, or a recent theme/app change.\nAction: Review your active checkout apps and payment settings.`,
      metadata: { currentCVR, baseline: baseline.value, drop, estimatedLostRevenue, started, completed },
      actionUrl: `https://${shop.shopDomain}/admin/settings/payments`,
      actionLabel: "Check payment settings in Shopify",
      cvrAtAlert: currentCVR,
      baselineCvrAtAlert: baseline.value,
      aovAtAlert: aov,
      sessionsPerHourAtAlert: started,
    });
  }
}

async function checkFailedDiscounts(shop: any) {
  if (!shop.alertDiscountEnabled) return;
  if (await isOnCooldown(shop.id, "failed_discount")) return;

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const discountAlerts = await prisma.checkoutEvent.findMany({
    where: {
      shopId: shop.id,
      eventType: "alert_displayed",
      occurredAt: { gte: oneHourAgo },
      discountCode: { not: null },
    },
  });

  const grouped: Record<string, number> = {};
  for (const event of discountAlerts) {
    if (event.discountCode) {
      grouped[event.discountCode] = (grouped[event.discountCode] || 0) + 1;
    }
  }

  const minCount = shop.discountFailureMin ?? DISCOUNT_FAILURE_MIN_COUNT;

  for (const [code, count] of Object.entries(grouped)) {
    if (count >= minCount) {
      await fireAlert(shop, {
        alertType: "failed_discount",
        severity: "critical",
        title: `Discount code "${code}" is failing at checkout`,
        body: `Your code "${code}" has failed ${count} times in the last hour — customers are being rejected at checkout.\nProbable cause: Code may be expired, usage limit reached, or minimum order requirement not met.\nAction: Open the discount in Shopify admin and check its status, expiry date, and usage count.`,
        metadata: { code, failureCount: count },
        actionUrl: `https://${shop.shopDomain}/admin/discounts`,
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
      eventType: "ui_extension_errored",
      occurredAt: { gte: fiveMinutesAgo },
    },
  });

  if (errors.length === 0) return;

  const grouped: Record<string, { count: number; message: string }> = {};
  for (const err of errors) {
    const key = err.extensionId || "unknown";
    grouped[key] = {
      count: (grouped[key]?.count || 0) + 1,
      message: err.errorMessage || "Unknown error",
    };
  }

  for (const [extId, { count, message }] of Object.entries(grouped)) {
    const alreadyAlerted = await isOnCooldown(shop.id, `extension_error_${extId}`);
    if (alreadyAlerted) continue;

    await fireAlert(shop, {
      alertType: "extension_error",
      severity: "critical",
      title: "Checkout extension is broken",
      body: `Extension ${extId} has thrown errors in ${count} checkout session(s) in the last 5 minutes.\nError: "${message}"\nProbable cause: A recent app update introduced a bug, or there's a conflict with your current theme.\nAction: Disable this extension immediately to restore checkout, then contact the app developer.`,
      metadata: { extensionId: extId, count, message },
      actionUrl: `https://${shop.shopDomain}/admin/apps`,
      actionLabel: "Manage checkout apps in Shopify",
    });
  }
}

async function checkPaymentFailures(shop: any) {
  if (!shop.alertPaymentEnabled) return;
  if (await isOnCooldown(shop.id, "payment_failure")) return;

  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

  const paymentAttempts = await prisma.checkoutEvent.count({
    where: { shopId: shop.id, eventType: "payment_info_submitted", occurredAt: { gte: thirtyMinutesAgo } },
  });

  if (paymentAttempts < 5) return;

  const submittedSessions = await prisma.checkoutEvent.findMany({
    where: { shopId: shop.id, eventType: "payment_info_submitted", occurredAt: { gte: thirtyMinutesAgo } },
    select: { sessionId: true, gatewayName: true },
  });

  const completedSessionIds = new Set(
    (
      await prisma.checkoutEvent.findMany({
        where: {
          shopId: shop.id,
          eventType: "checkout_completed",
          occurredAt: { gte: thirtyMinutesAgo },
          sessionId: { in: submittedSessions.map((s) => s.sessionId) },
        },
        select: { sessionId: true },
      })
    ).map((e) => e.sessionId)
  );

  const failedSessions = submittedSessions.filter((s) => !completedSessionIds.has(s.sessionId));
  const threshold = shop.paymentFailureRate ?? PAYMENT_FAILURE_THRESHOLD;
  const failureRate = failedSessions.length / paymentAttempts;

  if (failureRate >= threshold) {
    const topGateway = getMostCommonGateway(failedSessions);
    await fireAlert(shop, {
      alertType: "payment_failure",
      severity: "critical",
      title: "Payment failures are unusually high",
      body: `${(failureRate * 100).toFixed(0)}% of payment attempts in the last 30 minutes did not complete (${failedSessions.length} of ${paymentAttempts}).\nMost affected gateway: ${topGateway}.\nProbable cause: Payment gateway outage, card validation issue, or a broken checkout extension.\nAction: Check your payment settings and verify ${topGateway}'s status page.`,
      metadata: { failureRate, failedCount: failedSessions.length, totalAttempts: paymentAttempts, topGateway },
      actionUrl: `https://${shop.shopDomain}/admin/settings/payments`,
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

async function getAOV(shopId: string): Promise<number> {
  const result = await prisma.checkoutEvent.aggregate({
    where: { shopId, eventType: "checkout_completed" },
    _avg: { totalPrice: true },
  });
  return result._avg.totalPrice || 50;
}

async function fireAlert(
  shop: any,
  alert: {
    alertType: string;
    severity: string;
    title: string;
    body: string;
    metadata: object;
    actionUrl?: string;
    actionLabel?: string;
    cvrAtAlert?: number;
    baselineCvrAtAlert?: number;
    aovAtAlert?: number;
    sessionsPerHourAtAlert?: number;
  }
) {
  let sentEmail = false;
  let sentSlack = false;

  // Send email
  if (shop.alertEmailEnabled && shop.alertEmail) {
    try {
      await sendAlertEmail({
        to: shop.alertEmail,
        title: alert.title,
        body: alert.body,
        actionUrl: alert.actionUrl,
        actionLabel: alert.actionLabel,
        shopDomain: shop.shopDomain,
      });
      sentEmail = true;
    } catch (err) {
      console.error(`[alert] Email send failed for ${shop.shopDomain}:`, err);
    }
  }

  // Send Slack
  if (shop.alertSlackEnabled && shop.slackWebhookUrl) {
    try {
      await sendSlackMessage({
        webhookUrl: shop.slackWebhookUrl,
        title: alert.title,
        body: alert.body,
        actionUrl: alert.actionUrl,
        actionLabel: alert.actionLabel,
        shopDomain: shop.shopDomain,
      });
      sentSlack = true;
    } catch (err) {
      console.error(`[alert] Slack send failed for ${shop.shopDomain}:`, err);
    }
  }

  await prisma.alertLog.create({
    data: {
      shopId: shop.id,
      alertType: alert.alertType,
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      metadata: alert.metadata,
      actionUrl: alert.actionUrl,
      actionLabel: alert.actionLabel,
      sentEmail,
      sentSlack,
      cvrAtAlert: alert.cvrAtAlert,
      baselineCvrAtAlert: alert.baselineCvrAtAlert,
      aovAtAlert: alert.aovAtAlert,
      sessionsPerHourAtAlert: alert.sessionsPerHourAtAlert,
    },
  });

  console.log(`[alert] Fired ${alert.alertType} for ${shop.shopDomain} | email:${sentEmail} slack:${sentSlack}`);
}

function getMostCommonGateway(sessions: { gatewayName: string | null }[]): string {
  const counts: Record<string, number> = {};
  for (const s of sessions) {
    if (s.gatewayName) counts[s.gatewayName] = (counts[s.gatewayName] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
}
