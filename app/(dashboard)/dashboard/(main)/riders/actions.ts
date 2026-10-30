"use server";

import { authorize } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export type TimeFilter = "today" | "yesterday" | "this_week" | "this_month" | "all_time";

export type RiderStats = {
  id: string;
  name: string;
  whatsapp_number: string;
  is_active: boolean;
  done: number;
  cancelled: number;
  collected: number;
  pending: number;
  handedOver: number;
  owes: number;
  created_at: string;
};

export type RiderOverviewMetrics = {
  deliveries_done: number;
  cancelled: number;
  cash_collected: number;
  still_to_collect: number;
  handed_over: number;
  riders_owe: number;
};

// Legacy Rider type for backwards compatibility with DispatcherBoard & GlobalAssignRiderPopup
export type Rider = {
  id: string;
  name: string;
  whatsapp_number: string;
  is_active: boolean;
  deliveries_count: number;
  declines_count: number;
  cash_collected: number;
  pending_cash: number;
  created_at: string;
};

function getTimeRange(filter: TimeFilter): { start: Date | null; end: Date | null } {
  const now = new Date();
  if (filter === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end };
  }
  if (filter === "yesterday") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    return { start, end };
  }
  if (filter === "this_week") {
    const day = now.getDay();
    // Monday as start of week: day 0 (Sun) -> diff -6, day 1 (Mon) -> 0, etc.
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), diff + 6, 23, 59, 59, 999);
    return { start, end };
  }
  if (filter === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }
  return { start: null, end: null };
}

export async function fetchRidersPageData(timeFilter: TimeFilter = "this_week") {
  await authorize("view_riders");

  try {
    const adminClient = createAdminClient();

    // 1. Fetch all riders
    const { data: ridersData, error: ridersError } = await adminClient
      .from("riders")
      .select("*")
      .order("created_at", { ascending: false });

    if (ridersError) throw ridersError;

    // 2. Fetch orders assigned to riders
    let ordersQuery = adminClient
      .from("orders")
      .select("id, order_number, total, collected_amount, is_collected, status, rider_id, created_at, payment_status, order_type")
      .eq("order_type", "delivery")
      .not("rider_id", "is", null);

    const { start, end } = getTimeRange(timeFilter);
    if (start && end) {
      ordersQuery = ordersQuery
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString());
    }

    const { data: ordersData, error: ordersError } = await ordersQuery;
    if (ordersError) throw ordersError;

    const orders = ordersData || [];
    const riders = (ridersData || []).map((r: any): RiderStats => {
      const rOrders = orders.filter((o: any) => o.rider_id === r.id);
      const delivered = rOrders.filter((o: any) => o.status === "delivered");
      const cancelled = rOrders.filter((o: any) => o.status === "cancelled");

      // Cash collected by rider for delivered orders. "Unpaid" deliveries (customer didn't pay the
      // rider) and orders the shop was paid for directly are not cash the rider holds.
      const riderHeldCash = delivered.filter((o: any) => o.payment_status !== "unpaid" && o.payment_status !== "paid_later");
      const totalCollected = riderHeldCash.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);

      // Handed over to store: recorded in riders.cash_collected or orders.collected_amount
      // In all_time, use rider's cash_collected column; in time filter, use delivered orders with is_collected
      const handedOverFromOrders = riderHeldCash.reduce((sum: number, o: any) => {
        const recorded = Number(o.collected_amount || 0);
        return sum + (recorded > 0 ? recorded : o.is_collected ? Number(o.total || 0) : 0);
      }, 0);

      const handedOver = timeFilter === "all_time" 
        ? Math.max(Number(r.cash_collected || 0), handedOverFromOrders)
        : handedOverFromOrders;

      // Pending collection from customer (active orders not delivered / not cancelled)
      const pendingToCollect = rOrders
        .filter((o: any) => o.status !== "delivered" && o.status !== "cancelled")
        .reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0);

      // Amount rider owes the store: (delivered value) - (handed over value)
      const owes = Math.max(0, totalCollected - handedOver);

      return {
        id: r.id,
        name: r.name,
        whatsapp_number: r.whatsapp_number,
        is_active: !!r.is_active,
        done: delivered.length,
        cancelled: cancelled.length,
        collected: totalCollected,
        pending: pendingToCollect,
        handedOver,
        owes,
        created_at: r.created_at,
      };
    });

    const metrics: RiderOverviewMetrics = {
      deliveries_done: riders.reduce((s: number, r: RiderStats) => s + r.done, 0),
      cancelled: riders.reduce((s: number, r: RiderStats) => s + r.cancelled, 0),
      cash_collected: riders.reduce((s: number, r: RiderStats) => s + r.collected, 0),
      still_to_collect: riders.reduce((s: number, r: RiderStats) => s + r.pending, 0),
      handed_over: riders.reduce((s: number, r: RiderStats) => s + r.handedOver, 0),
      riders_owe: riders.reduce((s: number, r: RiderStats) => s + r.owes, 0),
    };

    return {
      success: true,
      riders,
      metrics,
    };
  } catch (error: any) {
    console.error("[fetchRidersPageData] Error:", error);
    return { success: false, error: error.message || "Failed to load rider data" };
  }
}

