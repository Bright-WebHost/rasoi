import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppBillTemplate } from "@/lib/server/ycloud";

function receiptImageUrl(orderNumber: string) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://rasoi-pied.vercel.app").replace(/\/+$/, "");
  // Cache-buster: the receipt image is cached, and table rounds may have changed it since any earlier render.
  return `${base}/api/receipt?order_number=${encodeURIComponent(orderNumber)}&v=${Date.now()}`;
}

async function sendOrderBill(orderId: string, mode: "pos" | "closed-table") {
  try {
    const adminClient = createAdminClient();
    const { data: order, error } = await adminClient
      .from("orders")
      .select("id, order_number, source, order_type, table_number, customer_name, customer_phone, total, status, whatsapp_bill_sent_at")
      .eq("id", orderId)
      .maybeSingle();

    if (error || !order) return { success: false, sent: false, error: "Order bill could not be loaded." };

    const isDineInOrder = order.order_type === "dine-in" || Boolean(String(order.table_number || "").trim());
    if (mode === "pos" && order.source !== "pos") {
      return { success: false, sent: false, error: "Only POS orders can receive an immediate bill." };
    }
    if (mode === "closed-table" && (!isDineInOrder || order.status !== "delivered")) {
      return { success: false, sent: false, error: "The table order must be closed before its bill can be sent." };
    }
    if (order.whatsapp_bill_sent_at) return { success: true, sent: true, alreadySent: true };

    const phone = String(order.customer_phone || "").trim();
    if (!phone) {
      const message = "No customer WhatsApp number was saved for this order.";
      await adminClient.from("orders").update({ whatsapp_bill_error: message }).eq("id", orderId);
      return { success: false, sent: false, error: message };
    }

    const customerName = String(order.customer_name || "there").trim() || "there";
    const total = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(order.total) || 0);
    const result = await sendWhatsAppBillTemplate(
      phone,
      receiptImageUrl(order.order_number),
      customerName,
      order.order_number,
      total,
    );
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
      console.error("[sendOrderBill] Message sent but bill status could not be saved:", updateError.message);
      return { success: true, sent: true, trackingError: "The bill was sent, but its sent status could not be saved." };
    }

    return { success: true, sent: true, sentAt };
  } catch (error) {
    console.error("[sendOrderBill] Error:", error);
    return { success: false, sent: false, error: "WhatsApp bill could not be sent." };
  }
}

/** Send the approved bill immediately for an order created or changed in POS. */
export async function sendPosOrderBill(orderId: string) {
  return sendOrderBill(orderId, "pos");
}

/** Send the final bill for a dine-in order after staff closes a QR table. */
export async function sendClosedTableBill(orderId: string) {
  return sendOrderBill(orderId, "closed-table");
}
