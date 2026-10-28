"use server";

import { authorize } from "@/lib/auth/staff";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyOrderCreatedWebhook } from "@/lib/server/notify";

type PosOrderPayload = {
  customer_name: string;
  customer_phone: string;
  order_type: "takeaway" | "delivery" | "dine-in";
  table_number: string;
  address: string;
  landmark: string;
  pincode: string;
  total: number;
  items_summary: string;
  items_json: Array<{
    menu_item_id: string;
    item_name: string;
    quantity: number;
    unit_price: number;
    variant_name?: string | null;
  }>;
};

/** A dine-in order must name a table that exists, or it never shows up on the Tables page. */
async function checkDineInTable(adminClient: ReturnType<typeof createAdminClient>, payload: PosOrderPayload) {
  if (payload.order_type !== "dine-in") return null;
  const table = String(payload.table_number || "").trim();
  if (!table) return "Please select a table for a dine-in order.";
  const { data } = await adminClient.from("restaurant_tables").select("table_number").eq("table_number", table).maybeSingle();
  return data ? null : `Table ${table} doesn't exist.`;
}

export async function createPosOrder(payload: PosOrderPayload) {
  await authorize("pos");

  try {
    const adminClient = createAdminClient();
    const tableError = await checkDineInTable(adminClient, payload);
    if (tableError) return { success: false, error: tableError };

    // Call our newly created atomic RPC
    const { data, error } = await adminClient.rpc("create_pos_order", {
      p_customer_name: payload.customer_name,
      p_customer_phone: payload.customer_phone,
      p_order_type: payload.order_type,
      p_table_number: payload.table_number,
      p_address: payload.address,
      p_landmark: payload.landmark,
      p_pincode: payload.pincode,
      p_total: payload.total,
      p_items_summary: payload.items_summary,
      p_items_json: payload.items_json,
    });

    if (error || !data) {
      console.error("[createPosOrder] RPC error:", error?.message);
      
      if (error?.message?.includes("Could not find the function") || error?.code === 'PGRST202') {
        return { success: false, error: "POS order creation is not configured yet. Please run the required database migration." };
      }

      return { success: false, error: "Failed to create order." };
    }

    // Fix: the RPC defaults POS orders to 'new', but we want them to skip the acceptance popup
    // and go straight to 'preparing' (kitchen)
    await adminClient.from("orders").update({ status: "preparing" }).eq("id", data.id);

    // Counter orders are accepted on creation: send the invoice + confirmation once, if we have a number.
    if (payload.customer_phone && payload.customer_phone.replace(/D/g, "").length >= 10) {
      await notifyOrderCreatedWebhook({
        order_number: data.order_number,
        customer_phone: payload.customer_phone,
        customer_name: payload.customer_name,
        order_type: payload.order_type,
        items: payload.items_json.map((i) => ({ item_name: i.item_name, quantity: i.quantity, unit_price: i.unit_price })),
        total: payload.total,
        prep_time: 20,
      });
    }

    return {
      success: true,
      order: {
        id: data.id,
        order_number: data.order_number,
      },
    };
  } catch (error: any) {
    console.error("[createPosOrder] Server action error:", error);
    return { success: false, error: "Internal server error." };
  }
}

export async function updatePosOrder(orderId: string, payload: PosOrderPayload) {
  await authorize("pos");

  try {
    const adminClient = createAdminClient();
    const tableError = await checkDineInTable(adminClient, payload);
    if (tableError) return { success: false, error: tableError };

    // Fetch old order to compare
    const { data: oldOrder } = await adminClient.from("orders").select("total, items_json, status").eq("id", orderId).single();

    let newStatus = undefined;
    let finalItemsJson = payload.items_json;

    if (oldOrder) {
      const oldItems = oldOrder.items_json || [];
      
      finalItemsJson = payload.items_json.map(newItem => {
        const oldItem = oldItems.find((oi: any) => oi.item_name === newItem.item_name && oi.variant_name === newItem.variant_name);
        if (!oldItem || newItem.quantity > oldItem.quantity) {
          return { ...newItem, is_new_addition: true, old_quantity: oldItem ? oldItem.quantity : 0 };
        }
        return newItem;
      });

      if (payload.total > oldOrder.total) {
        if (["ready_for_pickup", "out_for_delivery", "delivered"].includes(oldOrder.status)) {
          newStatus = "preparing";
        }
      }
    }

    // Update order row
    const updatePayload: any = {
      customer_name: payload.customer_name,
      customer_phone: payload.customer_phone,
      order_type: payload.order_type,
      table_number: payload.table_number,
      address: payload.address,
      landmark: payload.landmark,
      pincode: payload.pincode,
      total: payload.total,
      items: payload.items_summary,
      items_json: finalItemsJson,
      updated_at: new Date().toISOString()
    };

    if (newStatus) {
      updatePayload.status = newStatus;
    }

    const { error: orderError } = await adminClient.from("orders").update(updatePayload).eq("id", orderId);

    if (orderError) throw orderError;

    // Delete old items
    await adminClient.from("order_items").delete().eq("order_id", orderId);

    // Insert new items
    if (payload.items_json && payload.items_json.length > 0) {
      const itemsToInsert = payload.items_json.map(item => ({
        order_id: orderId,
        menu_item_id: item.menu_item_id,
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }));
      await adminClient.from("order_items").insert(itemsToInsert);
    }

    return { success: true };
  } catch (error: any) {
    console.error("[updatePosOrder] Server action error:", error);
    return { success: false, error: "Failed to update order." };
  }
}
