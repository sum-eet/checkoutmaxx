export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopDomain = p.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const severity = p.get('severity') ?? '';
  let query = supabase.from('AlertLog')
    .select('id, title, body, severity, firedAt, isRead, isDismissed')
    .eq('shopId', shop.id)
    .order('firedAt', { ascending: false })
    .limit(100);

  if (severity) query = query.eq('severity', severity);

  const { data: alerts, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });

  const rows = (alerts ?? []).map((a) => ({
    id: a.id,
    severity: (a as Record<string, unknown>).severity ?? 'info',
    title: a.title,
    body: (a as Record<string, unknown>).body ?? null,
    occurredAt: a.firedAt,
    isRead: (a as Record<string, unknown>).isRead ?? false,
    isDismissed: (a as Record<string, unknown>).isDismissed ?? false,
  }));

  const unread = rows.filter((r) => !r.isRead && !r.isDismissed).length;
  const critical = rows.filter((r) => r.severity === 'critical' && !r.isDismissed).length;
  const warnings = rows.filter((r) => r.severity === 'warning' && !r.isDismissed).length;

  return NextResponse.json({
    summary: { unreadCount: unread, criticalCount: critical, warningCount: warnings },
    alerts: rows,
  });
}
