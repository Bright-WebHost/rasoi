"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useOrderManager } from "../../OrderManagerProvider";
import { formatDistanceToNow } from "date-fns";
import { fetchRiders, Rider } from "./actions";

export default function DispatcherBoard() {
  const { orders, refreshOrders, updateOrderStatus } = useOrderManager();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  useEffect(() => {
    loadRiders();
  }, []);

  async function loadRiders() {
    setLoading(true);
    const result = await fetchRiders();
    if (result.success && result.riders) {
      setRiders(result.riders.filter(r => r.is_active));
    }
    setLoading(false);
  }

  const dispatchableOrders = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    return orders
      .filter((o) => {
        const createdAt = new Date(o.created_at).getTime();
        return (o.status === "ready_for_pickup" || o.status === "out_for_delivery") && createdAt >= todayStartMs;
      })
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [orders]);

  const handleAssignRider = async (orderId: string, riderId: string) => {
    setAssigningId(orderId);
    try {
      const rider = riders.find(r => r.id === riderId);
      if (!rider) return;

      const order = orders.find(o => o.id === orderId);
      if (order) {
        await updateOrderStatus(order, order.status, undefined, {
          id: rider.id,
          name: rider.name,
          phone: rider.whatsapp_number
        });
      }
    } catch (e: any) {
      alert("Failed to assign rider: " + e.message);
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Gamification / Stats Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm mb-6">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-[#0A1017] mb-1">Delivery Dispatch</h2>
          <p className="text-[#8799AF] text-sm font-semibold">
            {dispatchableOrders.length === 0 ? "All clear! Excellent dispatching! 🎯" : `${dispatchableOrders.length} orders waiting for riders. Keep 'em moving! 🚀`}
          </p>
        </div>
        <div className="flex gap-3 text-sm font-bold w-full md:w-auto">
          <div className="flex-1 md:flex-none px-4 py-3 bg-[#F8FAFB] text-[#0A1017] rounded-xl border border-[#EAF0F6] flex flex-col items-center justify-center">
            <span className="text-[#8799AF] text-[10px] uppercase tracking-wider mb-1">Active Riders</span>
            <span className="text-2xl text-blue-600 font-black">{riders.length}</span>
          </div>
          <button onClick={loadRiders} className="px-4 py-3 bg-white text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50 transition-colors flex items-center justify-center font-bold shadow-sm">
            Refresh Riders
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {dispatchableOrders.map((order) => {
          const timeAgo = formatDistanceToNow(new Date(order.updated_at), { addSuffix: true });
          const isReady = order.status === "ready_for_pickup";

          return (
            <div
              key={order.id}
              className={`flex flex-col bg-white border ${isReady ? 'border-yellow-400 shadow-md shadow-yellow-50' : 'border-blue-300 shadow-md shadow-blue-50'} rounded-xl overflow-hidden transition-all`}
            >
              <div className={`p-4 border-b flex items-center justify-between ${isReady ? 'bg-yellow-50' : 'bg-blue-50'}`}>
                <span className="font-mono text-xl font-black tracking-tight text-gray-900">
                  {order.order_number}
                </span>
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${isReady ? 'bg-yellow-200 text-yellow-800' : 'bg-blue-200 text-blue-800'}`}>
                  {isReady ? 'READY' : 'OUT FOR DELIVERY'}
                </span>
              </div>

              <div className="p-4 flex-1 space-y-3 bg-white">
                <div className="text-sm">
                  <p className="font-bold text-gray-900">{order.customer_name || 'Customer'}</p>
                  <p className="text-gray-500">{order.customer_phone}</p>
                </div>
                {order.address && (
                  <div className="text-sm p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <p className="text-gray-700 leading-snug">{order.address}</p>
                    {order.landmark && <p className="text-gray-500 mt-1 italic">Near: {order.landmark}</p>}
                  </div>
                )}

                <div className="text-xs text-gray-400 font-medium">Last updated {timeAgo}</div>
              </div>

              {isReady && (
                <div className="p-3 bg-gray-50 border-t border-gray-100">
                  {loading ? (
                    <div className="text-sm text-gray-500 text-center py-2 animate-pulse">Loading riders...</div>
                  ) : riders.length > 0 ? (
                    <select
                      className="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm font-medium shadow-sm outline-none focus:border-blue-500 disabled:opacity-50"
                      value=""
                      onChange={(e) => handleAssignRider(order.id, e.target.value)}
                      disabled={assigningId === order.id}
                    >
                      <option value="" disabled>{assigningId === order.id ? 'Assigning...' : 'Assign Rider...'}</option>
                      {riders.map(r => (
                        <option key={r.id} value={r.id}>{r.name} ({r.pending_cash > 0 ? `₹${r.pending_cash} due` : 'Clear'})</option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-sm text-red-500 text-center py-2">No active riders available</div>
                  )}
                </div>
              )}

              {!isReady && order.rider_name && (
                <div className="p-3 bg-blue-50 border-t border-blue-100 flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-xs text-blue-600 font-bold uppercase">Assigned To</span>
                    <span className="text-sm font-semibold text-blue-900">{order.rider_name}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {dispatchableOrders.length === 0 && (
          <div className="col-span-full py-16 flex flex-col items-center justify-center text-gray-400 bg-white border border-gray-100 border-dashed rounded-2xl">
            <div className="w-12 h-12 mb-3 opacity-20 text-4xl text-center flex items-center justify-center">🛵</div>
            <p className="text-base font-medium text-gray-500">No orders to dispatch</p>
          </div>
        )}
      </div>
    </div>
  );
}
