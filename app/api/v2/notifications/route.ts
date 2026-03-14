export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function mapSeverity(s: string): 'critical' | 'warning' | 'info' {
  if (s === 'critical') return 'critical';
  if (s === 'warning') return 'warning';
  return 'info';
}

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
  const severityFilter = req.nextUrl.searchParams.get('severity') ?? 'all';

  let query = supabase
    .from('AlertLog')
    .select('id, alertType, severity, title, body, firedAt, metadata, isRead')
    .eq('shopId', shop.id)
    .gte('firedAt', start.toISOString())
    .lte('firedAt', end.toISOString())
    .order('firedAt', { ascending: false })
    .limit(200);

  if (severityFilter !== 'all' && severityFilter !== 'dismissed') {
    query = query.eq('severity', severityFilter);
  }

  const { data: alerts } = await query;

  const mapped = (alerts ?? []).map((a) => {
    const meta = (a.metadata ?? {}) as Record<string, unknown>;

    // Derive link type from alertType
    let linkType: 'overview' | 'discounts' | 'cart' | null = null;
    let linkCode: string | null = null;

    if (a.alertType?.includes('discount') || a.alertType?.includes('coupon')) {
      linkType = 'discounts';
      linkCode = (meta.discount_code as string) ?? (meta.code as string) ?? null;
    } else if (a.alertType?.includes('cvr') || a.alertType?.includes('conversion') || a.alertType?.includes('step')) {
      linkType = 'overview';
    } else if (a.alertType?.includes('cart') || a.alertType?.includes('recovery')) {
      linkType = 'cart';
    }

    return {
      id: a.id,
      severity: mapSeverity(a.severity ?? 'info'),
      title: a.title ?? '',
      body: a.body ?? '',
      occurredAt: a.firedAt,
      isRead: a.isRead ?? false,
      isDismissed: false, // client-side only in v2
      linkType,
      linkCode,
    };
  });

  const unread = mapped.filter((a) => !a.isRead).length;
  const critical = mapped.filter((a) => a.severity === 'critical').length;
  const warnings = mapped.filter((a) => a.severity === 'warning').length;

  return NextResponse.json({
    summary: { unread, critical, warnings },
    alerts: mapped,
  });
}
