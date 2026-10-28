import { requirePage } from "@/lib/auth/staff";
import OrdersBoard from "./OrdersBoard";

export default async function OrdersPage() {
  await requirePage("/dashboard/orders");

  return <OrdersBoard />;
}