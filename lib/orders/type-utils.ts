/** A table number is the durable signal for older POS-created dine-in rows. */
export function normalizeDashboardOrderType(order: {
  order_type: string | null | undefined;
  table_number: string | null | undefined;
}) {
  return order.order_type === "dine-in" || Boolean(String(order.table_number ?? "").trim())
    ? "dine-in"
    : order.order_type || "delivery";
}
