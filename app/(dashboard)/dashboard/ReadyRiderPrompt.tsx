"use client";

/* When the kitchen marks a delivery order ready and it has no rider yet, ask
   who is taking it (Oceana's rider picker). Skipping hides it for this order. */
import { useState } from "react";
import { useOrderManager } from "./OrderManagerProvider";
import { useStaff } from "@/components/providers/StaffProvider";
import { useOc } from "./DashShell";
import { RiderPicker } from "./OcKit";

export default function ReadyRiderPrompt() {
  const { orders, queuedNewOrders, updateOrderStatus } = useOrderManager();
  const { hasPerm } = useStaff();
  const { toast } = useOc();
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  if (!hasPerm("assign_rider") || queuedNewOrders.length) return null;
  const o = orders.find((x) => x.status === "ready_for_pickup" && x.order_type === "delivery" && !x.rider_id && !skipped.has(x.id));
  if (!o) return null;
  const skip = () => setSkipped((s) => new Set(s).add(o.id));
  return (
    <RiderPicker key={o.id} orderNumber={o.order_number} onSkip={skip} onPick={async (r) => {
      skip();
      try {
        await updateOrderStatus(o, "out_for_delivery", undefined, r);
        toast("Assigned to " + r.name);
      } catch { toast("Could not assign a rider"); }
    }} />
  );
}
