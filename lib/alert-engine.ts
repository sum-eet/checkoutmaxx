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

        // 3. Enrich with cart value + recovery stats
        const { data: failedSessions } = await supabase
          .from('CartEvent')
          .select('sessionId, cartValue')
          .eq('shopId', shop.id)
          .eq('couponCode', code)
          .eq('eventType', 'cart_coupon_failed')
          .gte('occurredAt', twoHoursAgo.toISOString());

        const affectedSessionIds = Array.from(new Set((failedSessions ?? []).map((s: Record<string, unknown>) => s.sessionId as string)));
        const totalCartValue = (failedSessions ?? []).reduce((sum: number, s: Record<string, unknown>) => sum + ((s.cartValue as number) ?? 0), 0);

        // How many of those sessions reached checkout (completed)?
        const { count: completedCount } = await supabase
          .from('CartEvent')
          .select('*', { count: 'exact', head: true })
          .eq('shopId', shop.id)
          .eq('eventType', 'cart_checkout_clicked')
          .in('sessionId', affectedSessionIds.slice(0, 50)); // cap for query perf

        const abandonedCount = affectedSessionIds.length - (completedCount ?? 0);
        const abandonedValue = Math.round(totalCartValue * (abandonedCount / Math.max(affectedSessionIds.length, 1)));
        const recoveredValue = totalCartValue - abandonedValue;

        // Recovery events for this code in the same window
        const { data: recoveryEvents } = await supabase
          .from('RecoveryEvent')
          .select('recoveryUsed, revenueRecovered, recoveryAction')
          .eq('shopId', shop.id)
          .eq('failedCode', code)
          .gte('createdAt', twoHoursAgo.toISOString());

        const recOffered = (recoveryEvents ?? []).filter((r: Record<string, unknown>) => r.recoveryAction === 'show_code').length;
        const recUsed    = (recoveryEvents ?? []).filter((r: Record<string, unknown>) => r.recoveryUsed).length;
        const recRevenue = (recoveryEvents ?? []).reduce((sum: number, r: Record<string, unknown>) =>
          sum + (r.recoveryUsed && r.revenueRecovered ? (r.revenueRecovered as number) : 0), 0);

        // 4. Fire alert
        const title = `Code ${code} failed ${stats.failed} times today`;

        const bodyLines = [
          `Cart value at risk: $${(totalCartValue / 100).toFixed(2)}`,
          `Customers affected: ${affectedSessionIds.length}`,
          `Abandoned after failure: ${abandonedCount} ($${(abandonedValue / 100).toFixed(2)} in cart value left behind)`,
          `Completed anyway: ${completedCount ?? 0}`,
          '',
        ];

        if (recOffered > 0) {
          bodyLines.push(
            `\u2192 Smart Recovery caught ${recOffered} of these and offered a fallback code.`,
            recUsed > 0
              ? `  ${recUsed} customer${recUsed > 1 ? 's' : ''} used it \u2014 $${(recRevenue / 100).toFixed(2)} recovered.`
              : `  None used it yet.`,
            '',
          );
        }

        bodyLines.push(
          `\u2192 Fix this code: https://couponmaxx.vercel.app/couponmaxx/coupons`,
          `\u2192 View recovery stats: https://couponmaxx.vercel.app/couponmaxx/analytics`,
        );

        const body = bodyLines.join('\n');

        // Log to AlertLog
        await prisma.alertLog.create({
          data: {
            shopId: shop.id,
            alertType: 'failed_discount',
            severity: failRate >= 80 ? 'critical' : 'warning',
            title,
            body,
            metadata: {
              code,
              failedCount: stats.failed,
              appliedCount: stats.applied,
              failRate,
              cartValueAtRisk: totalCartValue,
              abandonedCount,
              abandonedValue,
              recoveredValue,
              recOffered,
              recUsed,
              recRevenue,
            },
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
