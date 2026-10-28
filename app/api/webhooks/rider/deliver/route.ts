import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isInternalRequest } from '@/lib/server/internal-auth';

export async function POST(request: Request) {
  // Only the YCloud webhook route calls this (rider tapped "Delivered").
  if (!isInternalRequest(request)) {
    console.error("[RIDER DELIVER] Unauthorized request");
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { order_number, rider_phone, payment_status } = body;

    if (!order_number || !rider_phone) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Fetch existing order
    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select('id, status, is_collected, total, rider_phone, customer_phone, customer_name, items_json, order_type')
      .eq('order_number', order_number)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    const dbPhone = (order.rider_phone || '').replace(/[^0-9]/g, '');
    const incomingPhone = (rider_phone || '').replace(/[^0-9]/g, '');
    
    if (dbPhone !== incomingPhone) {
      return NextResponse.json({ success: false, error: 'Order not assigned to you' }, { status: 403 });
    }

    if (order.status === 'delivered') {
      return NextResponse.json({ success: true, message: 'Already delivered' });
    }

    // "Collected": the rider holds the cash until the cashier collects it (is_collected stays false).
    // "Unpaid": the customer didn't pay the rider, so the rider owes nothing for this order and
    // the shop follows up with the customer (the Orders page flags it).
    const paymentStatus = payment_status === 'unpaid' ? 'unpaid' : 'collected';
    const updatePayload: Record<string, unknown> = {
      status: 'delivered',
      payment_status: paymentStatus,
      updated_at: new Date().toISOString()
    };

    // 2. Mark as delivered
    const { error: updateError } = await adminClient
      .from('orders')
      .update(updatePayload)
      .eq('id', order.id);

    if (updateError) throw updateError;

    // No WhatsApp messages here: the rider gets one message per order (at assignment) and the
    // customer gets no "delivered" message (messaging cost).

    return NextResponse.json({ success: true, message: 'Order marked as delivered' });

  } catch (error: any) {
    console.error('Error marking delivered:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
