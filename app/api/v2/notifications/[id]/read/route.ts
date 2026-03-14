export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  let body: { shop?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const shopDomain = body.shop;
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop in body' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop')
    .select('id')
    .eq('shopDomain', shopDomain)
    .eq('isActive', true)
    .single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  // Fetch the alert to verify ownership
  const { data: alert, error: fetchError } = await supabase
    .from('AlertLog')
    .select('id, shopId, isRead')
    .eq('id', id)
    .single();

  if (fetchError || !alert) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  }

  if (alert.shopId !== shop.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Already read — idempotent
  if (alert.isRead === true) {
    return NextResponse.json({ ok: true });
  }

  // Try to update isRead
  const { error: updateError } = await supabase
    .from('AlertLog')
    .update({ isRead: true })
    .eq('id', id);

  if (updateError) {
    // If isRead column doesn't exist, handle gracefully
    if (updateError.message?.includes('isRead') || updateError.message?.includes('column')) {
      return NextResponse.json(
        { error: 'Notifications read state not available. Run alertlog-isread.sql first.' },
        { status: 503 }
      );
    }
    console.error('[v2/notifications/read] update error:', updateError.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
