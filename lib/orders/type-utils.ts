/** A table number is the durable signal for older POS-created dine-in rows. */
export function normalizeDashboardOrderType(order: {
  order_type: string | null | undefined;
  table_number: string | null | undefined;
}) {
  return order.order_type === "dine-in" || Boolean(String(order.table_number ?? "").trim())
    ? "dine-in"
    : order.order_type || "delivery";
}

export type DashboardOrderSource = "whatsapp" | "table" | "pos";

export function dashboardOrderSourceKey(
  source: string | null | undefined,
  orderType?: string | null,
  tableNumber?: string | number | null,
): DashboardOrderSource | null {
  const value = String(source || "").trim().toLowerCase();
  if (value === "pos" || value.includes("point of sale")) return "pos";
  if (orderType === "dine-in" || String(tableNumber || "").trim()) return "table";
  if (!value) return null;
  if (value.includes("whatsapp") || value === "wa" || ["pwa", "web", "website", "online", "guest"].includes(value)) return "whatsapp";
  return null;
}
