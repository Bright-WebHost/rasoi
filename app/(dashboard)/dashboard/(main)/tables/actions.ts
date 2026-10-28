"use server";

import { authorize } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export type RestaurantTable = {
  id: string;
  table_number: string;
  qr_code_url: string | null;
  is_active: boolean;
  current_order_id: string | null;
  created_at: string;
  orders?: {
    id: string;
    total: number;
    status: string;
    items_json: any;
    customer_name: string | null;
    customer_phone: string | null;
    created_at?: string;
  } | null;
};

export type TablesOverviewMetrics = {
  open_tables: number;
  total_tables: number;
  food_ready: number;
  dine_in_week: number;
  open_value: number;
};

export async function fetchTables() {
  await authorize("tables");

  try {
    const adminClient = createAdminClient();
    
    // 1. Fetch tables
    const { data, error } = await adminClient
      .from("restaurant_tables")
      .select("*")
      .order("table_number", { ascending: true });

    if (error) {
      if (error.code === '42P01') {
        return { success: false, error: "Database not migrated yet." };
      }
      throw error;
    }

    // 2. Fetch active dine-in orders
    const { data: activeOrders, error: activeOrdersError } = await adminClient
      .from("orders")
      .select("id, total, status, items_json, customer_name, customer_phone, table_number, created_at")
      .eq("order_type", "dine-in")
      .in("status", ["new", "preparing", "ready_for_pickup"]);

    if (activeOrdersError) {
      console.error("[fetchTables] Error fetching active orders:", activeOrdersError);
    }

    // 3. Fetch weekly dine-in count for the week metric
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);

    const { data: weekOrders } = await adminClient
      .from("orders")
      .select("id")
      .eq("order_type", "dine-in")
      .gte("created_at", startOfWeek.toISOString());

    const activeList = activeOrders || [];

    const tables = (data as any[]).map((t, idx) => {
      // Find active order for this table
      const activeOrder = activeList.find((o: any) => String(o.table_number).trim() === String(t.table_number).trim());
      
      return {
        ...t,
        is_active: !!activeOrder,
        current_order_id: activeOrder ? activeOrder.id : null,
        orders: activeOrder ? {
          id: activeOrder.id,
          total: Number(activeOrder.total) || 0,
          status: activeOrder.status,
          items_json: activeOrder.items_json,
          customer_name: activeOrder.customer_name,
          customer_phone: activeOrder.customer_phone,
          created_at: activeOrder.created_at,
        } : null
      } as RestaurantTable;
    });

    const openCount = tables.filter(t => t.is_active && t.orders).length;
    const foodReadyCount = tables.filter(t => t.orders?.status === "ready_for_pickup").length;
    const openValue = tables.reduce((sum, t) => sum + (t.orders?.total || 0), 0);

    const metrics: TablesOverviewMetrics = {
      open_tables: openCount,
      total_tables: tables.length,
      food_ready: foodReadyCount,
      dine_in_week: weekOrders?.length || 0,
      open_value: openValue,
    };

    return { success: true, tables, metrics };
  } catch (error: any) {
    console.error("[fetchTables] Error:", error);
    return { success: false, error: "Failed to fetch tables" };
  }
}

export async function addTable(tableNumber: string) {
  await authorize("tables");

  try {
    const adminClient = createAdminClient();
    const cleanNumber = tableNumber.trim();

    // Check if table already exists
    const { data: existing } = await adminClient
      .from("restaurant_tables")
      .select("id")
      .eq("table_number", cleanNumber)
      .maybeSingle();

    if (existing) {
      return { success: false, error: `Table ${cleanNumber} already exists.` };
    }

    const { data, error } = await adminClient
      .from("restaurant_tables")
      .insert([{ 
        table_number: cleanNumber,
        is_active: false
      }])
      .select()
      .single();

    if (error) throw error;
    return { success: true, table: data as RestaurantTable };
  } catch (error: any) {
    console.error("[addTable] Error:", error);
    return { success: false, error: error.message };
  }
}

export async function deleteTable(id: string) {
  await authorize("tables");

  try {
    const adminClient = createAdminClient();

    // Check if table currently has an active order
    const { data: table } = await adminClient
      .from("restaurant_tables")
      .select("table_number")
      .eq("id", id)
      .single();

    if (table?.table_number) {
      const { data: activeOrder } = await adminClient
        .from("orders")
        .select("id")
        .eq("table_number", table.table_number)
        .eq("order_type", "dine-in")
        .in("status", ["new", "preparing", "ready_for_pickup"])
        .limit(1)
        .maybeSingle();

      if (activeOrder) {
        return { success: false, error: "Cannot delete table while an active order is seated." };
      }
    }

    const { error } = await adminClient.from("restaurant_tables").delete().eq("id", id);
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error("[deleteTable] Error:", error);
    return { success: false, error: "Failed to delete table" };
  }
}

