"use server";

import { authorize } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";

export async function collectCash(orderId: string, expectedAmount: number, receivedAmount: number, riderId?: string) {
  await authorize("collect_cash");

  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const adminClient = createAdminClient();

    // 1. Check if already collected to make it idempotent
    const { data: order, error: fetchError } = await adminClient
      .from("orders")
      .select("is_collected, rider_id, total")
      .eq("id", orderId)
      .single();

    if (fetchError || !order) {
      throw new Error("Order not found");
    }
    
    if (order.is_collected) {
      return { success: true }; // Idempotent success
    }

    // 2. Update the order securely
    const { error: orderError } = await adminClient
      .from("orders")
      .update({
        collected_amount: receivedAmount,
        is_collected: true,
        updated_at: new Date().toISOString()
      })
      .eq("id", orderId)
      .eq("is_collected", false); // Extra lock

    if (orderError) throw orderError;

    // 3. Update the rider's pending cash and total cash_collected
    const effectiveRiderId = riderId || order.rider_id;
    if (effectiveRiderId) {
      const { data: rider, error: fetchRiderError } = await adminClient
        .from("riders")
        .select("pending_cash, cash_collected")
        .eq("id", effectiveRiderId)
        .single();
        
      if (!fetchRiderError && rider) {
        const orderExpected = Number(expectedAmount || order.total || 0);
        const shortPay = Math.max(0, orderExpected - receivedAmount);
        const newPending = (Number(rider.pending_cash) || 0) + shortPay;
        const newCollected = (Number(rider.cash_collected) || 0) + receivedAmount;

        await adminClient
          .from("riders")
          .update({ 
            pending_cash: newPending,
            cash_collected: newCollected
          })
          .eq("id", effectiveRiderId);
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error("Failed to collect cash:", error);
    return { success: false, error: error.message };
  }
}

/**
 * A delivery the rider marked "Unpaid" has now been paid to the shop (cash at the counter, UPI…).
 * The rider never held this money, so it is settled here rather than through rider cash collection.
 */
export async function markUnpaidOrderPaid(orderId: string) {
  await authorize("collect_cash");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const adminClient = createAdminClient();

  const { data: order, error } = await adminClient
    .from("orders")
    .select("id, total, payment_status")
    .eq("id", orderId)
    .single();
  if (error || !order) return { success: false, error: "Order not found" };
  if (order.payment_status === "paid_later") return { success: true };
  if (order.payment_status !== "unpaid") return { success: false, error: "This order is not marked unpaid." };

  const { error: updateError } = await adminClient
    .from("orders")
    .update({ payment_status: "paid_later", is_collected: true, collected_amount: order.total, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("payment_status", "unpaid");
  if (updateError) return { success: false, error: "Could not update the order." };
  return { success: true };
}
