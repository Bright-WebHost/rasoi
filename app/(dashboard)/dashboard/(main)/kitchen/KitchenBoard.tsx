"use client";

import { formatPickupTime } from "@/lib/orders/format";
import React, { useMemo, useEffect, useRef } from "react";
import { useOrderManager } from "../../OrderManagerProvider";
import { formatDistanceToNow } from "date-fns";
import { useStaff } from "@/components/providers/StaffProvider";
import SlideButton from "@/components/ui/SlideButton";

export default function KitchenBoard() {
  const { orders, isLoading, error } = useOrderManager();
  const { hasPerm } = useStaff();
  const seenOrderIds = useRef(new Set<string>());

  // Kitchen only sees "preparing" orders
  const preparingOrders = useMemo(() => {
    return orders
      .filter((o) => o.status === "preparing")
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [orders]);

  useEffect(() => {
    let hasNew = false;
    preparingOrders.forEach(order => {
      if (!seenOrderIds.current.has(order.id)) {
        hasNew = true;
        seenOrderIds.current.add(order.id);
      }
    });

    if (hasNew) {
      try {
        const audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
        audio.play().catch(console.warn);
      } catch (err) {
        console.warn("Audio play failed", err);
      }
    }
  }, [preparingOrders]);

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] gap-4">
        <div className="text-red-500 font-medium">Failed to load orders: {error}</div>
      </div>
    );
  }

  const completedCount = orders.filter(o => o.status === 'ready_for_pickup' || o.status === 'delivered' || o.status === 'out_for_delivery').length;

  return (
    <div className="space-y-6 min-h-[calc(100vh-100px)] bg-[#0A1017] p-2 md:p-6 rounded-2xl md:rounded-[32px] text-white shadow-inner">
      {/* Gamification Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-[#131C27] p-5 rounded-2xl border border-[#1C2633] shadow-lg">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white mb-1">Kitchen Display</h1>
          <p className="text-[#8799AF] text-sm font-semibold">
            {preparingOrders.length > 5 ? "It's getting busy! Keep it up! 🔥" : "We're on pace. Good job! 👍"}
          </p>
        </div>
        <div className="flex gap-3 text-sm font-bold w-full md:w-auto">
          <div className="flex-1 md:flex-none px-4 py-3 bg-[#1C2633] text-white rounded-xl border border-[#233142] flex flex-col items-center justify-center">
            <span className="text-[#8799AF] text-[10px] uppercase tracking-wider mb-1">Preparing</span>
            <span className="text-2xl text-yellow-400 font-black">{preparingOrders.length}</span>
          </div>
          <div className="flex-1 md:flex-none px-4 py-3 bg-[#1C2633] text-white rounded-xl border border-[#233142] flex flex-col items-center justify-center">
            <span className="text-[#8799AF] text-[10px] uppercase tracking-wider mb-1">Cleared Today</span>
            <span className="text-2xl text-emerald-400 font-black">{completedCount}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {preparingOrders.map((order) => {
          const timeAgo = formatDistanceToNow(new Date(order.created_at), { addSuffix: true });
          const ageMs = new Date().getTime() - new Date(order.created_at).getTime();
          const isUrgent = ageMs > 15 * 60 * 1000;
          const isNew = ageMs < 60 * 1000;

          // High contrast neon styles for dark mode
          let cardBg = "bg-[#131C27]";
          let borderClass = "border-[#1C2633]";
          let timerColor = "text-[#8799AF]";

          if (isUrgent) {
            cardBg = "bg-[#2A1012]";
            borderClass = "border-[#E23744]";
            timerColor = "text-[#E23744]";
          } else if (isNew) {
            cardBg = "bg-[#0E2018]";
            borderClass = "border-[#25D366]";
            timerColor = "text-[#25D366]";
          }

          return (
            <div 
              key={order.id} 
              className={`flex flex-col border-2 ${cardBg} ${borderClass} rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all duration-300 relative`}
            >
              {isNew && <div className="absolute top-0 right-0 w-2 h-full bg-[#25D366] animate-pulse"></div>}
              {isUrgent && <div className="absolute top-0 right-0 w-2 h-full bg-[#E23744] animate-pulse"></div>}

              {/* Order Header */}
              <div className={`p-4 border-b ${isUrgent ? 'border-[#E23744]/30' : isNew ? 'border-[#25D366]/30' : 'border-[#1C2633]'} flex justify-between items-center`}>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-3xl font-black tracking-tighter text-white">
                    {order.order_number}
                  </span>
                  <span className={`text-[11px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider
                    ${order.order_type === 'pos' ? 'bg-[#9333EA]/20 text-[#D8B4FE]' : 
                      order.order_type === 'takeaway' ? 'bg-[#EA580C]/20 text-[#FDBA74]' : 
                      'bg-[#2563EB]/20 text-[#BFDBFE]'}`}>
                    {order.order_type}
                  </span>
                  {formatPickupTime(order.scheduled_for) && (
                    <span className="text-[11px] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider bg-[#F59E0B]/20 text-[#FCD34D]">
                      ⏰ {formatPickupTime(order.scheduled_for)}
                    </span>
                  )}
                </div>
                <div className={`text-sm font-bold ${timerColor} flex items-center gap-1`}>
                  🕒 {timeAgo}
                </div>
              </div>

              {/* Order Items */}
              <div className="p-5 flex-1 bg-black/20">
                {order.table_number && (
                  <div className="mb-4 inline-flex items-center gap-2 bg-[#233142] text-white px-3 py-1.5 rounded-lg border border-[#2B3B4E]">
                    <span className="text-[#8799AF]">🍽️ Table</span>
                    <span className="font-black text-lg">{order.table_number}</span>
                  </div>
                )}
                <ul className="space-y-4">
                  {(order.items_json || []).map((item: any, idx: number) => (
                    <li key={idx} className="flex gap-4 items-start">
                      <span className={`font-black min-w-[36px] h-9 flex items-center justify-center rounded-lg text-lg
                        ${isUrgent ? 'bg-[#E23744] text-white' : isNew ? 'bg-[#25D366] text-[#0E2018]' : 'bg-[#233142] text-white'}`}>
                        {item.quantity}
                      </span>
                      <span className="font-bold text-xl leading-tight text-white/90 pt-1 tracking-tight">{item.item_name}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action Button */}
              {hasPerm("mark_ready") && (
                <div className="p-4 bg-[#131C27] border-t border-[#1C2633]">
                  <SlideButton 
                    text="Slide when Ready" 
                    successText="Ready!"
                    onSuccess={async () => {
                      try {
                        const { updateOrderInDb } = await import("@/lib/orders/actions");
                        await updateOrderInDb(order.id, { status: "ready_for_pickup" });
                      } catch (e) {
                        console.error(e);
                      }
                    }} 
                  />
                </div>
              )}
            </div>
          );
        })}

        {preparingOrders.length === 0 && (
          <div className="w-full py-24 flex flex-col items-center justify-center text-gray-400 bg-white border border-gray-200 border-dashed rounded-2xl">
            <div className="w-16 h-16 mb-4 opacity-20 text-4xl flex items-center justify-center">🍳</div>
            <p className="text-xl font-medium text-gray-500">No active orders</p>
            <p className="text-md">Kitchen is caught up!</p>
          </div>
        )}
      </div>

      {/* History Section */}
      <div className="mt-12 space-y-4">
        <h2 className="text-xl font-bold text-[#8799AF] border-b border-[#1C2633] pb-2">Recent History</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders
            .filter((o) => ["ready_for_pickup", "out_for_delivery", "delivered", "cancelled"].includes(o.status))
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
            .slice(0, 12)
            .map(order => {
              const itemsList = Array.isArray(order.items_json) 
                ? order.items_json.map((item: any) => `${item.quantity}× ${item.item_name || item.name}`).join(", ")
                : order.items || "No items";

              return (
                <div key={order.id} className="p-4 bg-[#131C27] border border-[#1C2633] rounded-xl flex flex-col justify-between opacity-80 hover:opacity-100 transition-opacity">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="font-mono font-black text-lg text-white">{order.order_number}</div>
                      <div className="text-xs text-[#8799AF] uppercase font-bold tracking-wider">{order.status.replace(/_/g, " ")}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-[#8799AF] font-medium">{formatDistanceToNow(new Date(order.updated_at), { addSuffix: true })}</div>
                    </div>
                  </div>
                  
                  <div className="mt-2 text-sm font-medium text-white/80 line-clamp-3 bg-black/20 p-2.5 rounded-lg border border-[#1C2633]">
                    {itemsList}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
