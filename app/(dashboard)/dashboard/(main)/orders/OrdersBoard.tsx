"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardOrder, OrderStatus } from "@/lib/orders/queries";
import { useStaff } from "@/components/providers/StaffProvider";
import { useOrderManager } from "../../OrderManagerProvider";
import { AssignRiderModal } from "./AssignRiderModal";
import { SlideAction } from "@/components/dashboard/ui/SlideAction";
import { motion, AnimatePresence } from "framer-motion";
import { collectCash, markUnpaidOrderPaid } from "./actions";
import { printOrderBill } from "@/lib/print/bill";
import { formatPickupTime } from "@/lib/orders/format";

const ORDER_SELECT =
  "id, order_number, customer_phone, customer_name, items, total, status, order_type, source, address, landmark, city, pincode, table_number, confirmed_at, amend_window_until, amended_at, amendment_count, original_items, cancel_reason, cancelled_by, cancelled_at, cancel_requested_at, created_at, updated_at, items_json";

const RANGE_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All Time" },
] as const;

type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];

const statusLabels: Record<OrderStatus, string> = {
  new: "New",
  preparing: "Preparing",
  ready_for_pickup: "Ready for Pickup",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const statusStyles: Record<OrderStatus, string> = {
  new: "bg-[#FFF7E6] text-[#9A6700] border-[#F3D28B]",
  preparing: "bg-[var(--c-prep)] text-[var(--c-prep-t)] border-[var(--c-prep-b)]",
  ready_for_pickup: "bg-[var(--c-ready)] text-[var(--c-ready-t)] border-[var(--c-ready-b)]",
  out_for_delivery: "bg-[var(--c-ready)] text-[var(--c-ready-t)] border-[var(--c-ready-b)]",
  delivered: "bg-[var(--c-done)] text-[var(--c-done-t)] border-[var(--c-done-b)]",
  cancelled: "bg-[#F3F4F6] text-[#667085] border-[#D0D5DD]",
};

const BOARD_COLUMNS: Array<{ key: "preparing" | "ready" | "delivered"; label: string; className: string }> = [
  { key: "preparing", label: "Preparing", className: "preparing" },
  { key: "ready", label: "Ready / Out", className: "ready" },
  { key: "delivered", label: "Delivered", className: "delivered" },
];

const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["preparing", "cancelled"],
  preparing: ["ready_for_pickup", "out_for_delivery", "cancelled"],
  ready_for_pickup: ["out_for_delivery", "delivered", "cancelled"],
  out_for_delivery: ["out_for_delivery", "delivered", "cancelled"],
  delivered: [],
  cancelled: ["new", "preparing", "ready_for_pickup", "out_for_delivery"],
};

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const money = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const dateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const durationText = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatCountdown = (order: DashboardOrder, now: number) => {
  if (order.status === "ready_for_pickup" || order.status === "delivered" || order.status === "cancelled") {
    return {
      isOverdue: false,
      label: "Completed",
      seconds: 0,
    };
  }

  const createdAtMs = new Date(order.created_at).getTime();
  const remaining = FIFTEEN_MINUTES_MS - (now - createdAtMs);

  if (remaining <= 0) {
    const elapsed = now - createdAtMs - FIFTEEN_MINUTES_MS;
    return {
      isOverdue: true,
      label: `OVERDUE +${durationText(elapsed)}`,
      seconds: remaining,
    };
  }

  return {
    isOverdue: false,
    label: durationText(remaining),
    seconds: remaining,
  };
};

function normalizeOrderType(value: string | null | undefined) {
  if (value === "dine-in") return "Dine-in";
  if (value === "takeaway" || value === "pickup") return "Pickup";
  if (value === "pos") return "POS";
  return "Delivery";
}

function destinationFor(order: DashboardOrder) {
  if (order.order_type === "delivery") {
    return [order.address, order.landmark, order.pincode].filter(Boolean).join(", ") || "Address not provided";
  }
  return "Pickup";
}

function buildItemList(order: DashboardOrder) {
  if (Array.isArray(order.items_json) && order.items_json.length > 0) {
    return order.items_json.map((item: any, idx: number) => ({
      id: `${order.id}-${item.menu_item_id ?? (item.item_name || item.name)}-${idx}`,
      name: item.item_name || item.name,
      quantity: item.quantity,
      unit_price: item.unit_price ?? item.price,
      is_new_addition: item.is_new_addition || false,
      old_quantity: item.old_quantity || 0,
      variant_name: item.variant_name || "",
      round: item.round || 1
    }));
  }

  const summary = order.items || "";
  return summary ? [{ 
    id: `${order.id}-summary`, 
    name: summary, 
    quantity: 1, 
    unit_price: order.total,
    is_new_addition: false,
    old_quantity: 0,
    variant_name: "",
    round: 1
  }] : [];
}

function canTransitionStatus(current: OrderStatus, next: OrderStatus) {
  if (current === next) return true;
  return (STATUS_TRANSITIONS[current] ?? []).includes(next);
}

