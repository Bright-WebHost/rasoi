import { requirePage } from "@/lib/auth/staff";
import KitchenBoard from "./KitchenBoard";

export default async function KitchenPage() {
  await requirePage("/dashboard/kitchen");

  return <KitchenBoard />;
}
