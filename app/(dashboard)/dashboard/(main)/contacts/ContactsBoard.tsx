"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Users, CheckSquare, UserX, Upload, Search, Download, Megaphone } from "lucide-react";
import { importContacts } from "./actions";
import { useRouter } from "next/navigation";

type Customer = {
  phone: string;
  name: string | null;
  total_orders: number;
  last_order_date: string | null;
  opted_out: boolean;
};

export default function ContactsBoard() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPhones, setSelectedPhones] = useState<Set<string>>(new Set());
  
  // Import state
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; count?: number; error?: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = createClient();
  const router = useRouter();

  const fetchCustomers = async () => {
    try {
      const { data } = await supabase
        .from("customers")
        .select("phone, name, total_orders, last_order_date, opted_out")
        .order("last_order_date", { ascending: false, nullsFirst: false })
        .limit(1000);
      
      if (data) {
        setCustomers(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [supabase]);

  const handleImport = async (textToImport: string) => {
    if (!textToImport.trim()) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await importContacts(textToImport);
      setImportResult(res);
      if (res.success) {
        setImportText("");
        await fetchCustomers();
      }
    } catch (e: any) {
      setImportResult({ success: false, error: e.message || "Failed to import" });
    } finally {
      setImporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) handleImport(text);
    };
    reader.readAsText(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        if (text) handleImport(text);
      };
      reader.readAsText(file);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.phone.includes(searchQuery) ||
      (c.name && c.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );
  
  const eligibleShown = filteredCustomers.filter(c => !c.opted_out);

  const toggleSelectAll = () => {
    if (eligibleShown.every((c) => selectedPhones.has(c.phone))) {
      // Deselect all shown
      const next = new Set(selectedPhones);
      eligibleShown.forEach((c) => next.delete(c.phone));
      setSelectedPhones(next);
    } else {
      // Select all shown
      const next = new Set(selectedPhones);
      eligibleShown.forEach((c) => next.add(c.phone));
      setSelectedPhones(next);
    }
  };

  const togglePhone = (phone: string) => {
    const next = new Set(selectedPhones);
    if (next.has(phone)) {
      next.delete(phone);
    } else {
      next.add(phone);
    }
    setSelectedPhones(next);
  };
  
  const handleProceedToBlast = () => {
    if (selectedPhones.size > 0) {
      sessionStorage.setItem("pabbas_blast_selection", JSON.stringify(Array.from(selectedPhones)));
      router.push("/dashboard/blast");
    }
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto pb-20 md:pb-6 px-1 sm:px-2 space-y-6">
      <div className="flex flex-col gap-1 mb-2">
        <h1 className="text-[26px] font-extrabold tracking-[-0.6px] text-[#0A1017]">Contacts</h1>
        <p className="text-sm font-semibold text-[#8799AF]">Manage your customers and marketing lists.</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="relative overflow-hidden rounded-[20px] border border-[#B8D5F6] bg-gradient-to-br from-[#EAF3FF] to-[#DCE9FA] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] hover:-translate-y-1 hover:shadow-lg transition-transform duration-300">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-[#1A5FA8] mb-2 font-extrabold uppercase tracking-widest text-[11px] opacity-80">
              <Users className="h-3.5 w-3.5" /> Saved Contacts
            </div>
            <div className="text-[36px] font-extrabold tracking-[-1px] text-[#1A5FA8]">{customers.length}</div>
          </div>
          <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-[0.04] bg-[#1A5FA8]" />
        </div>

        <div className="relative overflow-hidden rounded-[20px] border border-[#F5C2C6] bg-gradient-to-br from-[#FFF0F1] to-[#FDE8E8] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] hover:-translate-y-1 hover:shadow-lg transition-transform duration-300">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-[#C0392B] mb-2 font-extrabold uppercase tracking-widest text-[11px] opacity-80">
              <CheckSquare className="h-3.5 w-3.5" /> Selected
            </div>
            <div className="text-[36px] font-extrabold tracking-[-1px] text-[#C0392B]">{selectedPhones.size}</div>
          </div>
          <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-[0.04] bg-[#C0392B]" />
        </div>

        <div className="relative overflow-hidden rounded-[20px] border border-[#D6CAFC] bg-gradient-to-br from-[#F2EEFF] to-[#E9E4F9] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] hover:-translate-y-1 hover:shadow-lg transition-transform duration-300">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-[#5B3FBF] mb-2 font-extrabold uppercase tracking-widest text-[11px] opacity-80">
              <UserX className="h-3.5 w-3.5" /> Opted Out
            </div>
            <div className="text-[36px] font-extrabold tracking-[-1px] text-[#5B3FBF]">
              {customers.filter((c) => c.opted_out).length}
            </div>
          </div>
          <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-[0.04] bg-[#5B3FBF]" />
        </div>
      </div>

      {/* Import tool */}
      <div className="space-y-4 rounded-[20px] border border-[#EAF0F6] bg-white/50 backdrop-blur-md p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
        <h3 className="text-[18px] font-extrabold tracking-[-0.2px] text-[#0A1017]">Import Contacts</h3>
        <div 
          className={`rounded-2xl border-[2px] border-dashed p-8 text-center transition-colors ${
            dragActive ? "border-[#E23744] bg-[#FDE8E8]" : "border-[#C9D4E0] bg-[#F8FAFB]"
          }`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
        >
          <Upload className={`mx-auto h-10 w-10 mb-3 ${dragActive ? "text-[#E23744]" : "text-[#A1B2C6]"}`} />
          <div className="text-[15px] font-extrabold text-[#0A1017]">Add numbers</div>
          <p className="text-[12px] font-semibold text-[#8799AF] mb-5 mt-1">Drop a CSV here, or choose a file</p>
          <input
            type="file"
            accept=".csv,.txt"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="rounded-xl border border-[#EAF0F6] bg-white px-5 py-2.5 text-[13px] font-bold text-[#0A1017] shadow-sm hover:border-[#C9D4E0] hover:bg-[#F3F6F9] transition-all"
          >
            Choose CSV
          </button>
        </div>
        
        <div className="mt-5">
          <p className="text-[11px] font-extrabold text-[#8799AF] mb-2 uppercase tracking-widest">Or paste numbers</p>
          <textarea
            className="w-full rounded-xl border border-[#EAF0F6] bg-white p-4 text-[14px] font-medium text-[#0A1017] focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 outline-none transition-all resize-none"
            rows={3}
            placeholder="9663428354, 7795240605..."
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <button
            onClick={() => handleImport(importText)}
            disabled={importing || !importText.trim()}
            className="mt-3 rounded-xl bg-[#0A1017] hover:bg-[#111923] px-6 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(10,16,23,0.15)] disabled:opacity-50 hover:-translate-y-0.5 transition-all"
          >
            {importing ? "Importing..." : "Add to contacts"}
          </button>
        </div>

        {importResult && (
          <div className={`mt-3 rounded-xl p-4 text-[13px] font-bold ${importResult.success ? "bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6]" : "bg-[#FDE8E8] text-[#C0392B] border border-[#F5C2C6]"}`}>
            {importResult.success ? `Successfully imported ${importResult.count} contacts!` : `Error: ${importResult.error}`}
          </div>
        )}
      </div>

      {/* Roster & Filter */}
      <div className="rounded-[20px] border border-[#EAF0F6] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.02)] overflow-hidden">
        <div className="p-5 border-b border-[#EAF0F6] bg-[#F8FAFB] flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#A1B2C6]" />
            <input
              type="text"
              placeholder="Search name or number"
              className="w-full rounded-xl border border-[#EAF0F6] bg-white pl-10 pr-4 py-2 text-[13px] font-bold text-[#0A1017] focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 outline-none transition-all placeholder:text-[#A1B2C6]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            onClick={toggleSelectAll}
            className="rounded-xl border border-[#EAF0F6] bg-white px-4 py-2 text-[13px] font-bold text-[#0A1017] shadow-sm hover:border-[#C9D4E0] hover:bg-[#F3F6F9] transition-all"
          >
            {eligibleShown.length > 0 && eligibleShown.every((c) => selectedPhones.has(c.phone)) ? "Deselect All" : `Select all shown (${eligibleShown.length})`}
          </button>
          <button 
            onClick={() => setSelectedPhones(new Set())}
            className="rounded-xl border border-[#EAF0F6] bg-white px-4 py-2 text-[13px] font-bold text-[#C0392B] shadow-sm hover:border-[#F5C2C6] hover:bg-[#FDE8E8] transition-all"
          >
            Clear
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-white text-[#8799AF] sticky top-0 border-b border-[#EAF0F6]">
              <tr>
                <th className="px-5 py-4 w-10"></th>
                <th className="px-5 py-4 font-extrabold uppercase tracking-widest text-[11px]">Number</th>
                <th className="px-5 py-4 font-extrabold uppercase tracking-widest text-[11px]">Name</th>
                <th className="px-5 py-4 font-extrabold uppercase tracking-widest text-[11px]">Orders</th>
                <th className="px-5 py-4 font-extrabold uppercase tracking-widest text-[11px]">Last Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAF0F6] bg-white">
              {filteredCustomers.length > 0 ? (
                filteredCustomers.slice(0, 400).map((c) => (
                  <tr key={c.phone} className="hover:bg-[#F8FAFB] transition-colors">
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={selectedPhones.has(c.phone)}
                        onChange={() => togglePhone(c.phone)}
                        disabled={c.opted_out}
                        className="h-5 w-5 rounded border-[#C9D4E0] text-[#E23744] focus:ring-[#E23744] disabled:opacity-50"
                      />
                    </td>
                    <td className="px-5 py-4 font-bold text-[#0A1017]">{c.phone}</td>
                    <td className="px-5 py-4 font-medium text-[#6B7A90]">{c.name || "—"}</td>
                    <td className="px-5 py-4 font-extrabold text-[#0A1017]">{c.total_orders || 0}</td>
                    <td className="px-5 py-4 text-[#8799AF] font-medium text-[12px]">
                      {c.last_order_date ? new Date(c.last_order_date).toLocaleDateString() : "—"}
                      {c.opted_out && <span className="ml-3 inline-flex items-center rounded-md bg-[#FDE8E8] px-2 py-1 text-[10px] font-bold text-[#C0392B] uppercase tracking-widest">Opted out</span>}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-[#8799AF] font-semibold text-sm">
                    No contacts found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {filteredCustomers.length > 400 && (
            <div className="p-4 text-center text-[12px] font-bold text-[#8799AF] bg-[#F8FAFB] border-t border-[#EAF0F6] uppercase tracking-widest">
              Showing first 400 — search to narrow.
            </div>
          )}
        </div>
      </div>
      
      {/* Sticky footer for blast action */}
      {selectedPhones.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10 fade-in duration-300">
          <button 
            onClick={handleProceedToBlast}
            className="flex items-center gap-2 rounded-full bg-[#E23744] px-8 py-4 text-[15px] font-extrabold text-white shadow-[0_8px_32px_rgba(226,55,68,0.4)] hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(226,55,68,0.5)] transition-all"
          >
            <Megaphone className="h-5 w-5" />
            Proceed to Blast with {selectedPhones.size} contacts →
          </button>
        </div>
      )}
    </div>
  );
}
