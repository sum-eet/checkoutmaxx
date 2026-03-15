export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86400000);
}

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const end = new Date(req.nextUrl.searchParams.get('end') ?? new Date().toISOString());
  const start = new Date(req.nextUrl.searchParams.get('start') ?? subDays(end, 7).toISOString());
  const severity = req.nextUrl.searchParams.get('severity') ?? '';

  let query = supabase.from('AlertLog')
    .select('id, title, body, severity, firedAt, isRead, resolvedAt, linkType, linkValue')
    .eq('shopId', shop.id)
    .gte('firedAt', start.toISOString())
    .lte('firedAt', end.toISOString())
    .order('firedAt', { ascending: false })
    .limit(200);

  if (severity) query = query.eq('severity', severity);

  const { data: alerts, error } = await query;

  if (error && error.message?.includes('column') && error.message?.includes('does not exist')) {
    return NextResponse.json({ error: 'AlertLog schema missing columns. Run supabase/alertlog-isread.sql.' }, { status: 503 });
  }

  const rows = (alerts ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    body: (a as Record<string, unknown>).body ?? null,
    severity: (a as Record<string, unknown>).severity ?? 'info',
    firedAt: a.firedAt,
    isRead: (a as Record<string, unknown>).isRead ?? false,
    resolvedAt: a.resolvedAt ?? null,
    linkType: (a as Record<string, unknown>).linkType ?? null,
    linkValue: (a as Record<string, unknown>).linkValue ?? null,
  }));

  const unread = rows.filter((r) => !r.isRead).length;
  const critical = rows.filter((r) => r.severity === 'critical').length;
  const warnings = rows.filter((r) => r.severity === 'warning').length;

  return NextResponse.json({
    summary: { unread, critical, warnings, total: rows.length },
    alerts: rows,
  });
}
