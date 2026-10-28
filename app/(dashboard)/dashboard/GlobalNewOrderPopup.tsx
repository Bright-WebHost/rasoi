"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useOrderManager } from "./OrderManagerProvider";
import { DashboardOrder } from "@/lib/orders/queries";
import { SlideAction } from "@/components/dashboard/ui/SlideAction";

function normalizeOrderType(t: string | null | undefined) {
  if (!t) return "Unknown";
  if (t.toLowerCase() === "pwa") return "Takeaway";
  return t.charAt(0).toUpperCase() + t.slice(1).replace("-", " ");
}

function money(val: string | number | undefined) {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return "Rs.0";
  return `Rs.${num.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function dateTime(str: string | null | undefined) {
  if (!str) return "-";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      day: "numeric",
      month: "short",
    }).format(new Date(str));
  } catch {
    return "Invalid date";
  }
}

function buildItemList(order: DashboardOrder) {
  if (Array.isArray(order.items_json) && order.items_json.length > 0) {
    return order.items_json.map((item: any, idx: number) => ({
      id: `${order.id}-${item.menu_item_id ?? (item.item_name || item.name)}-${idx}`,
      name: item.item_name || item.name,
      quantity: item.quantity,
      unit_price: item.unit_price ?? item.price,
      is_new_addition: item.is_new_addition,
      old_quantity: item.old_quantity,
      round: item.round,
    }));
  }
  const summary = order.items || "";
  return summary
    ? [{ id: `${order.id}-summary`, name: summary, quantity: 1, unit_price: order.total }]
    : [];
}

const PREP_TIMES = [10, 15, 20, 30, 45];
const DEFAULT_PREP_TIME = 20;

const DECLINE_REASONS = [
  "Item unavailable",
  "Kitchen full",
  "Outside delivery area",
  "Closing soon",
];

export function GlobalNewOrderPopup() {
  const pathname = usePathname();
  const { queuedNewOrders, acknowledgeOrder, updateOrderStatus } = useOrderManager();
  const [prepTime, setPrepTime] = useState<number>(DEFAULT_PREP_TIME);
  const [view, setView] = useState<"accept" | "decline">("accept");
  const [declineReason, setDeclineReason] = useState<string>("");

  const newOrder = queuedNewOrders.length > 0 ? queuedNewOrders[0] : null;

  useEffect(() => {
    if (!newOrder) return;
    setPrepTime(DEFAULT_PREP_TIME);
    setView("accept");
    setDeclineReason("");
  }, [newOrder?.id]);

  if (!newOrder || pathname === "/dashboard/pos") return null;

  const items = buildItemList(newOrder);
  const isUpdate =
    newOrder &&
    Array.isArray(newOrder.items_json) &&
    newOrder.items_json.some((i: any) => i.is_new_addition);

  const handleAccept = async () => {
    try {
      if (newOrder.status === "new") {
        await updateOrderStatus(newOrder, "preparing", undefined, undefined, { prepTime });
      } else if (isUpdate && newOrder.items_json) {
        const clearedItems = (newOrder.items_json as any[]).map((i: any) => ({
          ...i,
          is_new_addition: false,
          old_quantity: i.quantity,
        }));
        const { updateOrderInDb } = await import("@/lib/orders/actions");
        await updateOrderInDb(newOrder.id, { items_json: clearedItems });
      }
    } catch (e) {
      console.error("HandleAccept Error:", e);
    }
    acknowledgeOrder(newOrder.id, isUpdate);
  };

  const handleDecline = async () => {
    if (!declineReason) return;
    try {
      await updateOrderStatus(newOrder, "cancelled", declineReason);
    } catch (e) {
      console.error("HandleDecline Error:", e);
    }
    acknowledgeOrder(newOrder.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111A26]/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[20px] bg-white shadow-[0_24px_48px_rgba(0,0,0,0.2)] flex flex-col max-h-[92vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#EAF0F6] p-6 pb-5 shrink-0">
          <div className="flex flex-col">
            <span className="text-[12px] font-extrabold tracking-[2px] uppercase text-[#C0392B] mb-1">
              {isUpdate ? "Updated Order Items" : "New Incoming Order"}
            </span>
            <h2 className="text-[32px] leading-none font-extrabold tracking-[-1px] text-[#0A1017] flex items-center gap-3">
              {newOrder.order_number}
              {newOrder.table_number && (
                <span className="px-3 py-1 bg-[#0A1017] text-white rounded font-black text-[16px] tracking-wide uppercase mt-1">
                  {newOrder.table_number.toLowerCase().includes("table")
                    ? newOrder.table_number
                    : `Table ${newOrder.table_number}`}
                </span>
              )}
            </h2>
            <p className="mt-1 text-[13px] font-medium text-[#8799AF]">
              Received {dateTime(newOrder.created_at)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-md bg-[#FFF7E6] border border-[#F3D28B] px-3 py-1.5 text-[13px] font-bold text-[#9A6700]">
              {normalizeOrderType(newOrder.order_type)}
            </span>
            {queuedNewOrders.length > 1 && (
              <span className="rounded-full bg-[#FFF0F1] border border-[#F5C2C6] px-3 py-1 text-[12px] font-bold text-[#C0392B]">
                +{queuedNewOrders.length - 1} more in queue
              </span>
            )}
          </div>
        </div>

        {/* Customer & Amount */}
        <div className="grid grid-cols-2 gap-4 px-6 py-4 border-b border-[#EAF0F6] shrink-0">
          <div className="flex flex-col">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#8799AF] mb-1">Customer</span>
            <span className="text-[15px] font-bold text-[#0A1017]">{newOrder.customer_name || "Guest"}</span>
            <span className="text-[13px] font-medium text-[#8799AF]">{newOrder.customer_phone}</span>
          </div>
          <div className="flex flex-col items-end text-right">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#8799AF] mb-1">Total</span>
            <span className="text-[28px] leading-none font-extrabold text-[#C0392B]">{money(newOrder.total)}</span>
            <span className="text-[12px] font-medium text-[#8799AF] mt-1">
              {newOrder.order_type === "delivery" ? "Cash on delivery" : "Cash / UPI"}
            </span>
          </div>
          {newOrder.order_type === "delivery" &&
            (newOrder.address || newOrder.landmark || newOrder.pincode) && (
              <div className="col-span-2 bg-[#F8FAFB] p-3 rounded-xl border border-[#EAF0F6]">
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#8799AF] block mb-1">
                  Delivery Address
                </span>
                <span className="text-[14px] font-medium text-[#0A1017]">
                  {[newOrder.address, newOrder.landmark, newOrder.pincode].filter(Boolean).join(", ")}
                </span>
              </div>
            )}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-[80px]">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#8799AF] block mb-3">Order Items</span>
          <div className="space-y-2">
            {items.map((item: any) => (
              <div
                key={item.id}
                className={`flex justify-between items-start p-3 border rounded-xl ${
                  item.is_new_addition ? "bg-[#FFF8E6] border-[#F2C94C]" : "bg-[#F8FAFB] border-[#EAF0F6]"
                }`}
              >
                <div className="flex gap-3">
                  <span
                    className={`font-extrabold text-[15px] w-[24px] ${
                      item.is_new_addition ? "text-[#D97706]" : "text-[#0A1017]"
                    }`}
                  >
                    {item.quantity}x
                  </span>
                  <div className="flex flex-col">
                    <span className="font-bold text-[15px] text-[#0A1017]">
                      {item.name}
                      {item.round > 1 && (
                        <span className="text-[12px] text-[#8799AF] ml-1">(Round {item.round})</span>
                      )}
                    </span>
                    {item.is_new_addition && (
                      <span className="text-[11px] font-extrabold text-[#D97706] mt-1 uppercase tracking-widest bg-[#FEF3C7] px-2 py-0.5 rounded-md inline-block w-fit">
                        {item.old_quantity > 0
                          ? `+${item.quantity - item.old_quantity} Added`
                          : "New Item"}
                      </span>
                    )}
                  </div>
                </div>
                <span className="font-bold text-[15px] text-[#0A1017]">
                  {money((item.unit_price ?? 0) * item.quantity)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-[16px] font-extrabold bg-[#FFF0F1] p-3 rounded-xl border border-[#F5C2C6]">
            <span className="text-[#C0392B]">Total</span>
            <span className="text-[#C0392B]">{money(newOrder.total)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-[#EAF0F6] px-6 pt-4 pb-5 shrink-0 bg-white">
          {view === "accept" ? (
            <>
              {!isUpdate && (
                <>
                  <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#8799AF] block mb-2 text-center">
                    Ready in
                  </span>
                  <div className="flex gap-2 justify-center mb-4">
                    {PREP_TIMES.map((time) => (
                      <button
                        key={time}
                        type="button"
                        onClick={() => setPrepTime(time)}
                        className={`w-[56px] h-[44px] rounded-[12px] font-extrabold text-[14px] transition-all border ${
                          prepTime === time
                            ? "bg-[#C0392B] text-white shadow-[0_4px_12px_rgba(192,57,43,0.3)] border-transparent"
                            : "bg-white text-[#0A1017] border-[#EAF0F6] hover:border-[#C0392B] hover:text-[#C0392B]"
                        }`}
                      >
                        {time}m
                      </button>
                    ))}
                  </div>
                </>
              )}

              <SlideAction
                label={isUpdate ? "Acknowledge Update" : "Slide to Accept & Cook"}
                baseColor="#F8FAFB"
                accentColor={isUpdate ? "#D97706" : "#C0392B"}
                onAcknowledge={handleAccept}
              />

              {!isUpdate && (
                <button
                  type="button"
                  onClick={() => setView("decline")}
                  className="mt-3 w-full h-[44px] rounded-[12px] border border-[#F5C2C6] bg-white text-[14px] font-extrabold text-[#C0392B] hover:bg-[#FFF0F1] transition-colors"
                >
                  Decline this order
                </button>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => { setView("accept"); setDeclineReason(""); }}
                  className="flex items-center gap-1.5 text-[13px] font-bold text-[#8799AF] hover:text-[#0A1017] transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                  Back
                </button>
                <span className="text-[14px] font-extrabold text-[#C0392B]">
                  Select a reason to decline
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4">
                {DECLINE_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setDeclineReason(reason)}
                    className={`h-[52px] rounded-[12px] font-bold text-[13px] transition-all border px-3 text-left ${
                      declineReason === reason
                        ? "bg-[#FDE8E8] border-[#C0392B] text-[#C0392B] shadow-[0_4px_12px_rgba(192,57,43,0.15)]"
                        : "bg-white border-[#EAF0F6] text-[#0A1017] hover:border-[#C0392B] hover:text-[#C0392B]"
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>

              {declineReason ? (
                <SlideAction
                  label={`Slide to decline - ${declineReason}`}
                  baseColor="#FDE8E8"
                  accentColor="#C0392B"
                  onAcknowledge={handleDecline}
                  resetOnComplete={false}
                />
              ) : (
                <div className="h-[52px] rounded-[14px] bg-[#F8FAFB] border border-[#EAF0F6] flex items-center justify-center text-[13px] font-bold text-[#8799AF]">
                  Select a reason above to continue
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
