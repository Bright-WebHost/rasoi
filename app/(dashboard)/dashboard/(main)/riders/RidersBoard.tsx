"use client";

import { useState, useEffect, useTransition } from "react";
import {
  fetchRidersPageData,
  addRider,
  toggleRiderStatus,
  collectRiderCash,
  deleteRider,
  RiderStats,
  RiderOverviewMetrics,
  TimeFilter,
} from "./actions";
import { useOrderManager } from "../../OrderManagerProvider";
import { AlertTriangle, Plus, RefreshCw, Trash2, CheckCircle2, X } from "lucide-react";

const TIME_FILTERS: { label: string; value: TimeFilter }[] = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "This Week", value: "this_week" },
  { label: "This Month", value: "this_month" },
  { label: "All Time", value: "all_time" },
];

export default function RidersBoard() {
  const { lastUpdated } = useOrderManager();

  const [timeFilter, setTimeFilter] = useState<TimeFilter>("this_week");
  const [riders, setRiders] = useState<RiderStats[]>([]);
  const [metrics, setMetrics] = useState<RiderOverviewMetrics>({
    deliveries_done: 0,
    cancelled: 0,
    cash_collected: 0,
    still_to_collect: 0,
    handed_over: 0,
    riders_owe: 0,
  });
  const [loading, setLoading] = useState(true);

  // Add rider form state
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [isAdding, startAdding] = useTransition();

  // Modal State for Collecting Cash
  const [cashModalRider, setCashModalRider] = useState<RiderStats | null>(null);
  const [inputAmount, setInputAmount] = useState<string>("");
  const [isSubmittingCash, setIsSubmittingCash] = useState(false);

  // Action pending states
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Clock state for "Updated HH:MM:SS am/pm"
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
    loadData(timeFilter);
  }, [timeFilter]);

  async function loadData(filter: TimeFilter = timeFilter) {
    setLoading(true);
    const result = await fetchRidersPageData(filter);
    if (result.success && result.riders && result.metrics) {
      setRiders(result.riders);
      setMetrics(result.metrics);
    }
    setLoading(false);
  }

  const showNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 3000);
  };

  const handleAddRider = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) return;

    startAdding(async () => {
      const result = await addRider(newName, newPhone);
      if (result.success) {
        setNewName("");
        setNewPhone("");
        showNotice("Rider added successfully");
        await loadData(timeFilter);
      } else {
        alert(result.error || "Failed to add rider");
      }
    });
  };

  const handleToggleStatus = async (riderId: string, currentStatus: boolean) => {
    // Optimistic UI update
    setRiders((prev) =>
      prev.map((r) => (r.id === riderId ? { ...r, is_active: !currentStatus } : r))
    );

    const result = await toggleRiderStatus(riderId, !currentStatus);
    if (!result.success) {
      // Revert on failure
      setRiders((prev) =>
        prev.map((r) => (r.id === riderId ? { ...r, is_active: currentStatus } : r))
      );
      alert(result.error || "Failed to update status");
    }
  };

  const openCollectCashModal = (rider: RiderStats) => {
    if (rider.owes <= 0) {
      alert(`${rider.name} has ₹0 outstanding balance to collect.`);
      return;
    }
    setCashModalRider(rider);
    setInputAmount(String(rider.owes));
  };

  const handleConfirmCollectCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cashModalRider) return;

    const parsed = Number(inputAmount);
    if (isNaN(parsed) || parsed <= 0) {
      alert("Please enter a valid positive collection amount");
      return;
    }

    if (parsed > cashModalRider.owes) {
      if (!confirm(`Amount ₹${parsed} exceeds the total owed ₹${cashModalRider.owes}. Do you want to settle the full balance?`)) {
        return;
      }
    }

    setIsSubmittingCash(true);
    const result = await collectRiderCash(cashModalRider.id, parsed);
    setIsSubmittingCash(false);

    if (result.success) {
      const remaining = result.remainingOwes ?? 0;
      setCashModalRider(null);
      setInputAmount("");

      if (remaining === 0) {
        showNotice(`Full balance collected! Remaining owed: ₹0`);
      } else {
        showNotice(`Collected ₹${parsed.toLocaleString("en-IN")}. Remaining owed: ₹${remaining.toLocaleString("en-IN")}`);
      }

      await loadData(timeFilter);
    } else {
      alert(result.error || "Failed to collect cash");
    }
  };

  const handleDeleteRider = async (rider: RiderStats) => {
    if (!confirm(`Are you sure you want to delete rider "${rider.name}"?`)) {
      return;
    }

    setDeletingId(rider.id);
    const result = await deleteRider(rider.id);
    setDeletingId(null);

    if (result.success) {
      showNotice(`Rider ${rider.name} deleted`);
      setRiders((prev) => prev.filter((r) => r.id !== rider.id));
      await loadData(timeFilter);
    } else {
      alert(result.error || "Failed to delete rider");
    }
  };

  const formatCurrency = (val: number) => `₹${Number(val || 0).toLocaleString("en-IN")}`;

  return (
    <div className="w-full max-w-[1340px] mx-auto px-2 sm:px-4 py-4 md:py-6">
      {/* Toast Notice */}
      {actionNotice && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2 bg-[#0A1017] text-white px-4 py-3 rounded-xl shadow-xl text-sm font-bold animate-in fade-in slide-in-from-top-4">
          <CheckCircle2 size={16} className="text-[#10B981]" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Collect Cash Input Modal */}
      {cashModalRider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border border-[#E2E8F0] animate-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-[#E2E8F0] bg-[#F8FAFC] flex justify-between items-center">
              <div>
                <h2 className="text-xl font-black text-[#0F172A]">Collect Cash</h2>
                <p className="text-[13px] text-[#64748B] font-medium mt-0.5">
                  Rider: <strong className="text-[#0F172A]">{cashModalRider.name}</strong> ({cashModalRider.whatsapp_number})
                </p>
              </div>
              <button
                onClick={() => setCashModalRider(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#64748B] hover:text-[#0F172A] hover:bg-gray-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmCollectCash} className="p-6">
              <div className="bg-[#FFF1F2] border border-[#FFE4E6] rounded-2xl p-4 mb-5 flex items-center justify-between">
                <div>
                  <span className="text-[12px] font-extrabold uppercase tracking-wider text-[#9F1239] block">
                    TOTAL CASH OWED
                  </span>
                  <span className="text-2xl font-black text-[#E23744]">
                    {formatCurrency(cashModalRider.owes)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setInputAmount(String(cashModalRider.owes))}
                  className="px-3 py-1.5 rounded-xl bg-white border border-[#FECDD3] text-[12px] font-extrabold text-[#E23744] hover:bg-rose-50 transition"
                >
                  Collect Full
                </button>
              </div>

              <div className="mb-5">
                <label className="block text-[13px] font-extrabold text-[#334155] mb-2">
                  Cash Amount Collected (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-[#64748B]">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="1"
                    max={cashModalRider.owes}
                    step="1"
                    required
                    value={inputAmount}
                    onChange={(e) => setInputAmount(e.target.value)}
                    placeholder="Enter cash collected"
                    className="w-full h-12 pl-9 pr-4 rounded-xl border border-[#CBD5E1] bg-white text-[17px] font-black text-[#0F172A] focus:outline-none focus:border-[#E23744] focus:ring-2 focus:ring-[#E23744]/20 transition"
                  />
                </div>

                {/* Remaining preview */}
                <div className="mt-3 flex justify-between items-center text-[13px] font-bold text-[#64748B] px-1">
                  <span>Remaining after collection:</span>
                  <span className={`font-black ${
                    Math.max(0, cashModalRider.owes - (Number(inputAmount) || 0)) === 0 
                      ? "text-[#10B981]" 
                      : "text-[#E23744]"
                  }`}>
                    {formatCurrency(Math.max(0, cashModalRider.owes - (Number(inputAmount) || 0)))}
                  </span>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCashModalRider(null)}
                  className="flex-1 h-12 rounded-xl border border-[#E2E8F0] bg-white font-extrabold text-[14px] text-[#475569] hover:bg-gray-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCash || !inputAmount || Number(inputAmount) <= 0}
                  className="flex-1 h-12 rounded-xl bg-[#E23744] text-white font-extrabold text-[14px] hover:bg-[#D02633] transition shadow-md shadow-red-500/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  {isSubmittingCash ? "Recording..." : "Confirm Collection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl" role="img" aria-label="motor scooter">🛵</span>
          <h1 className="text-2xl md:text-[28px] font-black text-[#0A1017] tracking-tight">
            Riders
          </h1>
        </div>
      </div>

      {/* Filter Row */}
      <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pb-2 mb-6 no-scrollbar">
        <span className="text-[13px] font-extrabold text-[#64748B] shrink-0 mr-1">
          Filter:
        </span>
        {TIME_FILTERS.map((f) => {
          const isActive = timeFilter === f.value;
          return (
            <button
              key={f.value}
              onClick={() => setTimeFilter(f.value)}
              className={`px-4 sm:px-5 py-2 rounded-full text-[13px] font-extrabold transition-all shrink-0 cursor-pointer ${
                isActive
                  ? "bg-[#E23744] text-white shadow-sm"
                  : "bg-white text-[#475569] border border-[#E2E8F0] hover:bg-[#F8FAFC]"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Add a rider Card */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-5 md:p-6 mb-6">
        <h2 className="text-[15px] font-extrabold text-[#0F172A] mb-3.5">
          Add a rider
        </h2>
        <form onSubmit={handleAddRider} className="flex flex-col sm:flex-row items-center gap-3">
          <input
            type="text"
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={isAdding}
            className="w-full sm:flex-1 h-11 px-4 rounded-xl border border-[#E2E8F0] bg-white text-[14px] text-[#0F172A] placeholder:text-[#94A3B8] font-medium focus:outline-none focus:border-[#E23744] focus:ring-1 focus:ring-[#E23744] transition"
          />
          <input
            type="text"
            placeholder="WhatsApp number"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            disabled={isAdding}
            className="w-full sm:flex-1 h-11 px-4 rounded-xl border border-[#E2E8F0] bg-white text-[14px] text-[#0F172A] placeholder:text-[#94A3B8] font-medium focus:outline-none focus:border-[#E23744] focus:ring-1 focus:ring-[#E23744] transition"
          />
          <button
            type="submit"
            disabled={isAdding || !newName.trim() || !newPhone.trim()}
            className="w-full sm:w-auto h-11 px-6 rounded-xl bg-[#E23744] text-white font-extrabold text-[14px] hover:bg-[#D02633] transition disabled:opacity-50 cursor-pointer shrink-0"
          >
            {isAdding ? "Adding..." : "Add"}
          </button>
        </form>
      </div>

      {/* 6 Metric KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {/* Card 1: DELIVERIES DONE */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-sm flex flex-col justify-between min-h-[96px]">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#64748B]">
            DELIVERIES DONE
          </span>
          <span className="text-[26px] md:text-[28px] font-black text-[#0F172A] leading-none mt-2">
            {metrics.deliveries_done}
          </span>
        </div>

        {/* Card 2: CANCELLED */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-sm flex flex-col justify-between min-h-[96px]">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#64748B]">
            CANCELLED
          </span>
          <span className="text-[26px] md:text-[28px] font-black text-[#0F172A] leading-none mt-2">
            {metrics.cancelled}
          </span>
        </div>

        {/* Card 3: CASH COLLECTED */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-sm flex flex-col justify-between min-h-[96px]">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#64748B]">
            CASH COLLECTED
          </span>
          <span className="text-[22px] md:text-[24px] font-black text-[#0F172A] leading-none mt-2">
            {formatCurrency(metrics.cash_collected)}
          </span>
        </div>

        {/* Card 4: STILL TO COLLECT */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-sm flex flex-col justify-between min-h-[96px]">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#64748B]">
            STILL TO COLLECT
          </span>
          <span className="text-[22px] md:text-[24px] font-black text-[#E23744] leading-none mt-2">
            {formatCurrency(metrics.still_to_collect)}
          </span>
        </div>

        {/* Card 5: HANDED OVER */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-sm flex flex-col justify-between min-h-[96px]">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#64748B]">
            HANDED OVER
          </span>
          <span className="text-[22px] md:text-[24px] font-black text-[#0F172A] leading-none mt-2">
            {formatCurrency(metrics.handed_over)}
          </span>
        </div>

        {/* Card 6: RIDERS OWE */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-4 shadow-sm flex flex-col justify-between min-h-[96px]">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#64748B]">
            RIDERS OWE
          </span>
          <span className="text-[22px] md:text-[24px] font-black text-[#E23744] leading-none mt-2">
            {formatCurrency(metrics.riders_owe)}
          </span>
        </div>
      </div>

      {/* Riders Table Card */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[980px]">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-white">
                <th className="px-5 py-4 text-[11px] font-black uppercase tracking-wider text-[#64748B]">
                  RIDER
                </th>
                <th className="px-5 py-4 text-[11px] font-black uppercase tracking-wider text-[#64748B]">
                  NUMBER
                </th>
                <th className="px-4 py-4 text-[11px] font-black uppercase tracking-wider text-[#64748B] text-center">
                  DONE
                </th>
                <th className="px-4 py-4 text-[11px] font-black uppercase tracking-wider text-[#64748B] text-center">
                  CANCELLED
                </th>
                <th className="px-5 py-4 text-[11px] font-black uppercase tracking-wider text-[#64748B]">
                  COLLECTED
                </th>
                <th className="px-5 py-4 text-[11px] font-black uppercase tracking-wider text-[#64748B]">
                  PENDING
                </th>
                <th className="px-5 py-4 text-[11px] font-black uppercase tracking-wider text-[#64748B]">
                  HANDED OVER
                </th>
                <th className="px-5 py-4 text-[11px] font-black uppercase tracking-wider text-[#64748B]">
                  OWES
                </th>
                <th className="px-5 py-4 text-[11px] font-black uppercase tracking-wider text-[#64748B] text-center">
                  ON DUTY
                </th>
                <th className="px-5 py-4 text-[11px] font-black uppercase tracking-wider text-[#64748B] text-right">
                  ACTIONS
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-[#64748B] font-bold text-[14px]">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="animate-spin text-[#E23744]" size={18} />
                      <span>Loading riders data...</span>
                    </div>
                  </td>
                </tr>
              ) : riders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-[#64748B] font-bold text-[14px]">
                    No riders added yet. Use the form above to add a rider.
                  </td>
                </tr>
              ) : (
                riders.map((rider) => (
                  <tr
                    key={rider.id}
                    className={`hover:bg-[#F8FAFC] transition-colors ${
                      !rider.is_active ? "bg-gray-50/50" : ""
                    }`}
                  >
                    {/* Rider Name */}
                    <td className="px-5 py-4 text-[14px] font-black text-[#0F172A] whitespace-nowrap">
                      {rider.name}
                    </td>

                    {/* Number */}
                    <td className="px-5 py-4 text-[14px] font-medium text-[#475569] whitespace-nowrap">
                      {rider.whatsapp_number}
                    </td>

                    {/* Done */}
                    <td className="px-4 py-4 text-[14px] font-bold text-[#0F172A] text-center whitespace-nowrap">
                      {rider.done}
                    </td>

                    {/* Cancelled */}
                    <td className="px-4 py-4 text-[14px] font-bold text-[#0F172A] text-center whitespace-nowrap">
                      {rider.cancelled}
                    </td>

                    {/* Collected */}
                    <td className="px-5 py-4 text-[14px] font-black text-[#0F172A] whitespace-nowrap">
                      {formatCurrency(rider.collected)}
                    </td>

                    {/* Pending */}
                    <td className="px-5 py-4 text-[14px] font-black text-[#E23744] whitespace-nowrap">
                      {formatCurrency(rider.pending)}
                    </td>

                    {/* Handed Over */}
                    <td className="px-5 py-4 text-[14px] font-black text-[#0F172A] whitespace-nowrap">
                      {formatCurrency(rider.handedOver)}
                    </td>

                    {/* Owes */}
                    <td className="px-5 py-4 whitespace-nowrap">
                      {rider.owes > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[14px] font-black text-[#E23744]">
                          <AlertTriangle size={14} className="text-[#E23744] shrink-0" />
                          <span>{formatCurrency(rider.owes)}</span>
                        </span>
                      ) : (
                        <span className="text-[14px] font-bold text-[#10B981]">
                          ₹0
                        </span>
                      )}
                    </td>

                    {/* On Duty Toggle */}
                    <td className="px-5 py-4 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(rider.id, rider.is_active)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          rider.is_active ? "bg-[#10B981]" : "bg-[#CBD5E1]"
                        }`}
                        role="switch"
                        aria-checked={rider.is_active}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            rider.is_active ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </td>

                    {/* Actions: Collect cash, Delete */}
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openCollectCashModal(rider)}
                          disabled={rider.owes <= 0}
                          className="px-3.5 py-1.5 rounded-xl border border-[#E2E8F0] bg-white text-[12px] font-extrabold text-[#0F172A] hover:bg-[#F8FAFC] transition shadow-sm disabled:opacity-40 cursor-pointer"
                        >
                          Collect cash
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRider(rider)}
                          disabled={deletingId === rider.id}
                          className="px-3 py-1.5 rounded-xl border border-[#FEE2E2] bg-white text-[12px] font-extrabold text-[#EF4444] hover:bg-[#FEF2F2] transition shadow-sm disabled:opacity-40 cursor-pointer"
                        >
                          {deletingId === rider.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
