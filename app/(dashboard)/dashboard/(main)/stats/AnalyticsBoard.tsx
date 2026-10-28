"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Calendar, Filter, Loader2, TrendingUp, ShoppingBag, IndianRupee } from "lucide-react";
import { format, subDays, startOfDay, endOfDay, startOfWeek, startOfMonth, parseISO, getDay, getHours } from "date-fns";

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
  items_json: Array<{ item_name: string; quantity: number }> | null;
  cancel_reason?: string;
  cancelled_by?: string;
  cancelled_at?: string;
  order_type?: string;
  source?: string;
};

export default function AnalyticsBoard() {
  const [range, setRange] = useState<"today" | "yesterday" | "week" | "month" | "all" | "custom">("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient() as any;

  const fetchStats = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("orders")
        .select("id, order_number, status, total, created_at, items_json, cancel_reason, cancelled_by, cancelled_at, order_type, source")
        .neq("status", "draft");

      const now = new Date();
      let start: Date | null = null;
      let end: Date | null = null;

      if (range === "today") {
        start = startOfDay(now);
        end = endOfDay(now);
      } else if (range === "yesterday") {
        start = startOfDay(subDays(now, 1));
        end = endOfDay(subDays(now, 1));
      } else if (range === "week") {
        start = startOfWeek(now, { weekStartsOn: 1 });
        end = endOfDay(now);
      } else if (range === "month") {
        start = startOfMonth(now);
        end = endOfDay(now);
      } else if (range === "custom" && customStart && customEnd) {
        start = startOfDay(new Date(customStart));
        end = endOfDay(new Date(customEnd));
      }

      if (start && end) {
        query = query.gte("created_at", start.toISOString()).lte("created_at", end.toISOString());
      }

      const { data, error } = await query.order("created_at", { ascending: false }).limit(5000);
      if (!error && data) {
        setOrders(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (range === "custom" && (!customStart || !customEnd)) return;
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, customStart, customEnd]);

  const stats = useMemo(() => {
    const validOrders = orders.filter((o) => o.status !== "cancelled");
    const totalOrders = validOrders.length;
    const totalRevenue = validOrders.reduce((sum, o) => sum + Number(o.total), 0);
    const avgOrder = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    // Most ordered items
    const itemCounts: Record<string, number> = {};
    validOrders.forEach((o) => {
      if (o.items_json && Array.isArray(o.items_json)) {
        o.items_json.forEach((it) => {
          if (it.item_name) {
            itemCounts[it.item_name] = (itemCounts[it.item_name] || 0) + (it.quantity || 1);
          }
        });
      }
    });
    const topItems = Object.entries(itemCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // By day sales
    const byDayMap: Record<string, { orders: number; revenue: number }> = {};
    validOrders.forEach((o) => {
      const d = format(parseISO(o.created_at), "MMM dd, yyyy");
      if (!byDayMap[d]) byDayMap[d] = { orders: 0, revenue: 0 };
      byDayMap[d].orders += 1;
      byDayMap[d].revenue += Number(o.total);
    });
    const dailySales = Object.entries(byDayMap).map(([day, data]) => ({
      day,
      orders: data.orders,
      revenue: data.revenue,
      avg: Math.round(data.revenue / data.orders),
    }));

    // Hourly Heatmap (Day of Week vs Hour)
    // 0 = Sun, 1 = Mon, etc.
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
    let maxHeat = 0;
    validOrders.forEach((o) => {
      const date = parseISO(o.created_at);
      const day = getDay(date); // 0-6
      const hr = getHours(date); // 0-23
      heatmap[day][hr] += 1;
      if (heatmap[day][hr] > maxHeat) maxHeat = heatmap[day][hr];
    });

    const cancelledOrdersList = orders.filter((o) => o.status === "cancelled").map(o => ({
      order_number: o.order_number,
      created_at: o.created_at,
      total: o.total,
      reason: (o.cancel_reason?.includes("|") ? o.cancel_reason.split("|").slice(1).join("|") : o.cancel_reason) || 'No reason provided',
      cancelled_by: o.cancelled_by || 'Unknown',
      items: o.items_json ? o.items_json.map((i: any) => `${i.quantity}x ${i.item_name}`).join(', ') : 'No items'
    }));

    // Order Type Distribution
    let posCount = 0;
    let takeawayCount = 0;
    let deliveryCount = 0;
    validOrders.forEach((o) => {
      if (o.source === "pos") {
        posCount++;
      } else if (o.order_type === "delivery") {
        deliveryCount++;
      } else {
        takeawayCount++;
      }
    });

    return { 
      totalOrders, 
      totalRevenue, 
      avgOrder, 
      topItems, 
      dailySales, 
      heatmap, 
      maxHeat, 
      cancelledOrders: cancelledOrdersList,
      orderTypeDistribution: { pos: posCount, takeaway: takeawayCount, delivery: deliveryCount }
    };
  }, [orders]);

  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6 pb-20 md:pb-6 max-w-[1200px] mx-auto px-1 sm:px-2">
      <div className="flex flex-col gap-1 mb-2">
        <h1 className="text-[26px] font-extrabold tracking-[-0.6px] text-[#0A1017]">Analytics</h1>
        <p className="text-sm font-semibold text-[#8799AF]">Track your restaurant's performance and trends.</p>
      </div>

      {/* Filters */}
      <div className="rounded-[20px] border border-[#EAF0F6] bg-white/50 backdrop-blur-md p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-2 text-[#8799AF]">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#8799AF]">Filters</span>
        </div>
        <div className="flex flex-wrap gap-1 bg-[#F3F6F9] p-1 rounded-xl border border-[#EAF0F6] flex-1 sm:flex-none">
          {[
            { id: "today", label: "Today" },
            { id: "yesterday", label: "Yesterday" },
            { id: "week", label: "This Week" },
            { id: "month", label: "This Month" },
            { id: "all", label: "All Time" },
            { id: "custom", label: "Custom Date" },
          ].map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id as any)}
              className={`rounded-[8px] px-3.5 py-1.5 text-[13px] font-bold transition-all duration-200 ${
                range === r.id
                  ? "bg-white text-[#0A1017] shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-[#E5E9F0]"
                  : "text-[#6B7A90] hover:text-[#0A1017] border border-transparent"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {range === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="rounded-xl border border-[#EAF0F6] bg-white px-3 py-2 text-sm font-semibold text-[#0A1017] outline-none focus:border-[#0D6EFD]"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
            />
            <span className="text-[#8799AF] font-semibold text-sm">to</span>
            <input
              type="date"
              className="rounded-xl border border-[#EAF0F6] bg-white px-3 py-2 text-sm font-semibold text-[#0A1017] outline-none focus:border-[#0D6EFD]"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map(i => (
             <div key={i} className="h-32 rounded-[20px] bg-white/40 p-6 shadow-sm animate-pulse border border-[#EAF0F6]">
               <div className="h-4 w-1/3 bg-black/5 rounded mb-4"></div>
               <div className="h-10 w-2/3 bg-black/5 rounded-xl"></div>
             </div>
          ))}
        </div>
      ) : (
        <>
          {/* Key Metrics */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="relative overflow-hidden rounded-[20px] border border-[#B8D5F6] bg-gradient-to-br from-[#EAF3FF] to-[#DCE9FA] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] hover:-translate-y-1 hover:shadow-lg transition-transform duration-300">
              <div className="relative z-10">
                <div className="flex items-center gap-2 text-[#1A5FA8] mb-2 font-extrabold uppercase tracking-widest text-[11px] opacity-80">
                  <ShoppingBag className="h-3.5 w-3.5" /> Orders
                </div>
                <div className="text-[36px] font-extrabold tracking-[-1px] text-[#1A5FA8]">{stats.totalOrders}</div>
              </div>
              <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-[0.04] bg-[#1A5FA8]" />
            </div>

            <div className="relative overflow-hidden rounded-[20px] border border-[#F5C2C6] bg-gradient-to-br from-[#FFF0F1] to-[#FDE8E8] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] hover:-translate-y-1 hover:shadow-lg transition-transform duration-300">
              <div className="relative z-10">
                <div className="flex items-center gap-2 text-[#C0392B] mb-2 font-extrabold uppercase tracking-widest text-[11px] opacity-80">
                  <IndianRupee className="h-3.5 w-3.5" /> Revenue
                </div>
                <div className="text-[36px] font-extrabold tracking-[-1px] text-[#C0392B]">
                  ₹{stats.totalRevenue.toLocaleString("en-IN")}
                </div>
              </div>
              <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-[0.04] bg-[#C0392B]" />
            </div>

            <div className="relative overflow-hidden rounded-[20px] border border-[#D6CAFC] bg-gradient-to-br from-[#F2EEFF] to-[#E9E4F9] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] hover:-translate-y-1 hover:shadow-lg transition-transform duration-300">
              <div className="relative z-10">
                <div className="flex items-center gap-2 text-[#5B3FBF] mb-2 font-extrabold uppercase tracking-widest text-[11px] opacity-80">
                  <TrendingUp className="h-3.5 w-3.5" /> Average Order
                </div>
                <div className="text-[36px] font-extrabold tracking-[-1px] text-[#5B3FBF]">
                  ₹{stats.avgOrder.toLocaleString("en-IN")}
                </div>
              </div>
              <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-[0.04] bg-[#5B3FBF]" />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Order Type Distribution */}
            <div className="rounded-[20px] border border-[#EAF0F6] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col">
              <div className="border-b border-[#EAF0F6] bg-[#F8FAFB] px-6 py-4">
                <h3 className="font-extrabold text-[15px] tracking-[-0.2px] text-[#0A1017]">Order Types</h3>
              </div>
              <div className="p-6 flex-1 flex flex-col items-center justify-center gap-6 min-h-[250px]">
                {stats.totalOrders > 0 ? (
                  <>
                    <div 
                      className="w-40 h-40 rounded-full"
                      style={{
                        background: `conic-gradient(
                          #C0392B 0% ${(stats.orderTypeDistribution.pos / stats.totalOrders) * 100}%,
                          #F5B041 ${(stats.orderTypeDistribution.pos / stats.totalOrders) * 100}% ${((stats.orderTypeDistribution.pos + stats.orderTypeDistribution.takeaway) / stats.totalOrders) * 100}%,
                          #2E86C1 ${((stats.orderTypeDistribution.pos + stats.orderTypeDistribution.takeaway) / stats.totalOrders) * 100}% 100%
                        )`
                      }}
                    />
                    <div className="w-full flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-[#C0392B]" />
                          <span className="text-[13px] font-bold text-[#0A1017]">POS Orders</span>
                        </div>
                        <span className="text-[13px] font-extrabold text-[#8799AF]">{stats.orderTypeDistribution.pos}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-[#F5B041]" />
                          <span className="text-[13px] font-bold text-[#0A1017]">Takeaway</span>
                        </div>
                        <span className="text-[13px] font-extrabold text-[#8799AF]">{stats.orderTypeDistribution.takeaway}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-[#2E86C1]" />
                          <span className="text-[13px] font-bold text-[#0A1017]">Delivery</span>
                        </div>
                        <span className="text-[13px] font-extrabold text-[#8799AF]">{stats.orderTypeDistribution.delivery}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-[#8799AF] font-semibold text-sm">
                    No orders to display
                  </div>
                )}
              </div>
            </div>

            {/* Top Items */}
            <div className="rounded-[20px] border border-[#EAF0F6] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col">
              <div className="border-b border-[#EAF0F6] bg-[#F8FAFB] px-6 py-4">
                <h3 className="font-extrabold text-[15px] tracking-[-0.2px] text-[#0A1017]">Most Ordered Items</h3>
              </div>
              <div className="p-0 overflow-auto max-h-[400px]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white text-[#8799AF] sticky top-0 border-b border-[#EAF0F6]">
                    <tr>
                      <th className="px-6 py-3 font-extrabold uppercase tracking-widest text-[11px]">Item</th>
                      <th className="px-6 py-3 font-extrabold uppercase tracking-widest text-[11px] text-right">Times Ordered</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EAF0F6]">
                    {stats.topItems.length > 0 ? (
                      stats.topItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-[#F8FAFB] transition-colors">
                          <td className="px-6 py-4 font-bold text-[#0A1017]">{item.name}</td>
                          <td className="px-6 py-4 text-right font-extrabold text-[#6B7A90]">{item.count}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="px-6 py-12 text-center text-[#8799AF] font-semibold text-sm">
                          No items ordered in this period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Daily Sales */}
            <div className="rounded-[20px] border border-[#EAF0F6] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col">
              <div className="border-b border-[#EAF0F6] bg-[#F8FAFB] px-6 py-4 flex justify-between items-center">
                <h3 className="font-extrabold text-[15px] tracking-[-0.2px] text-[#0A1017]">Sales by Day</h3>
                <span className="text-[11px] font-extrabold text-[#8799AF] uppercase tracking-widest">{stats.dailySales.length} Days</span>
              </div>
              <div className="p-6 flex-1 flex flex-col justify-end gap-3 min-h-[250px]">
                {stats.dailySales.length > 0 ? (
                  <div className="flex h-full items-end gap-2 px-2 overflow-x-auto pb-2">
                    {stats.dailySales.map((d, i) => {
                      const maxRev = Math.max(...stats.dailySales.map((s) => s.revenue));
                      const height = maxRev > 0 ? (d.revenue / maxRev) * 100 : 0;
                      return (
                        <div key={i} className="flex flex-col items-center gap-2 min-w-[40px] flex-1 group">
                          <div className="relative flex h-[180px] w-full flex-col justify-end rounded-t-lg bg-[#F8FAFB] hover:bg-[#EAF0F6] transition-colors">
                            <div
                              className="w-full rounded-t-lg bg-[#1A5FA8] transition-all duration-500 ease-out group-hover:bg-[#0D6EFD]"
                              style={{ height: `${height}%` }}
                            ></div>
                            
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-[#0A1017] text-white text-[10px] font-bold px-2 py-1 rounded-[6px] whitespace-nowrap pointer-events-none z-10">
                              ₹{d.revenue}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#0A1017]"></div>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-[#8799AF] whitespace-nowrap truncate max-w-full">
                            {format(new Date(d.day), "MMM d")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-[#8799AF] font-semibold text-sm">
                    No sales data available
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Hourly Heatmap */}
          <div className="rounded-[20px] border border-[#EAF0F6] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.02)] overflow-hidden">
            <div className="border-b border-[#EAF0F6] bg-[#F8FAFB] px-6 py-4">
              <h3 className="font-extrabold text-[15px] tracking-[-0.2px] text-[#0A1017]">Hourly Order Heatmap</h3>
              <p className="text-[12px] font-semibold text-[#8799AF]">Number of orders placed by hour of the day</p>
            </div>
            <div className="p-6 overflow-x-auto">
              <div className="min-w-[800px]">
                <div className="grid grid-cols-[auto_repeat(24,1fr)] gap-1 mb-1">
                  <div className="w-12"></div>
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} className="text-center text-[10px] font-extrabold uppercase tracking-widest text-[#8799AF]">
                      {h}
                    </div>
                  ))}
                </div>
                {daysOfWeek.map((dayName, dayIndex) => (
                  <div key={dayName} className="grid grid-cols-[auto_repeat(24,1fr)] gap-1 mb-1">
                    <div className="w-12 text-[11px] font-extrabold uppercase tracking-widest text-[#6B7A90] flex items-center justify-end pr-2">
                      {dayName}
                    </div>
                    {stats.heatmap[dayIndex].map((count, hour) => {
                      // Calculate opacity based on max heat
                      const intensity = stats.maxHeat > 0 ? Math.max(0.1, count / stats.maxHeat) : 0;
                      return (
                        <div
                          key={hour}
                          title={`${dayName} at ${hour}:00 - ${count} orders`}
                          className="h-8 rounded-[6px] transition hover:ring-2 hover:ring-[#C9D4E0] flex items-center justify-center cursor-default"
                          style={{
                            backgroundColor: count > 0 ? `rgba(226, 55, 68, ${intensity})` : "#F8FAFB",
                          }}
                        >
                          {count > 0 && (
                            <span className={`text-[10px] font-bold ${intensity > 0.5 ? 'text-white' : 'text-[#0A1017]'}`}>
                              {count}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Cancelled Orders */}
          <div className="rounded-[20px] border border-[#EAF0F6] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col mt-6">
            <div className="border-b border-[#EAF0F6] bg-[#F8FAFB] px-6 py-4 flex justify-between items-center">
              <h3 className="font-extrabold text-[15px] tracking-[-0.2px] text-[#0A1017]">Cancelled Orders</h3>
              <span className="rounded-full bg-[#FDE8E8] px-3 py-1 text-[11px] font-bold text-[#C0392B]">
                {stats.cancelledOrders.length} Cancelled
              </span>
            </div>
            <div className="p-0 overflow-auto max-h-[400px]">
              <table className="w-full text-left text-sm">
                <thead className="bg-white text-[#8799AF] sticky top-0 border-b border-[#EAF0F6]">
                  <tr>
                    <th className="px-6 py-3 font-extrabold uppercase tracking-widest text-[11px]">Order</th>
                    <th className="px-6 py-3 font-extrabold uppercase tracking-widest text-[11px]">Items</th>
                    <th className="px-6 py-3 font-extrabold uppercase tracking-widest text-[11px]">Total</th>
                    <th className="px-6 py-3 font-extrabold uppercase tracking-widest text-[11px]">Reason</th>
                    <th className="px-6 py-3 font-extrabold uppercase tracking-widest text-[11px]">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAF0F6]">
                  {stats.cancelledOrders.length > 0 ? (
                    stats.cancelledOrders.map((co, idx) => (
                      <tr key={idx} className="hover:bg-[#F8FAFB] transition-colors cursor-pointer" title={co.items}>
                        <td className="px-6 py-4 font-bold text-[#0A1017]">{co.order_number}</td>
                        <td className="px-6 py-4 text-[#6B7A90] font-medium max-w-[200px] truncate">{co.items}</td>
                        <td className="px-6 py-4 font-extrabold text-[#0A1017]">₹{co.total}</td>
                        <td className="px-6 py-4 font-medium text-[#C0392B]">{co.reason}</td>
                        <td className="px-6 py-4 text-[#8799AF] font-medium capitalize">{co.cancelled_by}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-[#8799AF] font-semibold text-sm">
                        No cancelled orders in this period
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
