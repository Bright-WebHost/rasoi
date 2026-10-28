import { requirePage } from "@/lib/auth/staff";
import PosBoard from "./PosBoard";

export const metadata = {
  title: "POS | Pabbas",
};

export default async function PosPage() {
  await requirePage("/dashboard/pos");

  return (
    <div className="flex-1 w-full flex flex-col min-h-0 bg-[#F8FAFB]">
      <PosBoard />
    </div>
  );
}
