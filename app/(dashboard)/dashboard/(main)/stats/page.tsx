import { requirePage } from "@/lib/auth/staff";
import AnalyticsBoard from "./AnalyticsBoard";

export default async function StatsPage() {
  await requirePage("/dashboard/stats");

  return (
    <div className="w-full">
      <AnalyticsBoard />
    </div>
  );
}