export async function clearTable(id: string) {
  await authorize("tables");

  try {
    const adminClient = createAdminClient();
    
    // 1. Fetch table details
    const { data: table, error: fetchError } = await adminClient
      .from("restaurant_tables")
      .select("table_number, current_order_id")
      .eq("id", id)
      .single();
      
    if (fetchError) throw fetchError;
    
    // Find active order if not set on the table
    let orderIdToClear = table?.current_order_id;
    if (!orderIdToClear && table?.table_number) {
      const { data: activeOrder } = await adminClient
        .from("orders")
        .select("id")
        .eq("order_type", "dine-in")
        .eq("table_number", table.table_number)
        .in("status", ["new", "preparing", "ready_for_pickup"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
        
      if (activeOrder) {
        orderIdToClear = activeOrder.id;
      }
    }

    // 2. Update table
    const { error } = await adminClient
      .from("restaurant_tables")
      .update({ 
        is_active: false,
        current_order_id: null
      })
      .eq("id", id);
      
    if (error) throw error;
    
    // 3. Mark order as delivered & notify customer
    if (orderIdToClear) {
      const { data: order } = await adminClient
        .from("orders")
        .update({ 
          status: 'delivered',
          is_collected: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", orderIdToClear)
        .select("order_number")
        .single();
        
      if (order?.order_number) {
        const { notifyStatusWebhook } = await import("@/lib/server/notify");
        await notifyStatusWebhook(order.order_number, 'delivered');
      }
    }
    
    return { success: true };
  } catch (error: any) {
    console.error("[clearTable] Error:", error);
    return { success: false, error: "Failed to clear table" };
  }
}

export async function fetchTableHistory(tableNumber: string) {
  await authorize("tables");

  try {
    const adminClient = createAdminClient();
    
    const { data, error } = await adminClient
      .from("orders")
      .select("id, order_number, total, status, created_at, items_json, customer_name, customer_phone")
      .eq("table_number", tableNumber)
      .in("status", ["delivered", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(20);
      
    if (error) throw error;
    
    return { success: true, history: data };
  } catch (error: any) {
    console.error("[fetchTableHistory] Error:", error);
    return { success: false, error: "Failed to fetch table history" };
  }
}

export async function moveTable(orderId: string, oldTableNumber: string, newTableNumber: string) {
  await authorize("tables");

  try {
    const adminClient = createAdminClient();
    
    // Check if new table has an active order
    const { data: activeOrder } = await adminClient
      .from('orders')
      .select('id')
      .eq('table_number', newTableNumber)
      .eq('order_type', 'dine-in')
      .in('status', ['new', 'preparing', 'ready_for_pickup'])
      .maybeSingle();
      
    if (activeOrder) return { success: false, error: 'Destination table is already occupied.' };
    
    // Update order
    const { error: orderError } = await adminClient
      .from('orders')
      .update({ table_number: newTableNumber, updated_at: new Date().toISOString() })
      .eq('id', orderId);
      
    if (orderError) throw orderError;
    
    // Update tables tracking
    await adminClient.from('restaurant_tables').update({ is_active: false, current_order_id: null }).eq('table_number', oldTableNumber);
    await adminClient.from('restaurant_tables').update({ is_active: true, current_order_id: orderId }).eq('table_number', newTableNumber);
    
    return { success: true };
  } catch (error: any) {
    console.error('[moveTable] Error:', error);
    return { success: false, error: 'Failed to move table' };
  }
}

export async function mergeTables(sourceOrderId: string, targetOrderId: string, sourceTableNumber: string) {
  await authorize("tables");

  try {
    const adminClient = createAdminClient();
    
    // Fetch both orders
    const { data: sourceOrder } = await adminClient.from('orders').select('items_json, total').eq('id', sourceOrderId).single();
    const { data: targetOrder } = await adminClient.from('orders').select('items_json, total, status, order_number').eq('id', targetOrderId).single();
    
    if (!sourceOrder || !targetOrder) return { success: false, error: 'Order not found' };
    
    let existingTargetItems = targetOrder.items_json || [];
    let sourceItems = sourceOrder.items_json || [];
    
    const currentMaxRound = existingTargetItems.reduce((max: number, item: any) => Math.max(max, item.round || 1), 0);
    const nextRound = currentMaxRound + 1;
    
    const mergedItems = [...existingTargetItems];
    for (const item of sourceItems) {
      mergedItems.push({
        ...item,
        is_new_addition: true,
        round: nextRound
      });
    }
    
    const newTotal = (targetOrder.total || 0) + (sourceOrder.total || 0);
    
    const summaryMap = new Map<string, number>();
    for (const item of mergedItems) {
      const key = `${item.item_name}${item.variant_name ? ` (${item.variant_name})` : ''}`;
      summaryMap.set(key, (summaryMap.get(key) || 0) + item.quantity);
    }
    const itemsSummary = Array.from(summaryMap.entries()).map(([name, qty]) => `${qty}x ${name}`).join(', ');
    
    let newStatus = targetOrder.status;
    if (['ready_for_pickup', 'out_for_delivery', 'delivered'].includes(targetOrder.status)) {
      newStatus = 'preparing';
    }
    
    // Update Target Order
    await adminClient.from('orders').update({
      items_json: mergedItems,
      items: itemsSummary,
      total: newTotal,
      status: newStatus,
      updated_at: new Date().toISOString()
    }).eq('id', targetOrderId);
    
    // Mark Source Order as cancelled to remove from active
    await adminClient.from('orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', sourceOrderId);
    
    // Clear the source table
    await adminClient.from('restaurant_tables').update({ is_active: false, current_order_id: null }).eq('table_number', sourceTableNumber);
    
    // Notify webhook for target order
    if (newStatus === 'preparing' && targetOrder.status !== 'preparing') {
      const { notifyStatusWebhook } = await import("@/lib/server/notify");
      await notifyStatusWebhook(targetOrder.order_number, 'preparing', undefined, { is_update: true });
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('[mergeTables] Error:', error);
    return { success: false, error: 'Failed to merge tables' };
  }
}
