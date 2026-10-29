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

    if (order.order_type !== 'dine-in' || String(order.table_number) !== String(table_number)) {
      return NextResponse.json({ success: false, error: 'This order does not belong to that table.' }, { status: 409 });
    }

    const { data: table, error: tableError } = await adminClient
      .from('restaurant_tables')
      .select('is_active, current_order_id')
      .eq('table_number', table_number)
      .maybeSingle();

    if (tableError || !table?.is_active || table.current_order_id !== order.id || !['new', 'preparing', 'ready_for_pickup'].includes(order.status)) {
      return NextResponse.json({ success: false, error: 'This table order is already closed. Please ask restaurant staff for help.' }, { status: 409 });
    }

    // 2. Append items with new round
    let existingItems = order.items_json || [];
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
    const { error: updateError } = await adminClient
      .from('orders')
      .update({
        items_json: mergedItems,
        items: itemsSummary,
        total: updatedTotal,
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('id', order_id);

    if (updateError) {
      throw updateError;
    }

    // Trigger webhook if we went back to preparing
    if (newStatus === 'preparing' && order.status !== 'preparing' && order.order_type !== 'dine-in') {
      await notifyStatusWebhook(order.order_number, "preparing", undefined, { is_update: true });
    }

    return NextResponse.json({ success: true, order_number: order.order_number, status: newStatus, new_total: updatedTotal, merged_items: mergedItems });

  } catch (error: any) {
    console.error('Append Order Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
