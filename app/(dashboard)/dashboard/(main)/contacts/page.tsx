import { requirePage } from "@/lib/auth/staff";
import ContactsBoard from "./ContactsBoard";

export default async function ContactsPage() {
  await requirePage("/dashboard/contacts");

  return (
    <div className="w-full">
      <ContactsBoard />
    </div>
  );
}
