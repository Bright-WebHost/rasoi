import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyStatusWebhook } from "@/lib/server/notify";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { order_id, table_number, new_items } = body;

    if (!order_id || !table_number || !Array.isArray(new_items) || new_items.length === 0) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Fetch existing order
    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select('id, items_json, total, status, order_number, order_type, table_number')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 });
    }

    const isDineInOrder = order.order_type === 'dine-in' || Boolean(String(order.table_number || '').trim());
    if (!isDineInOrder || String(order.table_number) !== String(table_number)) {
      return NextResponse.json({ success: false, error: 'This order does not belong to that table.' }, { status: 409 });
    }

    const openStatuses = ['new', 'preparing', 'ready_for_pickup']
    if (!openStatuses.includes(order.status)) {
      return NextResponse.json({ success: false, error: 'This table order is already closed. Refresh the Tables page to start a new table order.' }, { status: 409 })
    }

    const { data: table, error: tableError } = await adminClient
      .from('restaurant_tables')
      .select('id, is_active, current_order_id')
      .eq('table_number', table_number)
      .maybeSingle();

    if (tableError || !table) {
      return NextResponse.json({ success: false, error: 'Table not found. Refresh the Tables page and try again.' }, { status: 404 });
    }

    const { data: openTableOrders, error: openTableOrdersError } = await adminClient
      .from('orders')
      .select('id')
      .eq('table_number', table_number)
      .in('status', openStatuses);

    if (openTableOrdersError) throw openTableOrdersError;
    if (openTableOrders?.some((openOrder: { id: string }) => openOrder.id !== order.id)) {
      return NextResponse.json({ success: false, error: 'Another open order is assigned to this table. Refresh Tables and add the round to that order.' }, { status: 409 });
    }

    if (table.current_order_id && table.current_order_id !== order.id) {
      const { data: pointedOrder } = await adminClient
        .from('orders')
        .select('id, status')
        .eq('id', table.current_order_id)
        .maybeSingle();
      if (pointedOrder && openStatuses.includes(pointedOrder.status)) {
        return NextResponse.json({ success: false, error: 'Another open order is assigned to this table. Refresh Tables and add the round to that order.' }, { status: 409 });
      }
    }

    // 2. Append items with new round
    const existingItems = order.items_json || [];
    let updatedTotal = order.total;

    // Determine the next round number
    const currentMaxRound = existingItems.reduce((max: number, item: any) => Math.max(max, item.round || 1), 0);
    const nextRound = currentMaxRound + 1;

    const mergedItems = [...existingItems];

    for (const value of new_items) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return NextResponse.json({ success: false, error: 'Invalid item' }, { status: 400 });
      }
      const { special_note, ...newItem } = value as Record<string, any>;
      const note = typeof special_note === 'string' ? special_note.trim() : '';
      if (note.length > 300) {
        return NextResponse.json({ success: false, error: 'Special instructions must be 300 characters or fewer.' }, { status: 400 });
      }

      mergedItems.push({
        ...newItem,
        notes: note || null,
        is_new_addition: true,
        round: nextRound
      });

      updatedTotal += (newItem.price || newItem.unit_price) * newItem.quantity;
    }

    // Generate new items summary string (combining all items with same name for the summary)
    const summaryMap = new Map<string, number>();
    for (const item of mergedItems) {
      const key = `${item.item_name}${item.variant_name ? ` (${item.variant_name})` : ''}`;
      summaryMap.set(key, (summaryMap.get(key) || 0) + item.quantity);
    }
    const itemsSummary = Array.from(summaryMap.entries()).map(([name, qty]) => `${qty}x ${name}`).join(', ');

    // 3. Determine new status
    let newStatus = order.status;
    if (['ready_for_pickup', 'out_for_delivery', 'delivered'].includes(order.status)) {
      newStatus = 'preparing';
    }

    // 4. Update the order
    const { data: updatedOrder, error: updateError } = await adminClient
      .from('orders')
      .update({
        items_json: mergedItems,
        items: itemsSummary,
        total: updatedTotal,
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', order_id)
      .eq('table_number', table_number)
      .in('status', openStatuses)
      .select('id')
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }
    if (!updatedOrder) {
      return NextResponse.json({ success: false, error: 'This table order was closed before the round could be added. Refresh the Tables page.' }, { status: 409 });
    }

    // Repair stale table metadata from older POS orders, where active orders were
    // visible in Tables but current_order_id had not been set by the POS RPC.
    const { error: tableSyncError } = await adminClient
      .from('restaurant_tables')
      .update({ is_active: true, current_order_id: order.id })
      .eq('id', table.id);
    if (tableSyncError) console.error('[append-order] Could not refresh table metadata:', tableSyncError.message);
    else {
      const { data: stillOpen, error: statusCheckError } = await adminClient
        .from('orders')
        .select('id')
        .eq('id', order.id)
        .in('status', openStatuses)
        .maybeSingle();
      if (statusCheckError) console.error('[append-order] Could not verify table status after append:', statusCheckError.message);
      else if (!stillOpen) {
        await adminClient
          .from('restaurant_tables')
          .update({ is_active: false, current_order_id: null })
          .eq('id', table.id)
          .eq('current_order_id', order.id);
      }
    }

    // Trigger webhook if we went back to preparing
    if (newStatus === 'preparing' && order.status !== 'preparing' && !isDineInOrder) {
      await notifyStatusWebhook(order.order_number, "preparing", undefined, { is_update: true });
    }

    return NextResponse.json({ success: true, order_number: order.order_number, status: newStatus, new_total: updatedTotal, merged_items: mergedItems });

  } catch (error: any) {
    console.error('Append Order Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
