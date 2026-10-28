import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const table_number = searchParams.get('table');

  if (!table_number) {
    return NextResponse.json({ success: false, error: 'Table number is required' }, { status: 400 });
  }

  try {
    const adminClient = createAdminClient();

    // 1. Check if the table exists and has an active order
    const { data: tableData, error: tableError } = await adminClient
      .from('restaurant_tables')
      .select('current_order_id, is_active')
      .eq('table_number', table_number)
      .single();

    if (tableError || !tableData) {
      return NextResponse.json({ success: false, error: 'Table not found' }, { status: 404 });
    }

    if (!tableData.is_active || !tableData.current_order_id) {
      return NextResponse.json({ success: true, active_order: null });
    }

    // 2. Fetch the active order details
    const { data: orderData, error: orderError } = await adminClient
      .from('orders')
      .select('id, order_number, total, items_json, status')
      .eq('id', tableData.current_order_id)
      .single();

    if (orderError || !orderData) {
       // Data consistency issue, reset table
       await adminClient.from('restaurant_tables').update({ is_active: false, current_order_id: null }).eq('table_number', table_number);
       return NextResponse.json({ success: true, active_order: null });
    }

    // If order is delivered or cancelled, it's no longer "active" for adding items
    const closedStatuses = ['delivered', 'cancelled'];
    if (closedStatuses.includes(orderData.status)) {
       await adminClient.from('restaurant_tables').update({ is_active: false, current_order_id: null }).eq('table_number', table_number);
       return NextResponse.json({ success: true, active_order: null });
    }

    return NextResponse.json({
      success: true,
      active_order: {
        id: orderData.id,
        order_number: orderData.order_number,
        total: orderData.total,
        items: orderData.items_json,
        status: orderData.status
      }
    });

  } catch (error: any) {
    console.error('Active Table API Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
