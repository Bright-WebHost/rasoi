import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isInternalRequest } from '@/lib/server/internal-auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { order_number, rider_phone } = body;

    if (!order_number || !rider_phone) {
      return NextResponse.json({ success: false, error: "Missing order_number or rider_phone" }, { status: 400 });
    }

    if (!isInternalRequest(request)) {
      console.error("[RIDER DECLINE] Unauthorized request");
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // 1. Verify order exists and is a delivery order
    const adminClient = createAdminClient();
    const { data: order, error: fetchError } = await adminClient
      .from("orders")
      .select("id, order_number, status, order_type, rider_id, rider_phone, rider_name")
      .eq("order_number", order_number)
      .single();

    if (fetchError || !order) {
      return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });
    }

    if (order.order_type !== "delivery") {
      return NextResponse.json({ success: false, error: "Not a delivery order" }, { status: 400 });
    }

    // 2. Verify order hasn't been picked up yet
    if (order.status !== "ready_for_pickup" && order.status !== "preparing") {
      return NextResponse.json({ success: false, error: `Order cannot be declined from state: ${order.status}` }, { status: 400 });
    }

    // 3. Verify incoming rider identity matches the assigned rider
    if (order.rider_phone !== rider_phone || !order.rider_id) {
      return NextResponse.json({ success: false, error: "Rider identity mismatch or no rider assigned" }, { status: 403 });
    }

    const currentRiderId = order.rider_id;

    // 4. Unassign rider from order
    const { error: updateError } = await adminClient
      .from("orders")
      .update({
        rider_id: null,
        rider_name: null,
        rider_phone: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", order.id);

    if (updateError) {
      return NextResponse.json({ success: false, error: "Failed to unassign rider from order" }, { status: 500 });
    }

    // 5. Increment declines_count on the rider
    const { data: rider, error: fetchRiderError } = await adminClient
      .from("riders")
      .select("declines_count")
      .eq("id", currentRiderId)
      .single();

    if (!fetchRiderError && rider) {
      await adminClient
        .from("riders")
        .update({ declines_count: (rider.declines_count || 0) + 1 })
        .eq("id", currentRiderId);
    }

    return NextResponse.json({
      success: true,
      message: `Order ${order.order_number} successfully declined.`
    });

  } catch (err: any) {
    console.error("Rider Decline Error:", err);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
