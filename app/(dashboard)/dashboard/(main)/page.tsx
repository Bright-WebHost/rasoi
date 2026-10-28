import { requirePage } from "@/lib/auth/staff";
import OrdersBoard from "./orders/OrdersBoard";

export default async function DashboardPage() {
  await requirePage("/dashboard/orders");

  return <OrdersBoard />;
}
