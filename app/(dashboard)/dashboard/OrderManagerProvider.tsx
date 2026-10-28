"use client";

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { DashboardOrder, OrderStatus } from "@/lib/orders/queries";
import { notifyStatusWebhook, notifyOrderCreatedWebhook, notifyRiderText } from "@/lib/server/notify";
import { useStaff } from "@/components/providers/StaffProvider";
import { isAuthError, redirectIfSessionExpired } from "@/lib/auth/session-expired";

interface OrderManagerContextType {
  orders: DashboardOrder[];
  queuedNewOrders: DashboardOrder[];
  acknowledgeOrder: (orderId: string, isUpdate?: boolean) => void;
  updateOrderStatus: (order: DashboardOrder, nextStatus: OrderStatus, reason?: string, rider?: { id: string; name: string; phone: string }, options?: { pin?: string; prepTime?: number }) => Promise<void>;
  autoPrint: boolean;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  isRealtimeConnected: boolean;
  refreshOrders: () => Promise<void>;
  toggleSound: () => void;
  soundEnabled: boolean;
}

const OrderManagerContext = createContext<OrderManagerContextType | null>(null);

export const useOrderManager = () => {
  const ctx = useContext(OrderManagerContext);
  if (!ctx) throw new Error("useOrderManager must be used within OrderManagerProvider");
  return ctx;
};