function inRange(order: DashboardOrder, range: RangeKey) {
  const createdAt = new Date(order.created_at).getTime();
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (range === "all") return true;
  if (range === "today") return createdAt >= todayStart.getTime();
  if (range === "yesterday") {
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);
    return createdAt >= yesterdayStart.getTime() && createdAt < yesterdayEnd.getTime();
  }
  if (range === "week") {
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);
    return createdAt >= weekStart.getTime();
  }
  if (range === "month") {
    const monthStart = new Date(todayStart);
    monthStart.setDate(monthStart.getDate() - 29);
    return createdAt >= monthStart.getTime();
  }
  return createdAt >= now - 24 * 60 * 60 * 1000;
}

function getBoardColumn(order: DashboardOrder) {
  if (order.status === "new") return "new";
  if (order.status === "preparing") return "preparing";
  if (order.status === "ready_for_pickup" || order.status === "out_for_delivery") return "ready";
  if (order.status === "delivered") return "delivered";
  return "new";
}

function getAgeMinutes(order: DashboardOrder) {
  return Math.max(0, Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000));
}

function getAgeLabel(order: DashboardOrder) {
  const minutes = getAgeMinutes(order);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;
  return `${hours}h ${leftoverMinutes}m`;
}

function getSlideAction(order: DashboardOrder, hasPerm: (p: any) => boolean): { label: string; nextStatus: OrderStatus; accent: string } | null {
  if (order.status === "new" && hasPerm("accept_delivery")) {
    return { label: "Slide to accept & cook", nextStatus: "preparing", accent: "#C0392B" };
  }

  if (order.status === "preparing" && hasPerm("mark_ready")) {
    const nextStatus: OrderStatus = order.order_type === "delivery" ? "out_for_delivery" : "ready_for_pickup";
    return { label: "Slide to ready / out", nextStatus, accent: "#1A5FA8" };
  }

  if ((order.status === "ready_for_pickup" || order.status === "out_for_delivery") && hasPerm("mark_delivered")) {
    return { label: "Slide to delivered", nextStatus: "delivered", accent: "#5B3FBF" };
  }

  return null;
}



