"use server";

import { authorize } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

export async function fetchCustomerLoyaltyStats() {
  await authorize("analytics");

  try {
    const adminClient = createAdminClient();
    const customers = new Map<string, { name: string; orders: number; totalSpend: number; visits: number[] }>();
    let ordersAnalyzed = 0;

    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await adminClient
        .from("orders")
        .select("customer_phone,customer_name,total,created_at,status,id")
        .neq("status", "cancelled")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 999);

      if (error) throw error;

      for (const order of data || []) {
        const phone = String(order.customer_phone || "").replace(/\D/g, "");
        if (!phone) continue;
        const visitAt = new Date(order.created_at).getTime();
        if (!Number.isFinite(visitAt)) continue;
        const customer = customers.get(phone) || { name: "", orders: 0, totalSpend: 0, visits: [] };
        customer.name = String(order.customer_name || customer.name);
        customer.orders++;
        customer.totalSpend += Number(order.total) || 0;
        customer.visits.push(visitAt);
        customers.set(phone, customer);
        ordersAnalyzed++;
      }

      if (!data || data.length < 1000) break;
    }

    let gapTotalDays = 0;
    let gapCount = 0;
    let repeatCustomersTracked = 0;

    for (const customer of customers.values()) {
      if (customer.visits.length < 2) continue;
      repeatCustomersTracked++;
      for (let i = 1; i < customer.visits.length; i++) {
        gapTotalDays += (customer.visits[i] - customer.visits[i - 1]) / 86_400_000;
        gapCount++;
      }
    }

    return {
      success: true as const,
      averageDaysBetweenVisits: gapCount ? Math.round((gapTotalDays / gapCount) * 10) / 10 : null,
      repeatCustomersTracked,
      ordersAnalyzed,
      topCustomers: [...customers.entries()]
        .map(([phone, customer]) => ({
          phone,
          name: customer.name,
          orders: customer.orders,
          totalSpend: Math.round(customer.totalSpend * 100) / 100,
        }))
        .sort((a, b) => b.orders - a.orders || b.totalSpend - a.totalSpend)
        .slice(0, 8),
    };
  } catch (error) {
    console.error("[fetchCustomerLoyaltyStats] Failed to load loyalty stats:", error);
    return { success: false as const, error: "Could not load customer loyalty metrics." };
  }
}
