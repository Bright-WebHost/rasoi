import { requirePage } from "@/lib/auth/staff";
import ChatBoard from "./ChatBoard";

export default async function ChatPage() {
  await requirePage("/dashboard/chat");

  return (
    <section>
      <ChatBoard />
    </section>
  );
}
