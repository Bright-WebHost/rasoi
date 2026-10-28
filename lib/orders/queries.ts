import { createAdminClient } from "@/lib/supabase/admin";

export const ORDER_STATUSES = [
  "new",
  "preparing",
  "ready_for_pickup",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface DashboardOrderItem {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  item_name: string;
  quantity: number;
  unit_price: number;
  size: string | null;
  notes: string | null;
}

export interface DashboardOrder {
  id: string;
  order_number: string;
  customer_phone: string;
  customer_name: string | null;
  items: string;
  total: number;
  status: OrderStatus;
  order_type: "delivery" | "pickup" | "pos" | "takeaway";
  source: string | null;
  address: string | null;
  landmark: string | null;
  city: string | null;
  pincode: string | null;
  table_number: string | null;
  confirmed_at: string | null;
  amend_window_until: string | null;
  amended_at: string | null;
  amendment_count: number | null;
  original_items: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_requested_at: string | null;
  created_at: string;
  updated_at: string;
  items_json: Array<{ menu_item_id: string | null; item_name: string; quantity: number; unit_price: number }> | null;
  rider_id?: string | null;
  rider_name?: string | null;
  rider_phone?: string | null;
  collected_amount?: number;
  is_collected?: boolean;
  scheduled_for?: string | null;
  /** collected | unpaid | paid_later (set when a rider marks a delivery) */
  payment_status?: string | null;
}

export async function getDashboardOrders(): Promise<{
  orders: DashboardOrder[];
  error: string | null;
}> {
  try {
    const adminClient = createAdminClient();

    const { data: orderRows, error: ordersError } = await adminClient
      .from("orders")
      .select(
        "id, order_number, customer_phone, customer_name, items, total, status, order_type, source, address, landmark, city, pincode, table_number, confirmed_at, amend_window_until, amended_at, amendment_count, original_items, cancel_reason, cancelled_by, cancelled_at, cancel_requested_at, created_at, updated_at, items_json, rider_id, rider_name, rider_phone, scheduled_for, payment_status"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (ordersError) {
      return { orders: [], error: "Orders could not be loaded." };
    }

    const rows = (orderRows ?? []) as DashboardOrder[];
    if (rows.length === 0) {
      return { orders: [], error: null };
    }

    const orderIds = rows.map((order) => order.id);
    const { data: itemRows, error: itemsError } = await adminClient
      .from("order_items")
      .select("id, order_id, menu_item_id, item_name, quantity, unit_price, size, notes")
      .in("order_id", orderIds)
      .order("created_at", { ascending: true });

    if (itemsError) {
      return { orders: [], error: "Order items could not be loaded." };
    }

    const itemsByOrder = new Map<string, DashboardOrderItem[]>();
    for (const item of itemRows ?? []) {
      const orderItems = itemsByOrder.get(item.order_id) ?? [];
      orderItems.push({
        id: item.id,
        order_id: item.order_id,
        menu_item_id: item.menu_item_id,
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        size: item.size,
        notes: item.notes,
      });
      itemsByOrder.set(item.order_id, orderItems);
    }

    return {
      orders: rows.map((order) => ({
        ...order,
        items: order.items ?? "",
        items_json: order.items_json ?? null,
        total: Number(order.total ?? 0),
        status: (order.status as OrderStatus) ?? "new",
        order_type: (order.order_type as DashboardOrder["order_type"]) ?? "delivery",
        amendment_count: Number(order.amendment_count ?? 0),
      })),
      error: null,
    };
  } catch {
    return { orders: [], error: "Orders could not be loaded." };
  }
}