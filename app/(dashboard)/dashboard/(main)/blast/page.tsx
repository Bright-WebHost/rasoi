import { requirePage } from "@/lib/auth/staff";
import BlastBoard from "./BlastBoard";

export default async function BlastPage() {
  await requirePage("/dashboard/blast");

  return (
    <div className="w-full">
      <BlastBoard />
    </div>
  );
}
