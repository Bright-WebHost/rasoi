import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: Request) {
  try {
    const { order_number, cancel_reason } = await req.json();
    if (!order_number || !cancel_reason) {
      return NextResponse.json({ error: 'Missing order_number or cancel_reason' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('id, status')
      .eq('order_number', order_number)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (order.status === 'cancelled' || order.status === 'delivered') {
      return NextResponse.json({ error: 'Order cannot be cancelled' }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        cancel_reason: cancel_reason,
        cancelled_by: 'customer',
        cancelled_at: new Date().toISOString()
      })
      .eq('id', order.id);

    if (updateError) {
      throw updateError;
    }
    
    try {
      const url = process.env.N8N_STATUS_WEBHOOK_URL?.trim();
      const secret = process.env.RASOI_WHATSAPP_INBOUND_SECRET?.trim() || process.env.RASOI_N8N_WEBHOOK_SECRET?.trim() || "";
      if (url && secret) {
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-rasoi-whatsapp-secret": secret,
          },
          body: JSON.stringify({ order_number, status: 'cancelled', cancel_reason: cancel_reason, staff_token: "customer_cancel" }),
        });
      }
    } catch (e) {
      console.error(e);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
