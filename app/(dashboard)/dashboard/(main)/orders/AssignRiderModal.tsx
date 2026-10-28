"use client";

import { useEffect, useState } from "react";
import { fetchRiders, Rider } from "../riders/actions";

interface AssignRiderModalProps {
  orderNumber: string;
  onAssign: (rider?: { id: string; name: string; phone: string }) => Promise<void> | void;
  onCancel: () => void;
}

// Global cache to prevent slow repeated fetches
let cachedRiders: Rider[] | null = null;
let ridersPromise: Promise<any> | null = null;

export function AssignRiderModal({ orderNumber, onAssign, onCancel }: AssignRiderModalProps) {
  const [riders, setRiders] = useState<Rider[]>(cachedRiders || []);
  const [loading, setLoading] = useState(!cachedRiders);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  useEffect(() => {
    if (cachedRiders) return;
    
    async function load() {
      if (!ridersPromise) {
        ridersPromise = fetchRiders();
      }
      const result = await ridersPromise;
      if (result.success && result.riders) {
        const activeRiders = result.riders.filter((r: Rider) => r.is_active);
        cachedRiders = activeRiders;
        setRiders(activeRiders);
      }
      setLoading(false);
    }
    load();
  }, []);

  const handleAssign = async (rider?: { id: string; name: string; phone: string }) => {
    if (assigningId) return;
    setAssigningId(rider ? rider.id : "skip");
    try {
      await onAssign(rider);
    } finally {
      // If modal is unmounted before this, it's fine
      setAssigningId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#111A26]/80 p-4 backdrop-blur-sm transition-all duration-300" onMouseDown={onCancel}>
      <div 
        className="w-full max-w-md rounded-[20px] bg-white p-6 shadow-[0_24px_48px_rgba(0,0,0,0.2)] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-extrabold text-[#0A1017] mb-6 text-center">
          Who is delivering {orderNumber}?
        </h2>

        <div className="flex flex-col gap-3">
          {loading ? (
            <p className="text-center text-[#8799AF] py-4">Loading riders...</p>
          ) : riders.length === 0 ? (
            <p className="text-center text-[#8799AF] py-4">No active riders found.</p>
          ) : (
            riders.map((rider) => (
              <button
                key={rider.id}
                disabled={assigningId !== null}
                onClick={() => handleAssign({ id: rider.id, name: rider.name, phone: rider.whatsapp_number })}
                className="w-full rounded-xl border border-[#EAF0F6] bg-white px-4 py-3 text-sm font-bold text-[#0A1017] hover:border-[#0D6EFD] hover:bg-[#F0F6FF] transition-all shadow-sm disabled:opacity-50 flex justify-center items-center gap-2"
              >
                {assigningId === rider.id ? <span className="animate-spin border-2 border-t-transparent border-[#0D6EFD] rounded-full w-4 h-4" /> : null}
                {rider.name} - {rider.whatsapp_number}
              </button>
            ))
          )}
          
          <button
            disabled={assigningId !== null}
            onClick={() => handleAssign()}
            className="w-full rounded-xl border border-[#EAF0F6] bg-white px-4 py-3 text-sm font-bold text-[#6B7A90] hover:bg-[#F8FAFB] transition-all mt-2 disabled:opacity-50 flex justify-center items-center gap-2"
          >
            {assigningId === "skip" ? <span className="animate-spin border-2 border-t-transparent border-[#6B7A90] rounded-full w-4 h-4" /> : null}
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
