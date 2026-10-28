"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { authorize, requireStaff } from "@/lib/auth/staff";
import { getSettings } from "@/lib/settings/server";
import { verifyUndoPasscode } from "@/lib/settings/passcode";
import type { BillData } from "@/lib/print/types";

const REOPEN_STATUSES = ["new", "preparing", "ready_for_pickup", "out_for_delivery"];

export async function updateOrderInDb(orderId: string, updates: any) {
  try {
    await requireStaff();
    const adminClient = createAdminClient();

    // Restoring a cancelled order needs the undo passcode → reopenCancelledOrder().
    if (updates && typeof updates.status === "string" && updates.status !== "cancelled") {
      const { data: current } = await adminClient.from("orders").select("status").eq("id", orderId).maybeSingle();
      if (current?.status === "cancelled") {
        return { success: false, error: "Restoring a cancelled order needs the undo passcode." };
      }
    }

    const { error } = await adminClient
      .from("orders")
      .update(updates)
      .eq("id", orderId);

    if (error) {
      console.error("[updateOrderInDb] Error:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error("[updateOrderInDb] Exception:", err.message);
    return { success: false, error: err.message };
  }
}

export async function reopenCancelledOrder(orderId: string, nextStatus: string, pin: string) {
  try {
    await authorize("reopen_cancelled");
    if (!REOPEN_STATUSES.includes(nextStatus)) return { success: false, error: "Invalid status." };

    if (!(await verifyUndoPasscode(String(pin ?? "")))) {
      // Slow down guessing.
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { success: false, error: "Incorrect passcode." };
    }

    const { data, error } = await createAdminClient()
      .from("orders")
      .update({ status: nextStatus, cancelled_by: null, cancelled_at: null, cancel_reason: null, updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", "cancelled")
      .select("id");

    if (error) return { success: false, error: error.message };
    if (!data || data.length === 0) return { success: false, error: "This order is no longer cancelled." };
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/^(Unauthorized|Forbidden): /, "") : "";
    return { success: false, error: message || "Could not restore the order." };
  }
}

/**
 * Everything needed to print a bill. With `auto`, the order is claimed atomically
 * (printed_at set only if empty) so two open dashboards never print it twice.
 */
export async function getOrderBill(orderId: string, options: { auto?: boolean } = {}): Promise<{ success: true; bill: BillData | null } | { success: false; error: string }> {
  try {
    await requireStaff();
    const adminClient = createAdminClient();

    const [{ data: order, error }, settings] = await Promise.all([
      adminClient.from("orders").select("*, order_items(*)").eq("id", orderId).maybeSingle(),
      getSettings(),
    ]);
    if (error || !order) return { success: false, error: "Order not found." };

    if (options.auto && !settings.autoPrint) return { success: true, bill: null };

    const now = new Date().toISOString();
    if ("printed_at" in order) {
      if (options.auto) {
        const { data: claimed } = await adminClient.from("orders").update({ printed_at: now }).eq("id", orderId).is("printed_at", null).select("id");
        if (!claimed || claimed.length === 0) return { success: true, bill: null };
      } else if (!order.printed_at) {
        await adminClient.from("orders").update({ printed_at: now }).eq("id", orderId);
      }
    }

    type RawItem = { item_name?: string; name?: string; variant_name?: string | null; quantity?: number; unit_price?: number; price?: number };
    const source: RawItem[] =
      Array.isArray(order.items_json) && order.items_json.length > 0
        ? order.items_json
        : Array.isArray(order.order_items) && order.order_items.length > 0
          ? order.order_items
          : [];

    const items = source.length
      ? source.map((item) => {
          const base = String(item.item_name || item.name || "Item");
          const variant = item.variant_name && !base.includes(item.variant_name) ? ` (${item.variant_name})` : "";
          return {
            name: base + variant,
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unit_price ?? item.price ?? 0),
          };
        })
      : [{ name: String(order.items || "Items"), quantity: 1, unitPrice: Number(order.total) - Number(order.delivery_fee || 0) }];

    const itemsSubtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    return {
      success: true,
      bill: {
        orderNumber: order.order_number,
        createdAt: order.created_at,
        orderType: order.order_type,
        tableNumber: order.table_number,
        customerName: order.customer_name,
        customerPhone: order.customer_phone,
        address: [order.address, order.landmark, order.city, order.pincode].filter(Boolean).join(", "),
        scheduledFor: order.scheduled_for ?? null,
        items,
        itemsSubtotal,
        deliveryFee: Number(order.delivery_fee || 0),
        total: Number(order.total || 0),
        restaurant: {
          name: settings.restaurantName,
          tagline: settings.tagline,
          address: settings.address,
          phone: settings.phone,
          gstin: settings.gstin,
          gstPercent: settings.gstPercent,
          logoUrl: settings.logoUrl,
          googleReviewUrl: settings.googleReviewUrl,
        },
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not load the bill." };
  }
}
