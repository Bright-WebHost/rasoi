import { requirePage } from "@/lib/auth/staff";
import TablesBoard from "./TablesBoard";

export default async function TablesPage() {
  await requirePage("/dashboard/tables");

  return <TablesBoard />;
}
