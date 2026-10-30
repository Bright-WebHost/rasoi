import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppText } from "@/lib/server/ycloud";

function rupees(value: unknown) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function buildTableBillMessage(order: Record<string, any>) {
  const items = Array.isArray(order.items_json) ? order.items_json : [];
  const itemLines = items.map((item: Record<string, any>) => {
    const name = [item.item_name || item.name || "Item", item.variant_name].filter(Boolean).join(" · ");
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = Number(item.unit_price ?? item.price ?? 0);
    return `• ${quantity} × ${name} — ${rupees(unitPrice * quantity)}`;
  });

  return [
    `*Rasoi — Final Table Bill*`,
    `Table: ${order.table_number || "Dine-in"}`,
    `Order: ${order.order_number}`,
    "",
    ...(itemLines.length ? itemLines : [String(order.items || "Items")]),
    "",
    `*Total: ${rupees(order.total)}*`,
    "Settled and closed. Thank you for dining with us!",
  ].join("\n");
}

/** Send the final itemized bill for a closed dine-in order, recording failures for retry. */
export async function sendClosedTableBill(orderId: string) {
  const adminClient = createAdminClient();
  const { data: order, error } = await adminClient
    .from("orders")
    .select("id, order_number, order_type, table_number, customer_phone, items, items_json, total, status, whatsapp_bill_sent_at")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) return { success: false, sent: false, error: "Closed table order could not be loaded." };
  const isDineInOrder = order.order_type === "dine-in" || Boolean(String(order.table_number || "").trim());
  if (!isDineInOrder || order.status !== "delivered") {
    return { success: false, sent: false, error: "The table order must be closed before its bill can be sent." };
  }
  if (order.whatsapp_bill_sent_at) return { success: true, sent: true, alreadySent: true };

  const phone = String(order.customer_phone || "").trim();
  if (!phone) {
    const message = "No customer WhatsApp number was saved for this order.";
    await adminClient.from("orders").update({ whatsapp_bill_error: message }).eq("id", orderId);
    return { success: false, sent: false, error: message };
  }

  const result = await sendWhatsAppText(phone, buildTableBillMessage(order));
  if (!result.success) {
    await adminClient.from("orders").update({ whatsapp_bill_error: result.error }).eq("id", orderId);
    return { success: false, sent: false, error: result.error || "WhatsApp send failed." };
  }

  const sentAt = new Date().toISOString();
  const { error: updateError } = await adminClient
    .from("orders")
    .update({ whatsapp_bill_sent_at: sentAt, whatsapp_bill_error: null })
    .eq("id", orderId);

  if (updateError) {
    console.error("[sendClosedTableBill] Message sent but bill status could not be saved:", updateError.message);
    return { success: true, sent: true, trackingError: "The bill was sent, but its sent status could not be saved." };
  }

  return { success: true, sent: true, sentAt };
}
