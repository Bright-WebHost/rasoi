import { requirePage } from "@/lib/auth/staff";
import MenuBoard from "./MenuBoard";

export default async function MenuPage() {
  await requirePage("/dashboard/menu");

  return (
    <section>
      <MenuBoard />
    </section>
  );
}