// Backwards-compatible fetchRiders for dispatcher boards
export async function fetchRiders() {
  await authorize("view_riders");

  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("riders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    
    const riders = (data || []) as Rider[];

    const { data: pendingOrders } = await adminClient
      .from("orders")
      .select("rider_id, total, collected_amount, payment_status")
      .eq("order_type", "delivery")
      .eq("status", "delivered")
      .eq("is_collected", false)
      .not("rider_id", "is", null);

    if (pendingOrders) {
      riders.forEach(rider => {
        const riderPending = pendingOrders
          .filter((o: any) => o.rider_id === rider.id && o.payment_status !== "unpaid" && o.payment_status !== "paid_later")
          .reduce((sum: number, o: any) => sum + Math.max(0, (Number(o.total) || 0) - (Number(o.collected_amount) || 0)), 0);
        rider.pending_cash = riderPending;
      });
    }

    return { success: true, riders };
  } catch (error: any) {
    console.error("[fetchRiders] Error:", error);
    return { success: false, error: "Failed to fetch riders" };
  }
}

export async function addRider(name: string, whatsapp_number: string) {
  await authorize("manage_riders");

  try {
    const rawNumber = whatsapp_number.replace(/\D/g, '');
    let finalNumber = rawNumber;
    if (rawNumber.length === 10) {
      finalNumber = `91${rawNumber}`;
    } else if (rawNumber.length === 12 && rawNumber.startsWith('91')) {
      finalNumber = rawNumber;
    } else {
      return { success: false, error: "Phone number must be valid 10 digits (e.g. 9180108354)" };
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("riders")
      .insert([{ name: name.trim(), whatsapp_number: finalNumber }])
      .select()
      .single();

    if (error) throw error;
    return { success: true, rider: data };
  } catch (error: any) {
    console.error("[addRider] Error:", error);
    return { success: false, error: error.message || "Failed to add rider" };
  }
}

export async function toggleRiderStatus(id: string, is_active: boolean) {
  await authorize("manage_riders");

  try {
    const adminClient = createAdminClient();
    const { error } = await adminClient
      .from("riders")
      .update({ is_active })
      .eq("id", id);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error("[toggleRiderStatus] Error:", error);
    return { success: false, error: "Failed to update rider status" };
  }
}

export async function collectRiderCash(riderId: string, amountToCollect?: number, note?: string) {
  const staff = await authorize("manage_riders");
  if (!riderId || (amountToCollect != null && (!Number.isFinite(amountToCollect) || amountToCollect <= 0))) {
    return { success: false, error: "Enter a valid collection amount." };
  }
  const safeNote = typeof note === "string" ? note.trim() : "";
  if (safeNote.length > 200) return { success: false, error: "Keep the note under 200 characters." };

  try {
    const adminClient = createAdminClient();
    const rpc = await adminClient.rpc("collect_rider_cash_atomic", {
      p_rider_id: riderId,
      p_amount: amountToCollect ?? null,
      p_note: safeNote || null,
      p_received_by: staff.email.split("@")[0],
    });

    if (!rpc.error) {
      const result = rpc.data as { collected_amount?: number; remaining_owed?: number };
      const collectedAmount = Number(result?.collected_amount || 0);
      if (collectedAmount <= 0) return { success: false, error: "There is no outstanding rider cash to collect." };
      return {
        success: true,
        collectedAmount,
        remainingOwes: Number(result?.remaining_owed || 0),
        ledgerRecorded: true,
      };
    }

    const missingRpc = rpc.error.code === "PGRST202" || /could not find the function|function .* does not exist/i.test(rpc.error.message);
    if (!missingRpc) throw rpc.error;

    // Older deployments can still collect cash until the stock/P&L migration is applied.
    const { data: rider, error: riderFetchError } = await adminClient
      .from("riders")
      .select("id, name, cash_collected")
      .eq("id", riderId)
      .single();

    if (riderFetchError || !rider) throw new Error("Rider not found");

    // Fetch delivered orders for this rider
    const { data: deliveredOrders, error: ordersFetchError } = await adminClient
      .from("orders")
      .select("id, total, collected_amount, is_collected, payment_status")
      .eq("rider_id", riderId)
      .eq("order_type", "delivery")
      .eq("status", "delivered")
      .order("created_at", { ascending: true });

    if (ordersFetchError) throw ordersFetchError;

    // Only deliveries where the rider actually took the cash (not "Unpaid" / paid to the shop)
    const riderHeldOrders = (deliveredOrders || []).filter((o: any) => o.payment_status !== "unpaid" && o.payment_status !== "paid_later");
    const owed = (order: any) => {
      if (order.is_collected && Number(order.collected_amount || 0) === 0) return 0;
      return Math.max(0, Number(order.total || 0) - Number(order.collected_amount || 0));
    };
    const currentOwes = riderHeldOrders.reduce((sum: number, o: any) => sum + owed(o), 0);
    const collectAmount = Math.min(amountToCollect ?? currentOwes, currentOwes);
    if (collectAmount <= 0) return { success: false, error: "There is no outstanding rider cash to collect." };
    let budget = collectAmount;
    for (const order of riderHeldOrders) {
      const due = owed(order);
      if (!due || budget <= 0) continue;
      const previous = Number(order.collected_amount || 0);
      const added = Math.min(due, budget);
      const next = previous + added;
      const { error } = await adminClient.from("orders").update({
        collected_amount: next,
        is_collected: next >= Number(order.total || 0),
        updated_at: new Date().toISOString(),
      }).eq("id", order.id);
      if (error) throw error;
      budget -= added;
    }
    const remainingOwes = Math.max(0, currentOwes - collectAmount);
    const { error: riderUpdateError } = await adminClient.from("riders").update({
      cash_collected: Number(rider.cash_collected || 0) + collectAmount,
      pending_cash: remainingOwes,
    }).eq("id", riderId);
    if (riderUpdateError) throw riderUpdateError;

    let ledgerRecorded = false;
    if (collectAmount > 0) {
      const { error: ledgerError } = await adminClient.from("rider_payments").insert({
        rider_id: riderId,
        rider_name: rider.name,
        amount: collectAmount,
        note: safeNote || null,
        received_by: staff.email.split("@")[0],
      });
      ledgerRecorded = !ledgerError;
    }

    return {
      success: true,
      collectedAmount: collectAmount,
      remainingOwes,
      ledgerRecorded,
    };
  } catch (error: any) {
    console.error("[collectRiderCash] Error:", error);
    return { success: false, error: error.message || "Failed to collect cash" };
  }
}

export async function fetchRiderPaymentLedger() {
  await authorize("view_riders");
  try {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("rider_payments")
      .select("id,rider_id,rider_name,amount,note,received_by,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      const migrated = error.code !== "42P01" && error.code !== "PGRST205" && !/does not exist|schema cache/i.test(error.message);
      return { success: false, migrated, error: migrated ? "Could not load rider handovers." : "Apply the stock and P&L migration to enable the cash ledger." };
    }
    return { success: true, migrated: true, payments: data || [] };
  } catch (error: any) {
    console.error("[fetchRiderPaymentLedger] Error:", error);
    return { success: false, migrated: true, error: error.message || "Could not load rider handovers." };
  }
}

// Backwards-compatible alias
export async function settlePendingCash(id: string) {
  return collectRiderCash(id);
}

export async function deleteRider(id: string) {
  await authorize("manage_riders");

  try {
    const adminClient = createAdminClient();

    // Check if rider has active in-progress deliveries
    const { data: activeOrders } = await adminClient
      .from("orders")
      .select("id")
      .eq("rider_id", id)
      .in("status", ["ready_for_pickup", "out_for_delivery", "preparing"]);

    if (activeOrders && activeOrders.length > 0) {
      return {
        success: false,
        error: "Cannot delete rider while they have active orders in progress.",
      };
    }

    // Unlink rider_id from historical orders to satisfy foreign key constraint
    await adminClient
      .from("orders")
      .update({ rider_id: null })
      .eq("rider_id", id);

    // Delete the rider
    const { error: deleteError } = await adminClient
      .from("riders")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    return { success: true };
  } catch (error: any) {
    console.error("[deleteRider] Error:", error);
    return { success: false, error: error.message || "Failed to delete rider" };
  }
}
