"use client";

import { useSyncExternalStore } from "react";
import type { DashboardOrder } from "@/lib/orders/queries";

export const rs = (n: unknown) => "₹" + Number(n || 0).toLocaleString("en-IN");
export const pct = (n: number) => (n >= 0 ? "" : "−") + Math.abs(Number(n || 0)).toFixed(1) + "%";
export const ist = (t: string | number | Date) =>
  new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const cleanNum = (s: unknown) => String(s || "").replace(/\D/g, "");
export const fmtMins = (m: number) => (m < 60 ? m + "m" : Math.floor(m / 60) + "h " + (m % 60) + "m");
export const ageOf = (o: { created_at: string }) => Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000);
export const dayKeyIST = (o: { created_at: string }) => new Date(new Date(o.created_at).getTime() + 19800000).toISOString().slice(0, 10);

export type Range = "today" | "yesterday" | "week" | "month" | "all" | "custom";
export type RangeState = { range: Range; from: string; to: string };

export function rangeStart({ range, from }: RangeState) {
  const n = new Date();
  const istNow = new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 19800000);
  const midnight = new Date(istNow);
  midnight.setHours(0, 0, 0, 0);
  const off = midnight.getTime() - 19800000 - n.getTimezoneOffset() * 60000;
  if (range === "today") return new Date(off);
  if (range === "yesterday") return new Date(off - 86400000);
  if (range === "week") return new Date(off - 6 * 86400000);
  if (range === "month") return new Date(off - 29 * 86400000);
  if (range === "custom" && from) return new Date(from + "T00:00:00+05:30");
  return new Date(0);
}

export function inRange(o: { created_at: string }, r: RangeState) {
  const t = new Date(o.created_at).getTime();
  const s = rangeStart(r).getTime();
  if (r.range === "yesterday") return t >= s && t < s + 86400000;
  if (r.range === "custom" && r.to) return t >= s && t < new Date(r.to + "T23:59:59+05:30").getTime();
  return t >= s;
}

export const RANGE_CHIPS: Array<[Range, string]> = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["week", "This Week"], ["month", "This Month"], ["all", "All Time"],
];

/** Oceana's channel classes: delivery (blue), takeaway (amber), dine-in (purple). */
export function channelOf(o: Pick<DashboardOrder, "order_type" | "table_number">): "delivery" | "takeaway" | "dine-in" {
  if (o.order_type === "dine-in" || String(o.table_number || "").trim()) return "dine-in";
  return o.order_type === "delivery" ? "delivery" : "takeaway";
}

const mobileQuery = "(max-width:860px)";
function subscribe(cb: () => void) {
  const mq = window.matchMedia(mobileQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(mobileQuery).matches, () => false);
}

export type LineItem = { name: string; quantity: number; lineTotal: number; notes: string | null; round: number };

/** Structured lines from items_json; falls back to the text summary for old rows. */
export function lineItemsOf(o: Pick<DashboardOrder, "items_json" | "items">): LineItem[] {
  const json = Array.isArray(o.items_json) ? o.items_json : [];
  if (json.length) {
    return json.map((raw) => {
      const i = raw as Record<string, unknown>;
      const qty = Math.max(1, Number(i.quantity) || 1);
      const name = [i.item_name || i.name || "Item", i.variant_name].filter(Boolean).join(" · ");
      return {
        name: String(name),
        quantity: qty,
        lineTotal: Number(i.unit_price ?? i.price ?? 0) * qty,
        notes: (i.notes as string) || null,
        round: Number(i.round) || 1,
      };
    });
  }
  return String(o.items || "").split(", ").filter(Boolean).map((t) => ({ name: t, quantity: 0, lineTotal: 0, notes: null, round: 1 }));
}