function OrderDetails({ order, onClose, now, onStatusChange }: { order: DashboardOrder; onClose: () => void; now: number; onStatusChange: (order: DashboardOrder, nextStatus: OrderStatus, reason?: string) => void }) {
  const { hasPerm } = useStaff();
  const { refreshOrders } = useOrderManager();
  const items = buildItemList(order);
  const countdown = formatCountdown(order, now);
  const slideAction = getSlideAction(order, hasPerm);
  const [isCollecting, setIsCollecting] = useState(false);

  const handleCollectCash = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const amountStr = window.prompt(`Amount Received from Rider (Expected: ₹${order.total}):`, String(order.total));
    if (!amountStr) return;
    const amount = Number(amountStr);
    if (isNaN(amount) || amount < 0) {
      alert("Invalid amount");
      return;
    }
    setIsCollecting(true);
    try {
      const res = await collectCash(order.id, order.total, amount, order.rider_id || undefined);
      if (res.success) {
        await refreshOrders();
        onClose();
      } else {
        alert("Failed to collect cash: " + res.error);
      }
    } catch(err) {
      alert("Error collecting cash");
    } finally {
      setIsCollecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111A26]/80 p-4 backdrop-blur-sm transition-all duration-300" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={`Details for ${order.order_number}`}
        aria-modal="true"
        role="dialog"
        className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-[20px] bg-white p-6 shadow-[0_24px_48px_rgba(0,0,0,0.2)] flex flex-col"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-[var(--line)] pb-5">
          <div className="flex flex-col">
            <span className="text-[12px] font-extrabold tracking-[2px] uppercase text-[var(--muted)] mb-1">
              Order Details
            </span>
            <div className="flex items-center gap-3">
              <h2 className="text-[32px] leading-none font-extrabold tracking-[-1px] text-[var(--ink)]">
                {order.order_number}
              </h2>
              <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${statusStyles[order.status]}`}>
                {statusLabels[order.status]}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] font-medium text-[var(--muted)]">Received {dateTime(order.created_at)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-[#F1F3F6] p-2 text-[var(--muted)] hover:bg-[#E6E9EE] hover:text-[var(--ink)] transition-colors" aria-label="Close order details">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-6 py-5 border-b border-[var(--line)] shrink-0">
          <div className="flex flex-col">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--muted)] mb-1">Customer</span>
            <span className="text-[15px] font-bold text-[var(--ink)]">{order.customer_name || "Guest"}</span>
            <span className="text-[14px] font-medium text-[var(--muted)]">{order.customer_phone}</span>
          </div>
          
          <div className="flex flex-col">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--muted)] mb-1">Type & Source</span>
            <span className="text-[15px] font-bold text-[var(--ink)]">{normalizeOrderType(order.order_type)}</span>
            {formatPickupTime(order.scheduled_for) && (
              <span className="text-[13px] font-extrabold text-[#9A6700]">⏰ Pickup {formatPickupTime(order.scheduled_for)}</span>
            )}
            <span className="text-[14px] font-medium text-[var(--muted)]">{order.source || "Direct"}</span>
          </div>

          <div className="flex flex-col text-right">
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--muted)] mb-1">Countdown</span>
            <span className={`text-[20px] font-extrabold ${countdown.isOverdue ? "text-[var(--danger)]" : "text-[var(--ink)]"}`}>{countdown.label}</span>
          </div>

          {(order.order_type === "delivery" || order.table_number) && (
            <div className="col-span-full bg-[#F8FAFB] p-3 rounded-xl border border-[var(--line)]">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--muted)] block mb-1">
                {order.table_number ? "Table" : "Delivery Address"}
              </span>
              <span className="text-[14px] font-medium text-[var(--ink)]">
                {order.table_number 
                  ? `Table ${order.table_number}`
                  : `📍 ${[order.address, order.landmark, order.city, order.pincode].filter(Boolean).join(", ")}`
                }
              </span>
            </div>
          )}

          {order.rider_name && (
            <div className="col-span-full bg-[#EAF3FF] p-3 rounded-xl border border-[#B8D5F6]">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#1A5FA8] block mb-1">
                Assigned Rider
              </span>
              <span className="text-[14px] font-bold text-[#0A1017]">
                🛵 {order.rider_name} - {order.rider_phone}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1 py-5 overflow-y-auto">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-[var(--muted)] block mb-3">Order Items</span>
          <div className="space-y-4">
            {items.length > 0 ? Array.from(new Set(items.map(item => item.round || 1))).sort().map((roundNum: any) => {
              const roundItems = items.filter(item => (item.round || 1) === roundNum);
              return (
                <div key={roundNum}>
                  <h4 className={`text-[12px] font-extrabold uppercase tracking-widest mb-2 ${roundNum > 1 ? 'text-[#D97706]' : 'text-[var(--muted)]'}`}>
                    Round {roundNum} {roundNum > 1 && '(Added Items)'}
                  </h4>
                  <div className="space-y-2">
                    {roundItems.map((item) => (
                      <div key={item.id} className={`flex justify-between items-start p-3 ${roundNum > 1 || item.is_new_addition ? "bg-[#FFF8E6] border-[#F2C94C] shadow-[0_2px_8px_rgba(242,201,76,0.15)]" : "bg-[#F8FAFB] border-[var(--line)]"} rounded-xl`}>
                        <div className="flex gap-3">
                          <span className={`font-extrabold text-[15px] w-[24px] ${roundNum > 1 || item.is_new_addition ? "text-[#D97706]" : "text-[var(--ink)]"}`}>{item.quantity}×</span>
                          <div className="flex flex-col">
                            <span className="font-bold text-[15px] text-[var(--ink)]">
                              {item.name} {item.variant_name && <span className="text-[12px] font-medium text-[var(--muted)] ml-1">({item.variant_name})</span>}
                            </span>
                            {(roundNum > 1 || item.is_new_addition) && (
                              <span className="text-[11px] font-extrabold text-[#D97706] mt-1 uppercase tracking-widest bg-[#FEF3C7] px-2 py-0.5 rounded-md inline-block w-fit">
                                {item.old_quantity > 0 ? `+${item.quantity - item.old_quantity} Added` : 'New Item'}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="font-bold text-[15px] text-[var(--ink)]">{money(item.unit_price * item.quantity)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }) : <p className="text-[13px] text-[var(--muted)]">Items unavailable.</p>}
          </div>

          <div className="mt-4 flex items-center justify-between text-[18px] font-extrabold bg-[#FFF0F1] p-4 rounded-xl border border-[#F5C2C6]">
            <span className="text-[#C0392B]">Total Amount</span>
            <span className="text-[#C0392B]">{money(order.total)}</span>
          </div>
        </div>

        {/* Cancellation Info block (if any) */}
        {order.status === "cancelled" && (
          <div className="mb-4 bg-[#FDE8E8] border border-[#F5C6CB] rounded-xl p-4">
            <h4 className="text-[12px] font-extrabold uppercase tracking-[1px] text-[#B42318] mb-1">Cancellation Details</h4>
            <p className="text-[14px] text-[#B42318]">
              <strong>Reason:</strong> {(order.cancel_reason?.includes("|") ? order.cancel_reason.split("|").slice(1).join("|") : order.cancel_reason) || "None provided"}<br/>
              <strong>By:</strong> {order.cancelled_by || "Unknown"}<br/>
              <strong>At:</strong> {dateTime(order.cancelled_at)}
            </p>
          </div>
        )}

        <div className="pt-5 border-t border-[var(--line)] shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              {slideAction && (
                <SlideAction
                  label={slideAction.label}
                  accentColor={slideAction.accent}
                  baseColor="#F8FAFB"
                  textColor={slideAction.accent}
                  onAcknowledge={() => {
                    onStatusChange(order, slideAction.nextStatus);
                    onClose();
                  }}
                  resetOnComplete={false}
                />
              )}
            </div>

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); printOrder(order); }}
              className="h-[48px] rounded-[12px] border border-[var(--line)] bg-white px-5 text-[14px] font-extrabold text-[var(--ink)] shadow-sm hover:bg-[#F8FAFB] transition-colors"
            >
              Print
            </button>

            {hasPerm("cancel_order") && order.status !== "cancelled" && order.status !== "delivered" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const reason = window.prompt("Reason for cancellation:");
                  if (reason) {
                    onStatusChange(order, "cancelled", reason);
                    onClose();
                  }
                }}
                className="h-[48px] rounded-[12px] border border-[#F5C6CB] bg-[#FDE8E8] px-5 text-[14px] font-extrabold text-[#C0392B] hover:bg-[#F5C2C6] transition-colors"
              >
                Cancel
              </button>
            )}

            {hasPerm("assign_rider") && order.status === "out_for_delivery" && order.rider_name && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusChange(order, "out_for_delivery", undefined);
                  onClose();
                }}
                className="h-[48px] rounded-[12px] border border-[#C9B8F5] bg-[#F2EEFF] px-5 text-[14px] font-extrabold text-[#5B3FBF] hover:bg-[#E9E0FF] transition-colors"
              >
                🔄 Reassign Rider
              </button>
            )}

            {hasPerm("reopen_cancelled") && order.status === "cancelled" && (
              <UndoCancelButton
                order={order}
                onRestored={onClose}
                className="h-[48px] rounded-[12px] border border-[#C6ECD6] bg-[#E5F5EC] px-5 text-[14px] font-extrabold text-[#146C43] hover:bg-[#D1E7DD] transition-colors shadow-sm"
              />
            )}



            {isUnpaid(order) && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="h-[48px] rounded-[12px] border border-[#F5C2C6] bg-[#FDE8E8] px-4 flex items-center text-[14px] font-extrabold text-[#C0392B]">
                  ⚠️ Customer didn&apos;t pay the rider ({money(order.total)})
                </div>
                {hasPerm("collect_cash") && <MarkPaidButton order={order} className="h-[48px] rounded-[12px] border border-[#C6ECD6] bg-[#E5F5EC] px-5 text-[14px] font-extrabold text-[#146C43] hover:bg-[#D1E7DD] transition-colors disabled:opacity-50" />}
              </div>
            )}

            {hasPerm("collect_cash") && order.order_type === "delivery" && order.status === "delivered" && !order.is_collected && !isUnpaid(order) && (
              <button
                type="button"
                disabled={isCollecting}
                onClick={handleCollectCash}
                className="h-[48px] rounded-[12px] border border-[#B8D5F6] bg-[#EAF3FF] px-5 text-[14px] font-extrabold text-[#1A5FA8] hover:bg-[#DCE9FA] transition-colors disabled:opacity-50"
              >
                {isCollecting ? "Processing..." : `Collect ₹${order.total}`}
              </button>
            )}

            {order.order_type === "delivery" && order.status === "delivered" && order.is_collected && (
              <div className="h-[48px] rounded-[12px] border border-[#C6ECD6] bg-[#E5F5EC] px-5 flex items-center text-[14px] font-extrabold text-[#146C43]">
                {order.payment_status === "paid_later" ? "✓ Paid to the shop" : "✓ Cash Collected"} (₹{order.collected_amount != null && order.collected_amount > 0 ? order.collected_amount : order.total})
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-5">{value}</p>
    </div>
  );
}

/** Rider tapped "Unpaid": delivered, but the customer still owes the shop. */
const isUnpaid = (order: DashboardOrder) => order.order_type === "delivery" && order.status === "delivered" && order.payment_status === "unpaid";

function MarkPaidButton({ order, className }: { order: DashboardOrder; className: string }) {
  const { refreshOrders } = useOrderManager();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={className}
      onClick={async (event) => {
        event.stopPropagation();
        if (!window.confirm(`Mark ${order.order_number} as paid? Use this once the customer has paid the shop (₹${order.total}).`)) return;
        setBusy(true);
        const res = await markUnpaidOrderPaid(order.id).catch(() => ({ success: false, error: "Network error" }));
        setBusy(false);
        if (res.success) await refreshOrders();
        else alert("Could not mark as paid: " + ("error" in res ? res.error : ""));
      }}
    >
      {busy ? "Saving…" : `✅ Mark as paid (₹${order.total})`}
    </button>
  );
}

function printOrder(order: DashboardOrder) {
  void printOrderBill(order.id);
}

function previousStatusOf(order: DashboardOrder): OrderStatus {
  const prev = order.cancel_reason?.includes("|") ? order.cancel_reason.split("|")[0] : "new";
  return (["new", "preparing", "ready_for_pickup", "out_for_delivery"] as OrderStatus[]).includes(prev as OrderStatus) ? (prev as OrderStatus) : "new";
}

function UndoCancelButton({ order, className, onRestored }: { order: DashboardOrder; className: string; onRestored?: () => void }) {
  const { updateOrderStatus } = useOrderManager();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = previousStatusOf(order);

  const submit = async (value: string) => {
    if (!/^\d{4}$/.test(value) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateOrderStatus(order, target, "Undo Cancel", undefined, { pin: value });
      setOpen(false);
      onRestored?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore the order.");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setPin("");
          setError(null);
          setOpen(true);
        }}
        className={className}
      >
        Undo Cancel
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <div className="w-full max-w-[340px] rounded-[24px] bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold text-[var(--ink)]">Undo cancel</h3>
            <p className="mt-1 text-sm font-medium text-[var(--muted)]">
              Restore {order.order_number} to {statusLabels[target]}. Enter the 4-digit undo passcode.
            </p>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              disabled={busy}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "").slice(0, 4);
                setPin(value);
                if (value.length === 4) void submit(value);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(pin); }}
              className={`mt-4 w-full rounded-xl border bg-[#F8FAFB] px-4 py-3 text-center text-2xl font-extrabold tracking-[0.6em] outline-none focus:bg-white ${error ? "border-[#E23744]" : "border-[#EAF0F6] focus:border-[#0D6EFD]"}`}
              placeholder="••••"
            />
            {error && <p className="mt-2 text-[13px] font-bold text-[#C0392B]">{error}</p>}
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-xl border border-[#EAF0F6] py-2.5 text-sm font-bold text-[var(--ink)] hover:bg-[#F3F6F9]">Cancel</button>
              <button type="button" disabled={busy || pin.length !== 4} onClick={() => void submit(pin)} className="flex-1 rounded-xl bg-[#146C43] py-2.5 text-sm font-bold text-white disabled:opacity-50">
                {busy ? "Checking…" : "Restore"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function OrderCard({ order, onOpen, onStatusChange, now }: { order: DashboardOrder; onOpen: () => void; onStatusChange: (order: DashboardOrder, nextStatus: OrderStatus, reason?: string) => void; now: number }) {
  const { hasPerm } = useStaff();
  const { refreshOrders } = useOrderManager();
  const items = buildItemList(order);
  const itemCount = items.reduce((total, item) => total + item.quantity, 0);
  const slideAction = getSlideAction(order, hasPerm);
  const countdown = formatCountdown(order, now);
  const isAgeWarning = getAgeMinutes(order) >= 15;
  const hasNewItems = items.some(item => (item.round || 1) > 1 || item.is_new_addition);

  let borderColor = "border-[var(--line)]";
  if (order.status === "new") borderColor = "border-l-4 border-l-[var(--red)]";
  else if (order.status === "preparing") borderColor = "border-l-4 border-l-[#F5A623]";
  else if (order.status === "ready_for_pickup" || order.status === "out_for_delivery") borderColor = "border-l-4 border-l-[#3AB757]";
  
  if (hasNewItems && order.status !== 'delivered' && order.status !== 'cancelled') {
    borderColor = "border-l-4 border-l-[#D97706] bg-[#FFF8E6] shadow-[0_2px_8px_rgba(217,119,6,0.15)]";
  }

  const handleQuickCollectCash = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const amountStr = window.prompt(`Amount Received from Rider (Expected: ₹${order.total}):`, String(order.total));
    if (!amountStr) return;
    const amount = Number(amountStr);
    if (isNaN(amount) || amount < 0) {
      alert("Invalid amount");
      return;
    }
    try {
      const res = await collectCash(order.id, order.total, amount, order.rider_id || undefined);
      if (res.success) {
        await refreshOrders();
      } else {
        alert("Failed to collect cash: " + res.error);
      }
    } catch(err) {
      alert("Error collecting cash");
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`rounded-xl border border-r-[var(--line)] border-y-[var(--line)] ${hasNewItems ? '' : 'bg-white'} p-3 shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--red)] ${borderColor}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[14px] font-extrabold tracking-[-0.2px] text-[var(--ink)] flex items-center flex-wrap gap-1.5">
            {order.order_number}
            {order.table_number && (
              <span className="px-2 py-0.5 bg-[#0A1017] text-white rounded font-black text-[11px] tracking-wide uppercase">Table {order.table_number}</span>
            )}
          </span>
          <span className="text-[11px] font-medium text-[var(--muted)] mt-1">{order.customer_name || "Guest"} · {order.customer_phone}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[14px] font-extrabold text-[var(--ink)]">{money(order.total)}</span>
          <span className={`text-[11px] font-bold ${countdown.isOverdue ? "text-[var(--danger)]" : isAgeWarning ? "text-[var(--warn)]" : "text-[var(--muted)]"}`}>
            {countdown.label}
          </span>
        </div>
      </div>

      <div className="mt-2.5 text-[12px] font-medium leading-tight text-[var(--ink)] line-clamp-2">
        {items.length > 0 ? items.map((item) => `${item.quantity}× ${item.name}`).join(", ") : order.items || "No items"}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-[#F8FAFB] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)] border border-[#E6E9EE]">
          {normalizeOrderType(order.order_type)}
        </span>
        {formatPickupTime(order.scheduled_for) && (
          <span className="rounded bg-[#FFF7E6] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#9A6700] border border-[#F3D28B]">
            ⏰ Pickup {formatPickupTime(order.scheduled_for)}
          </span>
        )}
        {hasNewItems && order.status !== 'delivered' && order.status !== 'cancelled' && (
          <span className="rounded bg-[#FEF3C7] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#D97706] border border-[#FDE68A] animate-pulse">
            🚨 UPDATED (New Items)
          </span>
        )}
        {order.order_type === "delivery" && (order.address || order.landmark || order.pincode) && (
          <span className="text-[10px] font-medium text-[var(--muted)] truncate max-w-[120px]">
            📍 {destinationFor(order)}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {order.source && <span className="rounded bg-[#F1F3F6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">{order.source}</span>}
        {Number(order.amendment_count ?? 0) > 0 && <span className="rounded bg-[#FFEFD6] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#9A5B00]">Amended ×{order.amendment_count}</span>}
        {order.cancel_requested_at && order.status !== "cancelled" && order.status !== "delivered" && (
          <span className="rounded border border-[#F5C6CB] bg-[#FDE8E8] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#B42318]">Cancel request</span>
        )}
        {isUnpaid(order) ? (
          <span className="rounded border border-[#F5C2C6] bg-[#FDE8E8] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#C0392B]">
            ⚠️ Unpaid ₹{order.total}
          </span>
        ) : order.order_type === "delivery" && (order.status === "out_for_delivery" || order.status === "delivered") && !order.is_collected && (
          <span className="rounded border border-[#B8D5F6] bg-[#EAF3FF] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#1A5FA8]">
            Collect ₹{order.total}
          </span>
        )}
        {order.order_type === "delivery" && order.status === "delivered" && order.is_collected && (
          <span className="rounded border border-[#C6ECD6] bg-[#E5F5EC] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#146C43]">
            ✓ Cash Collected
          </span>
        )}
      </div>

      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        {slideAction && (
          <SlideAction
            label={slideAction.label}
            accentColor={slideAction.accent}
            baseColor="#F8FAFB"
            textColor={slideAction.accent}
            onAcknowledge={() => onStatusChange(order, slideAction.nextStatus)}
            resetOnComplete={false}
          />
        )}
        {!slideAction && isUnpaid(order) && hasPerm("collect_cash") && (
          <MarkPaidButton
            order={order}
            className="w-full h-[40px] rounded-[10px] bg-[#E5F5EC] hover:bg-[#D1E7DD] border border-[#C6ECD6] text-[#146C43] font-black text-[13px] flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
          />
        )}
        {!slideAction && order.order_type === "delivery" && order.status === "delivered" && !order.is_collected && !isUnpaid(order) && hasPerm("collect_cash") && (
          <button
            type="button"
            onClick={handleQuickCollectCash}
            className="w-full h-[40px] rounded-[10px] bg-[#EAF3FF] hover:bg-[#DCE9FA] border border-[#B8D5F6] text-[#1A5FA8] font-black text-[13px] flex items-center justify-center gap-1.5 shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
          >
            💰 Collect Cash (₹{order.total})
          </button>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] font-medium text-[var(--muted)]">
        <span>{itemCount} item{itemCount !== 1 && "s"} · {getAgeLabel(order)} old</span>
        <div className="flex gap-2">
          {hasPerm("cancel_order") && order.status !== "cancelled" && order.status !== "delivered" && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                const reason = window.prompt("Reason for cancellation:");
                if (reason) onStatusChange(order, "cancelled", reason);
              }}
              className="text-[var(--red2)] hover:underline"
            >
              Cancel
            </button>
          )}
          {hasPerm("reopen_cancelled") && order.status === "cancelled" && (
            <UndoCancelButton
              order={order}
              className="px-3 py-1.5 rounded-[8px] bg-[#E5F5EC] text-[#146C43] font-extrabold text-[12px] hover:bg-[#D1E7DD] border border-[#C6ECD6] shadow-sm transition-colors"
            />
          )}
          {order.source === "pos" && order.status !== "cancelled" && order.status !== "delivered" && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                window.location.href = `/dashboard/pos?edit=${order.id}`;
              }}
              className="px-3 py-1.5 rounded-[8px] bg-[#EAF3FF] text-[#1A5FA8] font-extrabold text-[12px] hover:bg-[#DCE9FA] border border-[#B8D5F6] shadow-sm transition-colors"
            >
              Edit
            </button>
          )}
          {hasPerm("collect_cash") && order.order_type === "delivery" && order.status === "delivered" && !order.is_collected && !isUnpaid(order) && (
            <button
              type="button"
              onClick={handleQuickCollectCash}
              className="px-3 py-1.5 rounded-[8px] bg-[#EAF3FF] text-[#1A5FA8] font-extrabold text-[12px] hover:bg-[#DCE9FA] border border-[#B8D5F6] shadow-sm transition-colors cursor-pointer"
            >
              Collect Cash
            </button>
          )}
          {hasPerm("assign_rider") && order.status === "out_for_delivery" && order.rider_name && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStatusChange(order, "out_for_delivery", undefined);
              }}
              className="px-3 py-1.5 rounded-[8px] bg-[#F2EEFF] text-[#5B3FBF] font-extrabold text-[12px] hover:bg-[#E9E0FF] border border-[#C9B8F5] shadow-sm transition-colors"
            >
              🔄 Reassign Rider
            </button>
          )}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              printOrder(order);
            }}
            className="hover:underline"
          >
            Print
          </button>
        </div>
      </div>
    </div>
  );
}


export default function OrdersBoard() {
  const { orders, error, updateOrderStatus, isLoading } = useOrderManager();
  const [range, setRange] = useState<RangeKey>("today");
  const [selectedOrder, setSelectedOrder] = useState<DashboardOrder | null>(null);
  const [now, setNow] = useState(Date.now());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [cancelledOpen, setCancelledOpen] = useState(false);
  const [assignRiderOrder, setAssignRiderOrder] = useState<{order: DashboardOrder, reason?: string} | null>(null);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const handleStatusChange = useCallback(async (order: DashboardOrder, nextStatus: OrderStatus, reason?: string, rider?: { id: string; name: string; phone: string }) => {
    if (!canTransitionStatus(order.status, nextStatus)) {
      setStatusMessage(`Invalid update: ${statusLabels[order.status]} → ${statusLabels[nextStatus]}.`);
      return;
    }

    if (nextStatus === "out_for_delivery" && !rider && assignRiderOrder?.order.id !== order.id) {
      // Intercept and show modal instead of updating directly (both first-assign and re-assign)
      setAssignRiderOrder({ order, reason });
      return;
    }

    try {
      await updateOrderStatus(order, nextStatus, reason, rider);
      setStatusMessage(`Order ${order.order_number} updated to ${statusLabels[nextStatus]}.`);
      setSelectedOrder(null);
      setAssignRiderOrder(null);
    } catch {
      setStatusMessage(`Failed to update order ${order.order_number}.`);
    }
  }, [updateOrderStatus, assignRiderOrder]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      return inRange(order, range);
    });
  }, [orders, range]);

  const visibleOrders = filteredOrders.filter((order) => order.status !== "cancelled");
  // Shown regardless of the date filter until someone marks them paid.
  const unpaidOrders = orders.filter(isUnpaid);
  const cancelledOrders = filteredOrders.filter((order) => order.status === "cancelled");

  const totalRevenue = visibleOrders.reduce((sum, order) => sum + Number(order.total ?? 0), 0);
  const awaitingAccept = visibleOrders.filter((order) => order.status === "new").length;
  const inTheKitchen = visibleOrders.filter((order) => order.status === "preparing").length;
  const cashToCollect = visibleOrders.reduce((sum, order) => sum + Number(order.total ?? 0), 0);
  const totalOrderCount = visibleOrders.length;

  return (
    <section className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/50 p-4 rounded-[20px] border border-[#EAF0F6] backdrop-blur-md">
        <div className="flex flex-col md:flex-row md:items-center gap-3 w-full">
          <span className="text-[13px] font-bold text-[#8799AF]">Filter:</span>
          <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 w-full no-scrollbar snap-x">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={range === option.key}
                onClick={() => setRange(option.key)}
                className={`snap-start shrink-0 rounded-full px-4 py-1.5 text-[13px] font-bold transition-all duration-200 border ${
                  range === option.key
                    ? "bg-[#E23744] text-white border-[#E23744] shadow-sm"
                    : "bg-white text-[#6B7A90] border-[#EAF0F6] hover:border-[#C9D4E0] hover:text-[#0A1017]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4">
        <StatCard label="Revenue" value={money(totalRevenue)} tone="red" />
        <StatCard label="Total Orders" value={String(totalOrderCount)} tone="blue" />
        <StatCard label="Awaiting Accept" value={String(awaitingAccept)} tone="amber" />
        <StatCard label="In The Kitchen" value={String(inTheKitchen)} tone="purple" />
        <StatCard label="Cash To Collect" value={money(cashToCollect)} tone="black" />
      </div>

      {statusMessage && (
        <div className="rounded-xl border border-[#C6ECD6] bg-[#E5F5EC] px-4 py-3 text-sm font-semibold text-[#146C43] shadow-[0_4px_12px_rgba(25,135,84,0.1)]">
          {statusMessage}
        </div>
      )}

      {unpaidOrders.length > 0 && (
        <div className="rounded-xl border border-[#F5C2C6] bg-[#FDE8E8] px-4 py-3 shadow-[0_4px_12px_rgba(226,55,68,0.1)]">
          <p className="text-sm font-extrabold text-[#C0392B]">
            ⚠️ {unpaidOrders.length} delivered order{unpaidOrders.length > 1 ? "s were" : " was"} not paid. Please follow up with the customer.
          </p>
          <ul className="mt-1.5 space-y-1">
            {unpaidOrders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold text-[#7A1F1F]">
                <button type="button" onClick={() => setSelectedOrder(o)} className="font-extrabold underline">{o.order_number}</button>
                <span>{money(o.total)}</span>
                <span>{o.customer_name || "Customer"}</span>
                {o.customer_phone && <a href={`tel:+${String(o.customer_phone).replace(/\D/g, "")}`} className="underline">📞 {o.customer_phone}</a>}
                {o.rider_name && <span className="text-[#9B4545]">rider: {o.rider_name}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="rounded-xl border border-[#F5C2C6] bg-[#FDE8E8] px-4 py-3 text-sm font-semibold text-[#C0392B] shadow-[0_4px_12px_rgba(226,55,68,0.1)]">{error}</div>}

      <div className="flex xl:grid xl:grid-cols-3 gap-4 overflow-x-auto pb-6 snap-x snap-mandatory">
        {BOARD_COLUMNS.map((column) => {
          const columnOrders = visibleOrders.filter((order) => getBoardColumn(order) === column.key);
          return (
            <div key={column.key} className={`min-w-[85vw] md:min-w-[320px] xl:min-w-0 snap-center rounded-[20px] ${column.key === "preparing" ? "bg-[#EAF3FF]" : column.key === "ready" ? "bg-[#F2EEFF]" : "bg-[#EAF8EF]"} p-4 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]`}>
              <div className="mb-4 flex items-center justify-between gap-2 px-1">
                <div className="text-[17px] font-extrabold tracking-[-0.4px] text-[#0A1017]">{column.label}</div>
                <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white/80 px-2 text-[12px] font-bold text-[#6B7A90] shadow-[0_2px_4px_rgba(0,0,0,0.04)]">{columnOrders.length}</span>
              </div>

              <div className="space-y-4 min-h-[150px]">
                {isLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <div key={`skel-${i}`} className="h-32 rounded-[16px] bg-white/40 p-4 shadow-sm animate-pulse border border-white/50">
                      <div className="h-4 w-1/2 bg-black/5 rounded mb-3"></div>
                      <div className="h-3 w-3/4 bg-black/5 rounded mb-2"></div>
                      <div className="h-3 w-1/3 bg-black/5 rounded mb-4"></div>
                      <div className="h-10 w-full bg-black/5 rounded-xl"></div>
                    </div>
                  ))
                ) : (
                  <AnimatePresence mode="popLayout">
                    {columnOrders.length > 0 ? (
                      columnOrders.map((order) => (
                        <motion.div
                          key={order.id}
                          layout
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                          transition={{ type: "spring", stiffness: 350, damping: 25 }}
                        >
                          <OrderCard order={order} onOpen={() => setSelectedOrder(order)} onStatusChange={handleStatusChange} now={now} />
                        </motion.div>
                      ))
                    ) : (
                      <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="rounded-[16px] border border-dashed border-[#C9D4E0] bg-white/50 px-4 py-10 text-center flex flex-col items-center justify-center gap-2"
                      >
                        <div className="text-[24px] opacity-40">🍽️</div>
                        <span className="text-[13px] font-bold text-[#8799AF]">No orders here</span>
                        <span className="text-[11px] font-semibold text-[#A1B2C6]">When orders arrive, they'll show up here.</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-[14px] border border-[var(--line)] bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => setCancelledOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[14px] font-bold text-[var(--muted)]"
        >
          <span>Cancelled</span>
          <span>{cancelledOrders.length} {cancelledOpen ? "▴" : "▾"}</span>
        </button>
        {cancelledOpen && (
          <div className="border-t border-[var(--line)] p-3">
            {cancelledOrders.length > 0 ? (
              <div className="space-y-3">
                {cancelledOrders.map((order) => (
                  <OrderCard key={order.id} order={order} onOpen={() => setSelectedOrder(order)} onStatusChange={handleStatusChange} now={now} />
                ))}
              </div>
            ) : (
              <div className="rounded-[12px] border border-dashed border-[var(--line)] bg-[#F8FAFB] px-3 py-8 text-center text-[12px] text-[var(--muted)]">None</div>
            )}
          </div>
        )}
      </div>

      {selectedOrder && (
        <OrderDetails
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          now={now}
          onStatusChange={handleStatusChange}
        />
      )}

      {assignRiderOrder && (
        <AssignRiderModal
          orderNumber={assignRiderOrder.order.order_number}
          onAssign={(rider) => handleStatusChange(
            assignRiderOrder.order, 
            rider ? "out_for_delivery" : "ready_for_pickup", 
            assignRiderOrder.reason, 
            rider
          )}
          onCancel={() => setAssignRiderOrder(null)}
        />
      )}

    </section>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "red" | "blue" | "purple" | "amber" | "black" }) {
  const styles = {
    red: { text: "text-[#E23744]" },
    blue: { text: "text-[#1A5FA8]" },
    purple: { text: "text-[#5B3FBF]" },
    amber: { text: "text-[#B8730B]" },
    black: { text: "text-[#0A1017]" },
  }[tone];

  return (
    <div className={`relative overflow-hidden rounded-[16px] border border-[#EAF0F6] bg-white p-5 transition-transform duration-300 hover:-translate-y-1 hover:shadow-sm`}>
      <div className="relative z-10">
        <span className="mb-2 block text-[11px] font-extrabold uppercase tracking-[1px] text-[#8799AF]">{label}</span>
        <b className={`block text-[36px] font-extrabold leading-none tracking-[-1px] ${styles.text}`}>{value}</b>
      </div>
    </div>
  );
}
