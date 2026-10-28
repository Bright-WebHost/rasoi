"use client";

import { useState, useEffect, useTransition, useRef, useMemo } from "react";
import {
  fetchTables,
  addTable,
  deleteTable,
  clearTable,
  RestaurantTable,
  TablesOverviewMetrics,
  moveTable,
  mergeTables,
} from "./actions";
import { QRCodeSVG } from "qrcode.react";
import { useOrderManager } from "../../OrderManagerProvider";
import { Plus, X, ArrowRight, GitMerge, Move, History, Trash2, Printer } from "lucide-react";

export default function TablesBoard() {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [metrics, setMetrics] = useState<TablesOverviewMetrics>({
    open_tables: 0,
    total_tables: 0,
    food_ready: 0,
    dine_in_week: 0,
    open_value: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isAdding, startAdding] = useTransition();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTable, setNewTable] = useState("");

  const [printTable, setPrintTable] = useState<RestaurantTable | null>(null);

  const [historyModalTable, setHistoryModalTable] = useState<string | null>(null);
  const [tableHistory, setTableHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [moveModalOrder, setMoveModalOrder] = useState<{
    orderId: string;
    oldTableNumber: string;
  } | null>(null);
  const [mergeModalOrder, setMergeModalOrder] = useState<{
    orderId: string;
    sourceTableNumber: string;
  } | null>(null);
  const [selectedTargetTable, setSelectedTargetTable] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);

  const { lastUpdated } = useOrderManager();
  const isInitialLoad = useRef(true);

  // Live clock
  const [currentTimeStr, setCurrentTimeStr] = useState<string>("");

  useEffect(() => {
    const updateTime = () => {
      const now = lastUpdated || new Date();
      setCurrentTimeStr(
        now.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          hour12: true,
        }).toLowerCase()
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  useEffect(() => {
    loadTables(isInitialLoad.current);
    isInitialLoad.current = false;
  }, [lastUpdated]);

  async function loadTables(showLoader = false) {
    if (showLoader) setLoading(true);
    const result = await fetchTables();
    if (result.success && result.tables) {
      setTables(result.tables);
      if (result.metrics) setMetrics(result.metrics);
    }
    setLoading(false);
  }

  // Tables needing attention float to top (active first, sorted by table number)
  const sortedTables = useMemo(() => {
    return [...tables].sort((a, b) => {
      const aActive = a.is_active && a.orders ? 1 : 0;
      const bActive = b.is_active && b.orders ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive; // occupied first
      const aNum = parseInt(a.table_number.replace(/\D/g, ""), 10);
      const bNum = parseInt(b.table_number.replace(/\D/g, ""), 10);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      return a.table_number.localeCompare(b.table_number);
    });
  }, [tables]);

  // Tables with bills ready / awaiting payment for the attention banner
  const attentionTables = useMemo(() => {
    return tables.filter((t) => t.is_active && t.orders);
  }, [tables]);

  const handleAddTable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTable.trim()) return;

    startAdding(async () => {
      const result = await addTable(newTable);
      if (result.success && result.table) {
        setNewTable("");
        setShowAddModal(false);
        await loadTables(true);
      } else {
        alert(result.error || "Failed to add table");
      }
    });
  };

  const handleClearTable = async (id: string, tableNumber: string, total: number) => {
    if (!confirm(`Confirm settle bill & close Table ${tableNumber} (₹${total.toLocaleString("en-IN")})?`)) {
      return;
    }

    // Optimistic UI update
    setTables((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, is_active: false, current_order_id: null, orders: null }
          : t
      )
    );

    const result = await clearTable(id);
    if (!result.success) {
      loadTables();
      alert(result.error || "Failed to clear table");
    } else {
      loadTables();
    }
  };

  const handleDeleteTable = async (table: RestaurantTable) => {
    if (table.is_active) {
      alert("Cannot delete an occupied table.");
      return;
    }
    if (!confirm(`Are you sure you want to delete Table ${table.table_number}?`)) return;

    setTables((prev) => prev.filter((t) => t.id !== table.id));
    const result = await deleteTable(table.id);
    if (!result.success) {
      loadTables();
      alert(result.error || "Failed to delete table");
    } else {
      loadTables();
    }
  };

  const handlePrintQr = (table: RestaurantTable) => {
    setPrintTable(table);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const handleConfirmMove = async () => {
    if (!moveModalOrder || !selectedTargetTable) return;
    setIsProcessing(true);
    const result = await moveTable(
      moveModalOrder.orderId,
      moveModalOrder.oldTableNumber,
      selectedTargetTable
    );
    setIsProcessing(false);
    if (result.success) {
      setMoveModalOrder(null);
      setSelectedTargetTable("");
      loadTables(true);
    } else {
      alert(result.error);
    }
  };

  const handleConfirmMerge = async () => {
    if (!mergeModalOrder || !selectedTargetTable) return;
    const targetTable = tables.find((t) => t.table_number === selectedTargetTable);
    if (!targetTable || !targetTable.current_order_id) return;

    setIsProcessing(true);
    const result = await mergeTables(
      mergeModalOrder.orderId,
      targetTable.current_order_id,
      mergeModalOrder.sourceTableNumber
    );
    setIsProcessing(false);
    if (result.success) {
      setMergeModalOrder(null);
      setSelectedTargetTable("");
      loadTables(true);
    } else {
      alert(result.error);
    }
  };

  const openHistory = async (tableNumber: string) => {
    setHistoryModalTable(tableNumber);
    setLoadingHistory(true);
    const { fetchTableHistory } = await import("./actions");
    const res = await fetchTableHistory(tableNumber);
    if (res.success && res.history) {
      setTableHistory(res.history);
    }
    setLoadingHistory(false);
  };

  const formatCurrency = (val: number) => `₹${Number(val || 0).toLocaleString("en-IN")}`;

  // Time elapsed helper
  const getElapsedMinutes = (dateStr?: string) => {
    if (!dateStr) return null;
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.max(0, Math.floor(diffMs / 60000));
    return `${mins}m`;
  };

  return (
    <div className="w-full max-w-[1380px] mx-auto px-2 sm:px-4 py-4 md:py-6">
      <div className="print:hidden">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <span className="text-2xl" role="img" aria-label="table setting">🍽️</span>
            <h1 className="text-2xl md:text-[28px] font-black text-[#0A1017] tracking-tight">
              Tables
            </h1>
          </div>
        </div>

        {/* 4 Colored KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
          {/* Card 1: TABLES OPEN (Light Lavender) */}
          <div className="bg-[#EEF2FF] border border-[#E0E7FF] rounded-2xl p-4 sm:p-5 flex flex-col justify-between min-h-[104px]">
            <span className="text-[11px] font-black uppercase tracking-wider text-[#4F46E5]">
              TABLES OPEN
            </span>
            <span className="text-[28px] sm:text-[32px] font-black text-[#4338CA] leading-none mt-2">
              {metrics.open_tables}/{metrics.total_tables}
            </span>
          </div>

          {/* Card 2: FOOD READY (Light Yellow) */}
          <div className="bg-[#FEF9C3]/50 border border-[#FEF08A] rounded-2xl p-4 sm:p-5 flex flex-col justify-between min-h-[104px]">
            <span className="text-[11px] font-black uppercase tracking-wider text-[#854D0E]">
              FOOD READY
            </span>
            <span className="text-[28px] sm:text-[32px] font-black text-[#A16207] leading-none mt-2">
              {metrics.food_ready}
            </span>
          </div>

          {/* Card 3: DINE-IN WEEK (Light Sky) */}
          <div className="bg-[#F0F9FF] border border-[#E0F2FE] rounded-2xl p-4 sm:p-5 flex flex-col justify-between min-h-[104px]">
            <span className="text-[11px] font-black uppercase tracking-wider text-[#0369A1]">
              DINE-IN WEEK
            </span>
            <span className="text-[28px] sm:text-[32px] font-black text-[#0284C7] leading-none mt-2">
              {metrics.dine_in_week}
            </span>
          </div>

          {/* Card 4: OPEN VALUE (Light Rose) */}
          <div className="bg-[#FFF1F2] border border-[#FFE4E6] rounded-2xl p-4 sm:p-5 flex flex-col justify-between min-h-[104px]">
            <span className="text-[11px] font-black uppercase tracking-wider text-[#BE123C]">
              OPEN VALUE
            </span>
            <span className="text-[24px] sm:text-[28px] font-black text-[#E11D48] leading-none mt-2">
              {formatCurrency(metrics.open_value)}
            </span>
          </div>
        </div>

        {/* Needs Attention Yellow Banner */}
        {attentionTables.length > 0 && (
          <div className="bg-[#FEFCE8] border border-[#FEF08A] rounded-2xl px-4 py-3 mb-5 flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 mr-2">
              <span className="h-2 w-2 rounded-full bg-[#EAB308]"></span>
              <span className="text-[13px] font-black text-[#854D0E]">
                Needs attention
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {attentionTables.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    const el = document.getElementById(`table-card-${t.table_number}`);
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  className="px-3 py-1 rounded-full bg-white border border-[#FDE047] text-[12px] font-black text-[#047857] hover:bg-emerald-50 transition cursor-pointer shadow-2xs"
                >
                  Table {t.table_number} · Bill due
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Controls row: + Add table button and informational label */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#E23744] text-white font-extrabold text-[13px] hover:bg-[#D02633] transition shadow-sm cursor-pointer"
            >
              <Plus size={16} strokeWidth={3} />
              <span>Add table</span>
            </button>
            <span className="text-[13px] font-bold text-[#64748B]">
              {tables.length} tables · tables needing you float to the top
            </span>
          </div>
        </div>

        {/* Tables Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {sortedTables.map((table) => {
            const isOccupied = table.is_active && table.orders;
            const order = table.orders;
            const elapsed = isOccupied ? getElapsedMinutes(order?.created_at) : null;
            const rounds = isOccupied && order?.items_json
              ? Array.from(new Set(order.items_json.map((i: any) => i.round || 1))).sort()
              : [1];

            return (
              <div
                key={table.id}
                id={`table-card-${table.table_number}`}
                className={`rounded-2xl border bg-white shadow-sm flex flex-col justify-between transition-all overflow-hidden ${
                  isOccupied
                    ? "border-[#86EFAC] ring-2 ring-[#22C55E]/15"
                    : "border-[#E2E8F0]"
                }`}
              >
                <div>
                  {/* Card Header */}
                  <div className="p-4 pb-3 flex items-start justify-between border-b border-[#F1F5F9]">
                    <div className="flex items-center gap-2.5">
                      {/* Circle Number Badge */}
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-[15px] shrink-0 ${
                          isOccupied
                            ? "bg-[#6366F1] text-white"
                            : "bg-[#F1F5F9] text-[#64748B]"
                        }`}
                      >
                        {table.table_number}
                      </div>
                      <div>
                        <h3 className="text-[15px] font-black text-[#0F172A] leading-tight">
                          Table {table.table_number}
                        </h3>
                        <span className="text-[11px] font-bold text-[#94A3B8]">
                          4 seats
                        </span>
                      </div>
                    </div>

                    {/* Status Badge */}
                    {isOccupied ? (
                      <span className="text-[10px] font-black tracking-wider uppercase text-[#16A34A] bg-[#DCFCE7] px-2.5 py-0.5 rounded-full border border-[#BBF7D0]">
                        AWAITING PAYMENT
                      </span>
                    ) : (
                      <span className="text-[10px] font-black tracking-wider uppercase text-[#64748B] bg-[#F1F5F9] px-2 py-0.5 rounded-full border border-[#E2E8F0]">
                        AVAILABLE
                      </span>
                    )}
                  </div>

                  {/* Card Body */}
                  <div className="p-4 pt-3.5">
                    {isOccupied && order ? (
                      <>
                        {/* Customer Info & Time */}
                        <div className="flex items-center justify-between text-[12px] font-bold text-[#475569] mb-3">
                          <span className="truncate max-w-[150px]">
                            {order.customer_name || "Dine-in Guest"}{" "}
                            {order.customer_phone ? `· ${order.customer_phone}` : ""}
                          </span>
                          {elapsed && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[#E11D48] bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100 shrink-0">
                              ⏱ {elapsed}
                            </span>
                          )}
                        </div>

                        {/* Order Rounds & Line Items */}
                        <div className="space-y-3 mb-4 text-[13px]">
                          {rounds.map((rndNum: any) => {
                            const rndItems = (order.items_json || []).filter(
                              (i: any) => (i.round || 1) === rndNum
                            );
                            const rndTotal = rndItems.reduce(
                              (s: number, i: any) => s + (i.price || i.unit_price || 0) * (i.quantity || 1),
                              0
                            );

                            return (
                              <div key={rndNum} className="border-t border-dashed border-[#E2E8F0] pt-2.5">
                                <div className="flex justify-between items-center text-[11px] font-black text-[#64748B] uppercase tracking-wide mb-1.5">
                                  <span>Round {rndNum} · {order.status.replace(/_/g, " ")}</span>
                                  <span className="text-[#0F172A] font-black">₹{rndTotal}</span>
                                </div>
                                <div className="space-y-1">
                                  {rndItems.map((item: any, idx: number) => (
                                    <div
                                      key={idx}
                                      className="flex justify-between items-center text-[12px] text-[#334155] font-bold"
                                    >
                                      <span className="truncate mr-2">
                                        {item.item_name} {item.variant_name ? `(${item.variant_name})` : ""}{" "}
                                        <span className="text-[#94A3B8]">×{item.quantity}</span>
                                      </span>
                                      <span className="text-[#0F172A] shrink-0">
                                        ₹{(item.price || item.unit_price || 0) * (item.quantity || 1)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Running Total */}
                        <div className="flex justify-between items-baseline pt-2.5 border-t border-[#E2E8F0] mb-3">
                          <span className="text-[11px] font-black uppercase tracking-wider text-[#64748B]">
                            RUNNING TOTAL
                          </span>
                          <span className="text-[20px] font-black text-[#0F172A]">
                            ₹{order.total}
                          </span>
                        </div>
                      </>
                    ) : (
                      /* Free State */
                      <div className="py-14 text-center">
                        <p className="text-[13px] font-bold text-[#94A3B8]">
                          Free — no open tab
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="p-3 pt-0 space-y-2">
                  {isOccupied && order ? (
                    <>
                      {/* Close & pay button (Green) */}
                      <button
                        type="button"
                        onClick={() => handleClearTable(table.id, table.table_number, order.total)}
                        className="w-full h-10 rounded-xl bg-[#DCFCE7] hover:bg-[#BBF7D0] border border-[#86EFAC] text-[#15803D] font-black text-[13px] transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                      >
                        <span>💵 Close & pay · ₹{order.total}</span>
                      </button>

                      {/* 3 Secondary buttons: + Round, Move, Merge */}
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof window !== "undefined") {
                              window.location.href = `/dashboard/pos?append=${order.id}&table=${encodeURIComponent(
                                table.table_number
                              )}`;
                            }
                          }}
                          className="h-8 rounded-lg border border-[#E2E8F0] bg-white text-[12px] font-extrabold text-[#334155] hover:bg-gray-50 transition shadow-2xs"
                        >
                          + Round
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMoveModalOrder({
                              orderId: order.id,
                              oldTableNumber: table.table_number,
                            })
                          }
                          className="h-8 rounded-lg border border-[#E2E8F0] bg-white text-[12px] font-extrabold text-[#334155] hover:bg-gray-50 transition shadow-2xs"
                        >
                          Move
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMergeModalOrder({
                              orderId: order.id,
                              sourceTableNumber: table.table_number,
                            })
                          }
                          className="h-8 rounded-lg border border-[#E2E8F0] bg-white text-[12px] font-extrabold text-[#334155] hover:bg-gray-50 transition shadow-2xs"
                        >
                          Merge
                        </button>
                      </div>

                      {/* Utility link buttons: QR, History, Delete */}
                      <div className="flex items-center justify-between pt-1 border-t border-[#F1F5F9] text-[11px] font-extrabold text-[#64748B]">
                        <button
                          type="button"
                          onClick={() => handlePrintQr(table)}
                          className="hover:text-[#0F172A] py-1 px-1.5 transition"
                        >
                          QR
                        </button>
                        <button
                          type="button"
                          onClick={() => openHistory(table.table_number)}
                          className="hover:text-[#0F172A] py-1 px-1.5 transition"
                        >
                          History
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTable(table)}
                          className="text-red-500 hover:text-red-700 py-1 px-1.5 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Start Order Button (Coral Red) */}
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof window !== "undefined") {
                            window.location.href = `/dashboard/pos?table=${encodeURIComponent(
                              table.table_number
                            )}`;
                          }
                        }}
                        className="w-full h-10 rounded-xl bg-[#E23744] hover:bg-[#D02633] text-white font-black text-[13px] transition shadow-md shadow-red-500/20 cursor-pointer"
                      >
                        Start order
                      </button>

                      {/* Utility link buttons: QR, History, Delete */}
                      <div className="flex items-center justify-between pt-1 border-t border-[#F1F5F9] text-[11px] font-extrabold text-[#64748B]">
                        <button
                          type="button"
                          onClick={() => handlePrintQr(table)}
                          className="hover:text-[#0F172A] py-1 px-1.5 transition"
                        >
                          QR
                        </button>
                        <button
                          type="button"
                          onClick={() => openHistory(table.table_number)}
                          className="hover:text-[#0F172A] py-1 px-1.5 transition"
                        >
                          History
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTable(table)}
                          className="text-red-500 hover:text-red-700 py-1 px-1.5 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty State */}
        {tables.length === 0 && !loading && (
          <div className="text-center py-16 bg-white rounded-2xl border border-[#E2E8F0]">
            <span className="text-4xl mb-3 block">🪑</span>
            <h3 className="text-lg font-black text-[#0F172A] mb-1">No tables created yet</h3>
            <p className="text-[14px] text-[#64748B] mb-4">
              Add your first dine-in table to start managing tabs.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-5 py-2.5 rounded-xl bg-[#E23744] text-white font-extrabold text-[13px] hover:bg-[#D02633] transition"
            >
              Add Table
            </button>
          </div>
        )}
      </div>

      {/* Add Table Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden border border-[#E2E8F0] animate-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-[#E2E8F0] bg-[#F8FAFC] flex justify-between items-center">
              <h2 className="text-lg font-black text-[#0F172A]">Add a new table</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#64748B] hover:text-[#0F172A] hover:bg-gray-100 transition"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleAddTable} className="p-5">
              <label className="block text-[13px] font-extrabold text-[#334155] mb-2">
                Table Identifier / Number
              </label>
              <input
                type="text"
                autoFocus
                placeholder="e.g. 1, 2, T3, Outdoor 1"
                value={newTable}
                onChange={(e) => setNewTable(e.target.value)}
                disabled={isAdding}
                className="w-full h-11 px-4 rounded-xl border border-[#CBD5E1] bg-white text-[14px] font-bold text-[#0F172A] focus:outline-none focus:border-[#E23744] focus:ring-2 focus:ring-[#E23744]/20 transition mb-5"
              />
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 h-11 rounded-xl border border-[#E2E8F0] bg-white font-extrabold text-[13px] text-[#475569] hover:bg-gray-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdding || !newTable.trim()}
                  className="flex-1 h-11 rounded-xl bg-[#E23744] text-white font-extrabold text-[13px] hover:bg-[#D02633] transition shadow-md shadow-red-500/20 disabled:opacity-50 cursor-pointer"
                >
                  {isAdding ? "Adding..." : "Add Table"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move Table Modal */}
      {moveModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border border-[#E2E8F0] animate-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <h2 className="text-xl font-black text-[#0F172A]">
                Move Table {moveModalOrder.oldTableNumber}
              </h2>
              <p className="text-[13px] text-[#64748B] mt-1 font-medium">
                Select an empty table to transfer this active tab to.
              </p>
            </div>
            <div className="p-6">
              <select
                value={selectedTargetTable}
                onChange={(e) => setSelectedTargetTable(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#CBD5E1] bg-white text-[14px] font-bold text-[#0F172A] focus:border-[#E23744] outline-none transition"
              >
                <option value="">Select destination table...</option>
                {tables
                  .filter(
                    (t) => !t.is_active && t.table_number !== moveModalOrder.oldTableNumber
                  )
                  .map((t) => (
                    <option key={t.id} value={t.table_number}>
                      Table {t.table_number} (Available)
                    </option>
                  ))}
              </select>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setMoveModalOrder(null);
                    setSelectedTargetTable("");
                  }}
                  className="flex-1 py-3 bg-white border border-[#E2E8F0] text-[#64748B] font-bold text-[14px] rounded-xl hover:bg-gray-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmMove}
                  disabled={!selectedTargetTable || isProcessing}
                  className="flex-1 py-3 bg-[#E23744] text-white font-bold text-[14px] rounded-xl hover:bg-[#D02633] transition disabled:opacity-50 cursor-pointer shadow-md shadow-red-500/20"
                >
                  {isProcessing ? "Moving..." : "Confirm Move"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Merge Table Modal */}
      {mergeModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border border-[#E2E8F0] animate-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <h2 className="text-xl font-black text-[#0F172A]">
                Merge Table {mergeModalOrder.sourceTableNumber}
              </h2>
              <p className="text-[13px] text-[#64748B] mt-1 font-medium">
                Select an active table to merge into. This will combine all items and close Table {mergeModalOrder.sourceTableNumber}.
              </p>
            </div>
            <div className="p-6">
              <select
                value={selectedTargetTable}
                onChange={(e) => setSelectedTargetTable(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#CBD5E1] bg-white text-[14px] font-bold text-[#0F172A] focus:border-[#E23744] outline-none transition"
              >
                <option value="">Select target table...</option>
                {tables
                  .filter(
                    (t) => t.is_active && t.table_number !== mergeModalOrder.sourceTableNumber
                  )
                  .map((t) => (
                    <option key={t.id} value={t.table_number}>
                      Table {t.table_number} (₹{t.orders?.total})
                    </option>
                  ))}
              </select>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setMergeModalOrder(null);
                    setSelectedTargetTable("");
                  }}
                  className="flex-1 py-3 bg-white border border-[#E2E8F0] text-[#64748B] font-bold text-[14px] rounded-xl hover:bg-gray-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmMerge}
                  disabled={!selectedTargetTable || isProcessing}
                  className="flex-1 py-3 bg-[#E23744] text-white font-bold text-[14px] rounded-xl hover:bg-[#D02633] transition disabled:opacity-50 cursor-pointer shadow-md shadow-red-500/20"
                >
                  {isProcessing ? "Merging..." : "Confirm Merge"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyModalTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-[#E2E8F0] animate-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-[#E2E8F0] flex justify-between items-center bg-[#F8FAFC]">
              <h2 className="text-xl font-black text-[#0F172A]">
                Order History — Table {historyModalTable}
              </h2>
              <button
                onClick={() => setHistoryModalTable(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#64748B] hover:text-[#0F172A] hover:bg-gray-100 transition"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {loadingHistory ? (
                <p className="text-[#64748B] font-bold text-center py-8">Loading history...</p>
              ) : tableHistory.length > 0 ? (
                <div className="space-y-3">
                  {tableHistory.map((ord) => (
                    <div
                      key={ord.id}
                      className="border border-[#E2E8F0] rounded-xl p-4 bg-white shadow-2xs"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="text-[14px] font-black text-[#0F172A]">
                            {ord.order_number}
                          </span>
                          <div className="text-[12px] font-bold text-[#94A3B8] mt-0.5">
                            {new Date(ord.created_at).toLocaleString("en-IN")}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[16px] font-black text-[#0F172A]">
                            ₹{ord.total}
                          </div>
                          <div
                            className={`text-[10px] font-black uppercase tracking-wider mt-0.5 px-2 py-0.5 rounded-full inline-block ${
                              ord.status === "delivered"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-red-50 text-red-700 border border-red-200"
                            }`}
                          >
                            {ord.status}
                          </div>
                        </div>
                      </div>
                      <div className="text-[12px] text-[#64748B] font-medium pt-2 border-t border-dashed border-[#F1F5F9]">
                        {ord.customer_name
                          ? `Guest: ${ord.customer_name} (${ord.customer_phone})`
                          : "Dine-in Customer"}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[#94A3B8] font-bold text-center py-8">
                  No past orders recorded for this table.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Print QR Code Template (Only visible when printing) */}
      <div className="hidden print:flex flex-col items-center justify-center fixed inset-0 z-[99999] w-full h-full bg-white m-0 p-0">
        <style
          dangerouslySetInnerHTML={{
            __html: `
            @media print {
              @page { margin: 0; }
              body { margin: 0; -webkit-print-color-adjust: exact; }
            }
          `,
          }}
        />
        {printTable && (
          <div className="w-[10cm] h-[15cm] border-[3px] border-[#0A1017] rounded-3xl flex flex-col items-center justify-between p-8 text-center bg-white shadow-2xl relative overflow-hidden">
            <div
              className="absolute top-0 left-0 w-full h-32 bg-[#E23744]"
              style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 80%)" }}
            ></div>

            <div className="relative z-10 w-full">
              <h1 className="text-4xl font-black text-white tracking-tighter mb-1 uppercase">
                Pabbas
              </h1>
              <p className="text-[12px] font-extrabold text-white/90 tracking-widest uppercase">
                Ideal Ice Cream
              </p>
            </div>

            <div className="relative z-10 mt-12 mb-4 bg-white p-4 rounded-3xl border-4 border-[#0A1017] shadow-xl">
              <QRCodeSVG
                value={
                  typeof window !== "undefined"
                    ? `${window.location.origin}/?table=${encodeURIComponent(
                        printTable.table_number
                      )}`
                    : ""
                }
                size={200}
                bgColor={"#ffffff"}
                fgColor={"#0A1017"}
                level={"H"}
                includeMargin={false}
              />
            </div>

            <div className="relative z-10 mb-8 w-full">
              <h2 className="text-[32px] font-black text-[#0A1017] leading-none mb-2">
                Table {printTable.table_number}
              </h2>
              <div className="w-16 h-1 bg-[#E23744] mx-auto rounded-full mb-4"></div>
              <p className="text-[15px] font-extrabold text-[#64748B] uppercase tracking-widest leading-snug">
                Scan with your phone
                <br />
                to order & pay
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
