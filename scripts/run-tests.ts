import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['error'],
});

async function main() {
  console.log('=== CheckoutMaxx DB Test Suite ===');
  console.log('Run time:', new Date().toISOString());
  console.log('');

  // T15-Q1: Noise events (should be 0)
  const noiseCount = await prisma.cartEvent.count({
    where: { eventType: { in: ['cart_fetched', 'cart_fetch_error', 'cart_non_json_response', 'cart_xhr_parse_error', 'cart_unknown_endpoint'] } }
  });

  // T15-Q3: URLs with query params (should be 0)
  const urlsWithParams = await prisma.cartEvent.count({
    where: { pageUrl: { contains: '?' } }
  });

  // T15-Q4: Coupon events without couponCode (should be 0)
  const couponWithoutCode = await prisma.cartEvent.count({
    where: { eventType: { startsWith: 'cart_coupon_' }, couponCode: { equals: null } }
  });

  // T15-Q5: Checkout clicks without cartToken (should be 0 empty strings; null not possible)
  const checkoutWithoutToken = await prisma.cartEvent.count({
    where: { eventType: 'cart_checkout_clicked', cartToken: '' }
  });

  // T15-Q6: Duplicate coupon_failed per session per code
  const allFailed = await prisma.cartEvent.findMany({
    where: { eventType: 'cart_coupon_failed' },
    select: { sessionId: true, couponCode: true }
  });

  // T12: Coupon stats by code
  const couponStats = await prisma.cartEvent.groupBy({
    by: ['couponCode'],
    where: { couponCode: { not: null as any }, eventType: { in: ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'] } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } }
  });

  // T13: KPI counts for today
  const today = new Date(); today.setHours(0,0,0,0);

  const cartsOpened = await prisma.cartEvent.findMany({
    where: { occurredAt: { gte: today } },
    select: { sessionId: true },
    distinct: ['sessionId']
  });

  const cartsWithCoupon = await prisma.cartEvent.findMany({
    where: { occurredAt: { gte: today }, eventType: { in: ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'] } },
    select: { sessionId: true },
    distinct: ['sessionId']
  });

  const cartsCheckedOut = await prisma.cartEvent.findMany({
    where: { occurredAt: { gte: today }, eventType: 'cart_checkout_clicked' },
    select: { sessionId: true },
    distinct: ['sessionId']
  });

  const recoveredToday = await prisma.cartEvent.findMany({
    where: { occurredAt: { gte: today }, eventType: 'cart_coupon_recovered' },
    select: { sessionId: true, cartValue: true },
    distinct: ['sessionId']
  });

  // T2: Check lineItems populated on cart_item_added
  const itemAddedWithItems = await prisma.cartEvent.count({
    where: { eventType: 'cart_item_added', NOT: { lineItems: { equals: 'DbNull' as any } } }
  });
  const itemAddedWithoutItems = await prisma.cartEvent.count({
    where: { eventType: 'cart_item_added', lineItems: { equals: 'DbNull' as any } }
  });

  // All event types breakdown
  const eventBreakdown = await prisma.cartEvent.groupBy({
    by: ['eventType'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } }
  });

  // Sample lineItems to check for PII
  const sampleItems = await prisma.cartEvent.findMany({
    where: { NOT: { lineItems: { equals: 'DbNull' as any } } },
    select: { id: true, lineItems: true, eventType: true },
    take: 3
  });

  // All sessions today with their events
  const sessionSummary = await prisma.cartEvent.groupBy({
    by: ['sessionId'],
    where: { occurredAt: { gte: today } },
    _count: { id: true }
  });

  // HYDRATEFIRST check
  const hydrateFirst = await prisma.cartEvent.findMany({
    where: { couponCode: 'HYDRATEFIRST' },
    select: { id: true, eventType: true, couponSuccess: true, occurredAt: true, sessionId: true }
  });

  // Check sessionId join: sessions in CartEvent that also appear in CheckoutEvent
  const cartSessionIds = await prisma.cartEvent.findMany({
    select: { sessionId: true },
    distinct: ['sessionId']
  });
  const cartSids = cartSessionIds.map((r: { sessionId: string }) => r.sessionId);
  const matchingCheckout = await prisma.checkoutEvent.findMany({
    where: { sessionId: { in: cartSids } },
    select: { sessionId: true, eventType: true, occurredAt: true },
    orderBy: { occurredAt: 'asc' }
  });

  // Total event count
  const totalEvents = await prisma.cartEvent.count();

  // Date range of events
  const oldest = await prisma.cartEvent.findFirst({ orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } });
  const newest = await prisma.cartEvent.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } });

  // ── Print Results ─────────────────────────────────────────────────────────

  console.log('=== T15-Q1: NOISE EVENTS (should be 0) ===', noiseCount);
  console.log('=== T15-Q3: URLS WITH PARAMS (should be 0) ===', urlsWithParams);
  console.log('=== T15-Q4: COUPON WITHOUT CODE (should be 0) ===', couponWithoutCode);
  console.log('=== T15-Q5: CHECKOUT WITHOUT TOKEN (should be 0) ===', checkoutWithoutToken);

  console.log('\n=== T15-Q6: DUPLICATE FAILED EVENTS ===');
  const failedMap = new Map<string, number>();
  allFailed.forEach((r: { sessionId: string; couponCode: string | null }) => {
    const k = r.sessionId + '|' + r.couponCode;
    failedMap.set(k, (failedMap.get(k) || 0) + 1);
  });
  const dupes = Array.from(failedMap.entries()).filter(([,v]) => v > 1);
  console.log('Dupes found:', dupes.length, JSON.stringify(dupes, null, 2));

  console.log('\n=== T12: COUPON STATS ===');
  console.log(JSON.stringify(couponStats, null, 2));

  console.log('\n=== T13: TODAY KPIs ===');
  console.log('Today start:', today.toISOString());
  console.log('Carts opened:', cartsOpened.length);
  console.log('Carts with coupon:', cartsWithCoupon.length);
  console.log('Carts checked out:', cartsCheckedOut.length);
  console.log('Recovered carts:', recoveredToday.length);
  console.log('Recovered revenue (cents):', recoveredToday.reduce((s: number, r: { cartValue: number | null }) => s + (r.cartValue || 0), 0));

  console.log('\n=== T2: LINE ITEMS ===');
  console.log('cart_item_added WITH lineItems:', itemAddedWithItems);
  console.log('cart_item_added WITHOUT lineItems:', itemAddedWithoutItems);

  console.log('\n=== EVENT BREAKDOWN ===');
  console.log(JSON.stringify(eventBreakdown, null, 2));

  console.log('\n=== DB TOTALS ===');
  console.log('Total CartEvent rows:', totalEvents);
  console.log('Oldest event:', oldest?.occurredAt?.toISOString() ?? 'none');
  console.log('Newest event:', newest?.occurredAt?.toISOString() ?? 'none');

  console.log('\n=== SAMPLE LINE ITEMS (PII check) ===');
  console.log(JSON.stringify(sampleItems, null, 2));

  console.log('\n=== SESSION SUMMARY TODAY ===');
  console.log('Sessions today:', sessionSummary.length);
  console.log(JSON.stringify(sessionSummary, null, 2));

  console.log('\n=== T4: HYDRATEFIRST ROWS ===');
  console.log(JSON.stringify(hydrateFirst, null, 2));

  console.log('\n=== T10: SESSION JOIN (CartEvent sessions that have CheckoutEvent rows) ===');
  console.log('Total CartEvent sessions:', cartSids.length);
  console.log('Sessions with matching CheckoutEvents:', new Set(matchingCheckout.map((r: { sessionId: string }) => r.sessionId)).size);
  console.log('Matching checkout events:', JSON.stringify(matchingCheckout, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('SCRIPT ERROR:', err);
  process.exit(1);
});
