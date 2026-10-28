"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useOrderManager } from "./OrderManagerProvider";
import { useStaff } from "@/components/providers/StaffProvider";
import { X, Bike } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

import { Rider } from "@/app/(dashboard)/dashboard/(main)/riders/actions";

export default function GlobalAssignRiderPopup() {
  const { orders, updateOrderStatus } = useOrderManager();
  const { hasPerm } = useStaff();
  const [riders, setRiders] = useState<Rider[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);
  const [dismissedOrderIds, setDismissedOrderIds] = useState<Set<string>>(new Set());

  const canViewRiders = hasPerm("view_riders");

  useEffect(() => {
    // fetchRiders requires view_riders; other roles (e.g. waiter) would only get a Forbidden error.
    if (!canViewRiders) return;
    async function getRiders() {
      const { fetchRiders } = await import("@/app/(dashboard)/dashboard/(main)/riders/actions");
      const result = await fetchRiders();
      if (result.success && result.riders) {
        setRiders(result.riders.filter(r => r.is_active));
      }
    }
    getRiders();
  }, [canViewRiders]);

  // Only Admin or Dispatcher can assign riders
  const canAssignRider = hasPerm("assign_rider") || hasPerm("view_orders_full");

  // Find the first unassigned delivery order that is ready for pickup and hasn't been dismissed
  const pendingAssignmentOrder = useMemo(() => {
    if (!canAssignRider) return null;
    return orders.find(o =>
      o.status === "ready_for_pickup" &&
      o.order_type === "delivery" &&
      !o.rider_id &&
      !dismissedOrderIds.has(o.id)
    );
  }, [orders, canAssignRider, dismissedOrderIds]);

  if (!pendingAssignmentOrder) return null;

  const handleAssignRider = async (riderId: string) => {
    setIsAssigning(true);
    try {
      const rider = riders.find(r => r.id === riderId);
      if (!rider) return;

      await updateOrderStatus(pendingAssignmentOrder, "out_for_delivery", undefined, {
        id: rider.id,
        name: rider.name,
        phone: rider.whatsapp_number
      });

    } catch (e: any) {
      alert("Failed to assign rider: " + e.message);
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="bg-blue-600 p-6 text-white relative">
          <button
            onClick={() => setDismissedOrderIds(prev => new Set(prev).add(pendingAssignmentOrder.id))}
            className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full transition-colors"
          >
            <X size={20} />
          </button>

          <div className="flex items-center gap-3 mb-2">
            <div className="bg-white/20 p-2 rounded-full">
              <Bike size={24} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold">Assign Rider</h2>
          </div>
          <p className="text-blue-100">
            Order <span className="font-bold text-white">#{pendingAssignmentOrder.order_number}</span> is ready for delivery.
          </p>
        </div>

        {/* Customer Details */}
        <div className="p-6 border-b border-gray-100 bg-gray-50">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-500">Customer</span>
            <span className="font-bold text-gray-900">{pendingAssignmentOrder.customer_name || "Guest"}</span>
          </div>
          <div className="flex justify-between items-start">
            <span className="text-sm font-medium text-gray-500 mt-1">Address</span>
            <span className="text-sm text-gray-800 text-right max-w-[200px] leading-tight">
              {[pendingAssignmentOrder.address, pendingAssignmentOrder.landmark, pendingAssignmentOrder.city, pendingAssignmentOrder.pincode].filter(Boolean).join(", ") || "No address provided"}
            </span>
          </div>
        </div>

        {/* Rider List */}
        <div className="p-6 max-h-[400px] overflow-y-auto bg-white">
          <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Available Riders</h3>

          {riders.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p>No active riders found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {riders.map((rider) => (
                <button
                  key={rider.id}
                  onClick={() => handleAssignRider(rider.id)}
                  disabled={isAssigning}
                  className="w-full flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:border-blue-500 hover:shadow-md transition-all group disabled:opacity-50"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                      <Bike size={20} className="text-gray-500 group-hover:text-blue-600 transition-colors" />
                    </div>
                    <div className="text-left">
                      <div className="font-bold text-gray-900">{rider.name}</div>
                      <div className="text-xs text-gray-500">{rider.whatsapp_number}</div>
                    </div>
                  </div>
                  <div className="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                    {rider.is_active ? "Available" : "Offline"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
