import { requirePage } from "@/lib/auth/staff";
import RidersContainer from "./RidersContainer";

export const metadata = {
  title: "Riders | Pabbas",
};

export default async function RidersPage() {
  await requirePage("/dashboard/riders");

  return (
    <div className="flex-1 w-full flex flex-col min-h-0 bg-[#F8FAFB] h-full">
      <RidersContainer />
    </div>
  );
}
