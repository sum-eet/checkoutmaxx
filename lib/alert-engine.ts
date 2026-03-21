import { supabase } from './supabase';
import prisma from './prisma';
import { sendAlertEmail } from './send-email';
import { sendSlackMessage } from './send-slack';

const COOLDOWN_HOURS = 4;

export async function evaluateAlerts() {
  // Get all active shops
  const shops = await prisma.shop.findMany({ where: { isActive: true } });
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000);

  for (const shop of shops) {
    try {
      // 1. Get coupon failure counts in last 2 hours, grouped by code
      const { data: failEvents } = await supabase
        .from('CartEvent')
        .select('couponCode, eventType')
        .eq('shopId', shop.id)
        .gte('occurredAt', twoHoursAgo.toISOString())
        .in('eventType', ['cart_coupon_applied', 'cart_coupon_failed']);

      if (!failEvents || failEvents.length === 0) continue;

      // Group by code
      const codeStats = new Map<string, { applied: number; failed: number }>();
      for (const ev of failEvents) {
        if (!ev.couponCode) continue;
        const code = ev.couponCode.toUpperCase();
        const stats = codeStats.get(code) ?? { applied: 0, failed: 0 };
        if (ev.eventType === 'cart_coupon_applied') stats.applied++;
        else stats.failed++;
        codeStats.set(code, stats);
      }

      // 2. Check each code against threshold
      const threshold = (shop as Record<string, unknown>).discountFailureMin as number ?? 3;

      for (const [code, stats] of Array.from(codeStats)) {
        if (stats.failed < threshold) continue;

        const failRate = Math.round((stats.failed / (stats.failed + stats.applied)) * 100);

        // Check cooldown — was a similar alert sent recently?
        const recentAlert = await prisma.alertLog.findFirst({
          where: {
            shopId: shop.id,
            title: { contains: code },
            firedAt: { gte: cooldownCutoff },
          },
        });
        if (recentAlert) continue;

        // 3. Fire alert
        const title = `Code ${code} failed ${stats.failed} times (${failRate}% failure rate)`;
        const body = `In the last 2 hours, ${stats.failed} customers tried code ${code} and it didn't work. ${stats.applied} uses succeeded. Check if this code has expired, hit its usage limit, or has collection restrictions.`;

        // Log to AlertLog
        await prisma.alertLog.create({
          data: {
            shopId: shop.id,
            alertType: 'failed_discount',
            severity: failRate >= 80 ? 'critical' : 'warning',
            title,
            body,
            metadata: { code, failedCount: stats.failed, appliedCount: stats.applied, failRate },
          },
        });

        // Send email
        const alertEmail = (shop as Record<string, unknown>).alertEmail as string | null;
        if (alertEmail) {
          await sendAlertEmail({
            to: alertEmail,
            title,
            body,
            actionUrl: `https://couponmaxx.vercel.app/couponmaxx/coupons`,
            actionLabel: 'View coupons',
            shopDomain: shop.shopDomain,
          });
        }

        // Send Slack
        const slackUrl = (shop as Record<string, unknown>).slackWebhookUrl as string | null;
        if (slackUrl) {
          await sendSlackMessage({
            webhookUrl: slackUrl,
            title,
            body,
            actionUrl: `https://couponmaxx.vercel.app/couponmaxx/coupons`,
            actionLabel: 'View coupons',
            shopDomain: shop.shopDomain,
          });
        }

        console.log(`[evaluate-alerts] Fired alert for ${shop.shopDomain}: ${title}`);
      }
    } catch (err) {
      console.error(`[evaluate-alerts] Error for ${shop.shopDomain}:`, (err as Error).message);
    }
  }
}
