"use client";

import React, { useState } from "react";
import RidersBoard from "./RidersBoard";
import DispatcherBoard from "./DispatcherBoard";
import { Bike, Send } from "lucide-react";

export default function RidersContainer() {
  const [activeTab, setActiveTab] = useState<"riders" | "dispatcher">("riders");

  return (
    <div className="flex-1 w-full flex flex-col min-h-0 bg-[#F8FAFB]">
      {/* Sub-navigation tabs */}
      <div className="bg-white border-b border-[#E2E8F0] px-4 md:px-8 pt-3 pb-0 flex items-center gap-3">
        <button
          onClick={() => setActiveTab("riders")}
          className={`flex items-center gap-2 px-4 py-2.5 font-extrabold text-[13px] border-b-2 transition-all cursor-pointer ${
            activeTab === "riders"
              ? "border-[#E23744] text-[#E23744]"
              : "border-transparent text-[#64748B] hover:text-[#0F172A]"
          }`}
        >
          <Bike size={16} />
          <span>Riders Overview</span>
        </button>
        <button
          onClick={() => setActiveTab("dispatcher")}
          className={`flex items-center gap-2 px-4 py-2.5 font-extrabold text-[13px] border-b-2 transition-all cursor-pointer ${
            activeTab === "dispatcher"
              ? "border-[#E23744] text-[#E23744]"
              : "border-transparent text-[#64748B] hover:text-[#0F172A]"
          }`}
        >
          <Send size={15} />
          <span>Live Dispatcher</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === "riders" ? <RidersBoard /> : <div className="p-4 md:p-6"><DispatcherBoard /></div>}
      </div>
    </div>
  );
}