export function OrderManagerProvider({ children, initialOrders = [], autoPrint = false }: { children: React.ReactNode, initialOrders?: DashboardOrder[], autoPrint?: boolean }) {
  const [orders, setOrders] = useState<DashboardOrder[]>(initialOrders);
  const [queuedNewOrders, setQueuedNewOrders] = useState<DashboardOrder[]>([]);
  const [isLoading, setIsLoading] = useState(initialOrders.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { hasPerm } = useStaff();

  useEffect(() => {
    setLastUpdated(new Date());
  }, []);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("pabbas_sound_enabled") !== "false";
    }
    return true;
  });

  const supabase = useRef(createClient());
  const acknowledgedIds = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingUpdates = useRef<Set<string>>(new Set());
  const ordersRef = useRef<DashboardOrder[]>(initialOrders);

  useEffect(() => {
    const unlock = () => {
      if (audioRef.current) {
        audioRef.current.play().then(() => {
          audioRef.current?.pause();
          document.removeEventListener('click', unlock);
          document.removeEventListener('keydown', unlock);
        }).catch(() => { });
      }
    };
    document.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);


  useEffect(() => {
    if (typeof window !== "undefined" && !audioRef.current) {

    }
  }, []);

  const stopSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, []);

  const startSound = useCallback(() => {
    if (!soundEnabled || !audioRef.current) return;
    try {
      audioRef.current.play().catch(e => console.warn("Audio play blocked", e));
    } catch (err) {
      console.warn("Sound play failed", err);
    }
  }, [soundEnabled]);

  const toggleSound = useCallback(() => {
    setSoundEnabled(prev => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("pabbas_sound_enabled", String(next));
      }
      if (!next) {
        stopSound();
      } else {
        // Unlock audio on user interaction
        if (audioRef.current) {
          audioRef.current.play().then(() => {
            audioRef.current?.pause();
            audioRef.current!.currentTime = 0;
            // If there's already queued orders, play it for real
            if (queuedNewOrders.length > 0) {
              audioRef.current?.play().catch(() => { });
            }
          }).catch(e => console.warn("Audio unlock failed", e));
        }
      }
      return next;
    });
  }, [stopSound, queuedNewOrders.length]);

  useEffect(() => {
    if (queuedNewOrders.length > 0 && soundEnabled) {
      startSound();
    } else {
      stopSound();
    }
  }, [queuedNewOrders.length, soundEnabled, startSound, stopSound]);

  // Initial Sync & Polling
  const refreshOrders = useCallback(async () => {
    try {
      const { data, error: fetchErr } = await supabase.current
        .from("orders")
        .select("id, order_number, customer_phone, customer_name, items, total, status, order_type, source, address, landmark, city, pincode, table_number, confirmed_at, amend_window_until, amended_at, amendment_count, original_items, cancel_reason, cancelled_by, cancelled_at, cancel_requested_at, created_at, updated_at, items_json, rider_id, rider_name, rider_phone, collected_amount, is_collected, scheduled_for, payment_status")
        .order("created_at", { ascending: false })
        .limit(100);

      if (fetchErr) throw fetchErr;

      const latestOrders = (data ?? []).map((o: any) => {
        // HACK: Prevent aggressive UI bouncing by preserving the optimistic state if an update is in-flight
        if (pendingUpdates.current.has(o.id)) {
          const existing = ordersRef.current.find(curr => curr.id === o.id);
          if (existing) return existing;
        }
        return o;
      }) as DashboardOrder[];
      setOrders(latestOrders);
      ordersRef.current = latestOrders;
      setLastUpdated(new Date());
      setError(null);

      // Detect unacknowledged new orders (excluding POS orders, as staff created them)
      const unackNew = latestOrders.filter(o => {
        if (o.source === 'pos') return false;

        // It's also unacknowledged if it's an existing order (e.g. preparing) BUT has new additions
        if (Array.isArray(o.items_json) && o.items_json.some((i: any) => i.is_new_addition)) {
          if (hasPerm("mark_ready") && !hasPerm("view_orders_full") && o.status !== 'preparing') return false;
          return true;
        }

        if (acknowledgedIds.current.has(o.id)) return false;

        const isKitchenOnly = hasPerm("mark_ready") && !hasPerm("view_orders_full");
        const isAdminOrCounter = hasPerm("view_orders_full");

        if (isAdminOrCounter && o.status === 'new') return true;

        return false;
      });

      setQueuedNewOrders(prev => {
        // Keep only alerts that still need attention (the order wasn't deleted, accepted elsewhere, etc.)
        const stillWaiting = new Set(unackNew.map(n => n.id));
        const kept = prev.filter(p => stillWaiting.has(p.id));
        const keptIds = new Set(kept.map(p => p.id));
        const toAdd = unackNew.filter(n => !keptIds.has(n.id));
        if (toAdd.length === 0 && kept.length === prev.length) return prev;
        return [...kept, ...toAdd];
      });

    } catch (err: any) {
      if (isAuthError(err) && (await redirectIfSessionExpired())) return;
      console.error("Refresh orders failed", err);
      setError("Orders could not be refreshed. Showing the last known data.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load effect to queue any existing new orders
  useEffect(() => {
    if (initialOrders.length > 0) {
      const unackNew = initialOrders.filter(o => {
        if (o.source === 'pos') return false;

        if (Array.isArray(o.items_json) && o.items_json.some((i: any) => i.is_new_addition)) {
          if (hasPerm("mark_ready") && !hasPerm("view_orders_full") && o.status !== 'preparing') return false;
          return true;
        }

        if (acknowledgedIds.current.has(o.id)) return false;

        const isKitchenOnly = hasPerm("mark_ready") && !hasPerm("view_orders_full");
        const isAdminOrCounter = hasPerm("view_orders_full");

        if (isAdminOrCounter && o.status === 'new') return true;
        return false;
      });
      if (unackNew.length > 0) {
        setQueuedNewOrders(unackNew);
      }
    }
  }, [initialOrders]);

  // Set up realtime and polling
  useEffect(() => {
    let active = true;
    void refreshOrders();

    const channel = supabase.current.channel("pabbas-orders-live-global");
    channel.on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
      if (active) void refreshOrders();
    });
    channel.on("broadcast", { event: "orders_updated" }, () => {
      if (active) void refreshOrders();
    });

    channel.subscribe((status) => {
      if (active) {
        setIsRealtimeConnected(status === 'SUBSCRIBED');
      }
    });

    // Fallback polling (aggressive, every 5s since realtime is not active for this table)
    const poller = window.setInterval(() => {
      if (active) void refreshOrders();
    }, 5000);

    return () => {
      active = false;
      stopSound();
      window.clearInterval(poller);
      supabase.current.removeChannel(channel);
    };
  }, [refreshOrders, stopSound]);

  const acknowledgeOrder = useCallback((orderId: string, isUpdate?: boolean) => {
    if (!isUpdate) {
      acknowledgedIds.current.add(orderId);
    }
    setQueuedNewOrders(prev => prev.filter(o => o.id !== orderId));
  }, []);

  const updateOrderStatus = useCallback(async (order: DashboardOrder, nextStatus: OrderStatus, reason?: string, rider?: { id: string; name: string; phone: string }, options?: { pin?: string; prepTime?: number }) => {
    // Optimistic update
    pendingUpdates.current.add(order.id);
    const previousStatus = order.status;
    const nextOrderState = { ...order, status: nextStatus, rider_id: rider?.id, rider_name: rider?.name, rider_phone: rider?.phone };
    // Restoring a cancelled order waits for the passcode check instead of updating optimistically.
    if (order.status !== "cancelled") {
      setOrders(current => {
        const updated = current.map(item => item.id === order.id ? nextOrderState : item);
        ordersRef.current = updated;
        return updated;
      });
    }

    // Also remove from queue if it was in it
    acknowledgeOrder(order.id);

    const updates: any = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    if (rider) {
      updates.rider_id = rider.id;
      updates.rider_name = rider.name;
      updates.rider_phone = rider.phone;
    }

    if (nextStatus === "cancelled") {
      updates.cancelled_by = "staff";
      updates.cancelled_at = new Date().toISOString();
      updates.cancel_reason = `${order.status}|${reason || "staff_cancelled"}`;
    } else if (order.status === "cancelled") {
      updates.cancelled_by = null;
      updates.cancelled_at = null;
      updates.cancel_reason = null;
    }

    try {
      const { updateOrderInDb, reopenCancelledOrder } = await import("@/lib/orders/actions");
      const result = order.status === "cancelled" && nextStatus !== "cancelled"
        ? await reopenCancelledOrder(order.id, nextStatus, options?.pin ?? "")
        : await updateOrderInDb(order.id, updates);
      if (!result.success) throw new Error(result.error || "Failed to update order");

      // Trigger refresh but don't await it to keep UI responsive
      refreshOrders().catch(console.error);

      if (autoPrint && previousStatus === "new" && nextStatus === "preparing") {
        import("@/lib/print/bill")
          .then(({ printOrderBill }) => printOrderBill(order.id, { auto: true }))
          .catch(console.error);
      }

      // Trigger Webhook
      try {
        if (previousStatus === 'new' && nextStatus === 'preparing' && order.source !== 'pos') {
          // Send invoice + order confirmation ONLY when admin accepts
          const itemsArr = Array.isArray(order.items_json) ? order.items_json : [];
          notifyOrderCreatedWebhook({
            order_number: order.order_number,
            customer_phone: order.customer_phone,
            customer_name: order.customer_name,
            order_type: order.order_type,
            items: itemsArr.map((item: any) => ({
              item_name: item.item_name,
              quantity: item.quantity,
              unit_price: item.unit_price,
            })),
            total: Number(order.total),
            prep_time: options?.prepTime || 20
          }).catch(console.error);
        }

        // When a rider is first assigned:
        // 1. Send rider direct message with Collected / Unpaid buttons (no accept step)
        // 2. Send customer message with assigned rider name and phone
        if (updates.rider_name && !order.rider_name) {
          const addr = [order.address, order.landmark, order.city, order.pincode].filter(Boolean).join(", ") || "No address provided";
          const riderMessage = `🚚 *Delivery for you — Pabbas*\n\n*Order:* ${order.order_number}\n*Customer:* ${order.customer_name || "Guest"}\n*Address:* ${addr}\n\n*Collect: Rs.${order.total}*\n\nAfter delivering, tap the button below to confirm.`;

          notifyStatusWebhook(order.order_number, "rider_assigned", undefined, {
            target: "rider",
            rider_phone: updates.rider_phone,
            rider_name: updates.rider_name,
            whatsapp_message_text: riderMessage,
            interactive_buttons: ["Collected", "Unpaid"],
            total: order.total
          }).catch(console.error);

          const customerMsg = `Great news! Your order ${order.order_number} is on its way! 🛵\n\nYour delivery partner: ${updates.rider_name} (${updates.rider_phone})\n\nPlease keep Rs.${order.total} in cash ready.`;
          notifyStatusWebhook(order.order_number, "out_for_delivery", undefined, {
            total: order.total,
            order_type: order.order_type,
            customer_name: order.customer_name || "Guest",
            customer_phone: order.customer_phone,
            rider_name: updates.rider_name,
            rider_phone: updates.rider_phone,
            custom_message: customerMsg,
            whatsapp_message_text: customerMsg,
          }).catch(console.error);
        }

        // When a rider is RE-assigned (different rider):
        // 1. Send new rider the delivery message
        // 2. Notify customer of new rider details with apology
        if (updates.rider_name && order.rider_name && updates.rider_name !== order.rider_name) {
          if (order.rider_phone) {
            notifyRiderText(order.rider_phone, `Order ${order.order_number} has been reassigned to another rider. No action needed from you.`).catch(console.error);
          }
          const addr = [order.address, order.landmark, order.city, order.pincode].filter(Boolean).join(", ") || "No address provided";
          const riderMessage = `🚚 *Delivery for you — Pabbas*\n\n*Order:* ${order.order_number}\n*Customer:* ${order.customer_name || "Guest"}\n*Address:* ${addr}\n\n*Collect: Rs.${order.total}*\n\nAfter delivering, tap the button below to confirm.`;

          notifyStatusWebhook(order.order_number, "rider_assigned", undefined, {
            target: "rider",
            rider_phone: updates.rider_phone,
            rider_name: updates.rider_name,
            whatsapp_message_text: riderMessage,
            interactive_buttons: ["Collected", "Unpaid"],
            total: order.total
          }).catch(console.error);

          const customerMsg = `Hi ${order.customer_name || "there"}! We've updated your delivery partner for order ${order.order_number}. Sorry for any inconvenience!\n\nYour new delivery partner is ${updates.rider_name} (${updates.rider_phone}). Your order is on its way!`;
          notifyStatusWebhook(order.order_number, "out_for_delivery", undefined, {
            total: order.total,
            order_type: order.order_type,
            customer_name: order.customer_name || "Guest",
            customer_phone: order.customer_phone,
            rider_name: updates.rider_name,
            rider_phone: updates.rider_phone,
            custom_message: customerMsg,
            whatsapp_message_text: customerMsg,
          }).catch(console.error);
        }

        // When cancelled, send sorry message with reason to customer (WhatsApp orders only)
        if (nextStatus === "cancelled" && order.source !== "pos" && order.customer_phone) {
          const rawReason = reason || "";
          // Strip the prepended status prefix ("new|Kitchen full" -> "Kitchen full")
          const cleanReason = rawReason.includes("|") ? rawReason.split("|").slice(1).join("|") : rawReason;
          const restaurantPhone = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "";
          const phoneDisplay = restaurantPhone ? `+${restaurantPhone.replace(/\D/g, "")}` : "our number";
          const cancelMsg = `Hi ${order.customer_name || "there"}, we are very sorry - we cannot take your order ${order.order_number} right now.${cleanReason ? `\n\nReason: ${cleanReason}` : ""}\n\nNothing has been charged. Please call us on ${phoneDisplay} and we will help you sort it out.`;
          notifyStatusWebhook(order.order_number, "cancelled", updates.cancel_reason, {
            total: order.total,
            order_type: order.order_type,
            customer_name: order.customer_name || "Guest",
            customer_phone: order.customer_phone,
            rider_phone: order.customer_phone, // send to customer
            custom_message: cancelMsg,
            whatsapp_message_text: cancelMsg,
          }).catch(console.error);
        }
        // NOTE: No message is sent for 'delivered' status (cost reduction).
        // The customer already got the invoice on accept, and the rider flow handles confirmation.
      } catch (notifyErr) {
        console.error("Webhook integration error:", notifyErr);
      }
    } catch (err) {
      // Revert optimistic
      setOrders(current => {
        const reverted = current.map(item => item.id === order.id ? { ...item, status: previousStatus } : item);
        ordersRef.current = reverted as DashboardOrder[];
        return reverted as DashboardOrder[];
      });
      throw err;
    } finally {
      // Remove from pending updates so subsequent polls can take over
      pendingUpdates.current.delete(order.id);
    }
  }, [acknowledgeOrder, refreshOrders, autoPrint]);

  return (
    <OrderManagerContext.Provider value={{
      orders,
      queuedNewOrders,
      acknowledgeOrder,
      updateOrderStatus,
      autoPrint,
      isLoading,
      error,
      lastUpdated,
      isRealtimeConnected,
      refreshOrders,
      toggleSound,
      soundEnabled
    }}>
      <audio ref={audioRef} src="https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg" loop preload="auto" style={{ display: 'none' }} />
      {children}
    </OrderManagerContext.Provider>
  );
}
