export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShop } from '@/lib/verify-session-token';
import { getShop } from '@/lib/shop';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 401 });
  const shop = await getShop(shopDomain);
  if (!shop) return NextResponse.json({ error: 'Install required' }, { status: 400 });

  const { data: alert } = await supabase.from('AlertLog').select('id, shopId').eq('id', id).single();
  if (!alert) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  if (alert.shopId !== shop.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error } = await supabase.from('AlertLog').update({ isRead: true } as Record<string, unknown>).eq('id', id);
  if (error) {
    if (error.message.includes('column') && error.message.includes('isRead')) {
      return NextResponse.json({ error: 'isRead column not found — run migration' }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
