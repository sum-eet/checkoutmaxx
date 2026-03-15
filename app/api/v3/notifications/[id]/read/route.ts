export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const shopDomain = body.shop ?? req.nextUrl.searchParams.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  // Verify alert belongs to this shop
  const { data: alert } = await supabase.from('AlertLog')
    .select('id, shopId').eq('id', params.id).single();
  if (!alert) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (alert.shopId !== shop.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await supabase.from('AlertLog')
    .update({ isRead: true } as Record<string, unknown>)
    .eq('id', params.id);

  if (error) {
    if (error.message?.includes('column') && error.message?.includes('isRead')) {
      return NextResponse.json({ error: 'isRead column missing. Run supabase/alertlog-isread.sql.' }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
