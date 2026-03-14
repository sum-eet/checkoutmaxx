export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getGranularity, sparklineLabel } from '@/lib/v2/session-summary';

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

const CHECKOUT_STEPS = [
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_address_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'checkout_completed',
] as const;

const STEP_LABELS: Record<string, string> = {
  checkout_started: 'Checkout',
  checkout_contact_info_submitted: 'Contact',
  checkout_address_info_submitted: 'Address',
  checkout_shipping_info_submitted: 'Shipping',
  payment_info_submitted: 'Payment',
  checkout_completed: 'Completed',
};

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop')
    .select('id')
    .eq('shopDomain', shopDomain)
    .eq('isActive', true)
    .single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const end = new Date(req.nextUrl.searchParams.get('end') ?? new Date().toISOString());
  const start = new Date(req.nextUrl.searchParams.get('start') ?? subDays(end, 7).toISOString());
  const duration = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime());
  const prevStart = new Date(start.getTime() - duration);

  const granularity = getGranularity(start, end);

  // Fetch current period data
  const [cartEventsRes, checkoutEventsRes, prevCartRes, prevCheckoutRes, alertsRes] =
    await Promise.all([
      supabase
        .from('CartEvent')
        .select('sessionId, eventType, cartValue, cartItemCount, occurredAt')
        .eq('shopId', shop.id)
        .gte('occurredAt', start.toISOString())
        .lte('occurredAt', end.toISOString())
        .limit(5000),
      supabase
        .from('CheckoutEvent')
        .select('sessionId, eventType, totalPrice, occurredAt')
        .eq('shopId', shop.id)
        .gte('occurredAt', start.toISOString())
        .lte('occurredAt', end.toISOString())
        .limit(5000),
      supabase
        .from('CartEvent')
        .select('sessionId, eventType, cartValue, cartItemCount, occurredAt')
        .eq('shopId', shop.id)
        .gte('occurredAt', prevStart.toISOString())
        .lte('occurredAt', prevEnd.toISOString())
        .limit(5000),
      supabase
        .from('CheckoutEvent')
        .select('sessionId, eventType, totalPrice, occurredAt')
        .eq('shopId', shop.id)
        .gte('occurredAt', prevStart.toISOString())
        .lte('occurredAt', prevEnd.toISOString())
        .limit(5000),
      supabase
        .from('AlertLog')
        .select('id, alertType, severity, title, body, firedAt, metadata')
        .eq('shopId', shop.id)
        .order('firedAt', { ascending: false })
        .limit(3),
    ]);

  const cartEvents = cartEventsRes.data ?? [];
  const checkoutEvents = checkoutEventsRes.data ?? [];
  const prevCartEvents = prevCartRes.data ?? [];
  const prevCheckoutEvents = prevCheckoutRes.data ?? [];

  // ── KPI helpers ───────────────────────────────────────────────────────────────

  function computeKPIs(
    cartEvs: typeof cartEvents,
    checkEvs: typeof checkoutEvents
  ) {
    // Product sessions: distinct sessionIds where cartValue > 0 OR cartItemCount > 0
    const productSessions = new Set<string>();
    for (const e of cartEvs) {
      if ((e.cartValue ?? 0) > 0 || (e.cartItemCount ?? 0) > 0) {
        productSessions.add(e.sessionId);
      }
    }

    // Checkout sessions: cart_checkout_clicked OR checkout_started
    const checkoutClickedSessions = new Set<string>();
    for (const e of cartEvs) {
      if (e.eventType === 'cart_checkout_clicked') checkoutClickedSessions.add(e.sessionId);
    }
    const checkoutStartedSessions = new Set<string>();
    for (const e of checkEvs) {
      if (e.eventType === 'checkout_started') checkoutStartedSessions.add(e.sessionId);
    }
    const checkoutSessions = new Set([
      ...Array.from(checkoutClickedSessions),
      ...Array.from(checkoutStartedSessions),
    ]);
    const checkoutSessionsFromProducts = new Set(
      Array.from(checkoutSessions).filter((s) => productSessions.has(s))
    );

    // CVR
    const completedSessions = new Set<string>();
    const startedSessions = new Set<string>();
    for (const e of checkEvs) {
      if (e.eventType === 'checkout_completed') completedSessions.add(e.sessionId);
      if (e.eventType === 'checkout_started') startedSessions.add(e.sessionId);
    }
    const cvr = startedSessions.size > 0
      ? (completedSessions.size / startedSessions.size) * 100
      : 0;

    // AOV
    const completedPrices: number[] = [];
    for (const e of checkEvs) {
      if (e.eventType === 'checkout_completed' && e.totalPrice != null) {
        completedPrices.push(e.totalPrice);
      }
    }
    const aov = completedPrices.length > 0
      ? completedPrices.reduce((a, b) => a + b, 0) / completedPrices.length
      : 0;

    const checkoutRate =
      productSessions.size > 0
        ? (checkoutSessionsFromProducts.size / productSessions.size) * 100
        : 0;

    return {
      cartSessions: productSessions.size,
      checkoutRate,
      checkoutNumerator: checkoutSessionsFromProducts.size,
      checkoutDenominator: productSessions.size,
      cvr,
      cvrNumerator: completedSessions.size,
      cvrDenominator: startedSessions.size,
      aov,
      aovCount: completedPrices.length,
    };
  }

  // ── Sparkline builder ─────────────────────────────────────────────────────────

  function buildSparklines(
    cartEvs: typeof cartEvents,
    checkEvs: typeof checkoutEvents,
    rangeStart: Date,
    rangeEnd: Date,
    gran: 'hour' | 'day' | 'week'
  ) {
    // Build time buckets
    const buckets: Map<string, {
      productSessions: Set<string>;
      checkoutSessions: Set<string>;
      completedSessions: Set<string>;
      startedSessions: Set<string>;
      aovValues: number[];
    }> = new Map();

    function getBucketKey(iso: string): string {
      const d = new Date(iso);
      if (gran === 'hour') {
        d.setMinutes(0, 0, 0);
      } else if (gran === 'day') {
        d.setHours(0, 0, 0, 0);
      } else {
        // week — floor to Monday
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setDate(diff);
        d.setHours(0, 0, 0, 0);
      }
      return d.toISOString();
    }

    // Pre-create all buckets
    const step =
      gran === 'hour' ? 3600_000 : gran === 'day' ? 86400_000 : 7 * 86400_000;
    let cursor = new Date(rangeStart);
    if (gran === 'day') cursor.setHours(0, 0, 0, 0);
    if (gran === 'week') {
      const day = cursor.getDay();
      const diff = cursor.getDate() - day + (day === 0 ? -6 : 1);
      cursor.setDate(diff);
      cursor.setHours(0, 0, 0, 0);
    }
    while (cursor <= rangeEnd) {
      const key = cursor.toISOString();
      buckets.set(key, {
        productSessions: new Set(),
        checkoutSessions: new Set(),
        completedSessions: new Set(),
        startedSessions: new Set(),
        aovValues: [],
      });
      cursor = new Date(cursor.getTime() + step);
    }

    function getOrCreate(key: string) {
      if (!buckets.has(key)) {
        buckets.set(key, {
          productSessions: new Set(),
          checkoutSessions: new Set(),
          completedSessions: new Set(),
          startedSessions: new Set(),
          aovValues: [],
        });
      }
      return buckets.get(key)!;
    }

    for (const e of cartEvs) {
      const key = getBucketKey(e.occurredAt);
      const b = getOrCreate(key);
      if ((e.cartValue ?? 0) > 0 || (e.cartItemCount ?? 0) > 0) {
        b.productSessions.add(e.sessionId);
      }
      if (e.eventType === 'cart_checkout_clicked') b.checkoutSessions.add(e.sessionId);
    }

    for (const e of checkEvs) {
      const key = getBucketKey(e.occurredAt);
      const b = getOrCreate(key);
      if (e.eventType === 'checkout_started') {
        b.startedSessions.add(e.sessionId);
        b.checkoutSessions.add(e.sessionId);
      }
      if (e.eventType === 'checkout_completed') {
        b.completedSessions.add(e.sessionId);
        if (e.totalPrice != null) b.aovValues.push(e.totalPrice);
      }
    }

    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    return {
      cartSessions: sorted.map(([k, b]) => ({
        label: sparklineLabel(new Date(k), gran),
        value: b.productSessions.size,
      })),
      checkoutRate: sorted.map(([k, b]) => ({
        label: sparklineLabel(new Date(k), gran),
        value:
          b.productSessions.size > 0
            ? Math.round((b.checkoutSessions.size / b.productSessions.size) * 1000) / 10
            : 0,
      })),
      cvr: sorted.map(([k, b]) => ({
        label: sparklineLabel(new Date(k), gran),
        value:
          b.startedSessions.size > 0
            ? Math.round((b.completedSessions.size / b.startedSessions.size) * 1000) / 10
            : 0,
      })),
      aov: sorted.map(([k, b]) => ({
        label: sparklineLabel(new Date(k), gran),
        value:
          b.aovValues.length > 0
            ? Math.round((b.aovValues.reduce((a, x) => a + x, 0) / b.aovValues.length) * 100) / 100
            : 0,
      })),
    };
  }

  // ── Funnel builder ────────────────────────────────────────────────────────────

  function computeFunnel(checkEvs: typeof checkoutEvents) {
    const countByType = new Map<string, Set<string>>();
    for (const step of CHECKOUT_STEPS) countByType.set(step, new Set());

    for (const e of checkEvs) {
      if (countByType.has(e.eventType)) {
        countByType.get(e.eventType)!.add(e.sessionId);
      }
    }

    const startedCount = countByType.get('checkout_started')!.size;

    let prevSessions = startedCount;
    return CHECKOUT_STEPS.map((step, i) => {
      const sessions = countByType.get(step)!.size;
      const pct = startedCount > 0 ? Math.round((sessions / startedCount) * 1000) / 10 : 0;
      const dropped = i === 0 ? 0 : Math.max(0, prevSessions - sessions);
      const dropRate =
        startedCount > 0 ? Math.round((dropped / startedCount) * 1000) / 10 : 0;
      prevSessions = sessions;

      return {
        step,
        label: STEP_LABELS[step],
        sessions,
        pct,
        dropped,
        dropRate,
        dropRateDelta: 0, // filled in below
      };
    });
  }

  // ── Compute everything ────────────────────────────────────────────────────────

  const curr = computeKPIs(cartEvents, checkoutEvents);
  const prev = computeKPIs(prevCartEvents, prevCheckoutEvents);

  const sparklines = buildSparklines(cartEvents, checkoutEvents, start, end, granularity);
  const prevSparklines = buildSparklines(prevCartEvents, prevCheckoutEvents, prevStart, prevEnd, granularity);

  const currentFunnel = computeFunnel(checkoutEvents);
  const previousFunnel = computeFunnel(prevCheckoutEvents);

  // Add drop rate delta
  for (let i = 0; i < currentFunnel.length; i++) {
    currentFunnel[i].dropRateDelta =
      Math.round((currentFunnel[i].dropRate - (previousFunnel[i]?.dropRate ?? 0)) * 10) / 10;
  }

  const pctChange = (curr: number, prev: number) =>
    prev === 0 ? 0 : Math.round(((curr - prev) / prev) * 1000) / 10;
  const ppChange = (curr: number, prev: number) =>
    Math.round((curr - prev) * 10) / 10;
  const dollarChange = (curr: number, prev: number) =>
    Math.round((curr - prev) * 100) / 100;

  const recentAlerts = (alertsRes.data ?? []).map((a) => ({
    id: a.id,
    alertType: a.alertType,
    severity: a.severity,
    title: a.title,
    body: a.body,
    occurredAt: a.firedAt,
    metadata: a.metadata,
  }));

  return NextResponse.json({
    kpis: {
      cartSessions: {
        value: curr.cartSessions,
        previous: prev.cartSessions,
        delta: pctChange(curr.cartSessions, prev.cartSessions),
        sparkline: sparklines.cartSessions,
        prevSparkline: prevSparklines.cartSessions,
      },
      checkoutRate: {
        value: Math.round(curr.checkoutRate * 10) / 10,
        previous: Math.round(prev.checkoutRate * 10) / 10,
        delta: ppChange(curr.checkoutRate, prev.checkoutRate),
        numerator: curr.checkoutNumerator,
        denominator: curr.checkoutDenominator,
        sparkline: sparklines.checkoutRate,
        prevSparkline: prevSparklines.checkoutRate,
      },
      cvr: {
        value: Math.round(curr.cvr * 10) / 10,
        previous: Math.round(prev.cvr * 10) / 10,
        delta: ppChange(curr.cvr, prev.cvr),
        numerator: curr.cvrNumerator,
        denominator: curr.cvrDenominator,
        sparkline: sparklines.cvr,
        prevSparkline: prevSparklines.cvr,
      },
      aov: {
        value: Math.round(curr.aov * 100) / 100,
        previous: Math.round(prev.aov * 100) / 100,
        delta: dollarChange(curr.aov, prev.aov),
        orderCount: curr.aovCount,
        sparkline: sparklines.aov,
        prevSparkline: prevSparklines.aov,
      },
    },
    funnel: {
      current: currentFunnel,
      previous: previousFunnel,
    },
    recentAlerts,
  });
}
