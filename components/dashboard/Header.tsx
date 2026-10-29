"use client";

import { useOrderManager } from "@/app/(dashboard)/dashboard/OrderManagerProvider";
import { useStaff } from "@/components/providers/StaffProvider";

export default function Header() {
  const { isRealtimeConnected, lastUpdated } = useOrderManager();
  const { staff, setMobileMenuOpen } = useStaff();
  
  const title = staff.role === 'admin' ? 'Admin Dashboard' : 
                staff.role === 'kitchen' ? 'Kitchen Dashboard' :
                staff.role === 'counter' ? 'Counter Dashboard' :
                staff.role === 'waiter' ? 'Waiter Dashboard' : 'Dashboard';
  
  return (
    <header className="sticky top-0 z-20 -mx-4 md:-mx-6 mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[#E3E8EF] bg-white px-4 md:px-6 py-4">
      <div className="flex items-center gap-3">
        <button 
          onClick={() => setMobileMenuOpen(true)}
          className="md:hidden flex items-center justify-center p-2 -ml-2 rounded-lg text-[#475467] hover:bg-[#F3F5F8] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>
        <h1 className="m-0 text-xl sm:text-2xl font-semibold tracking-tight text-[#17202B]">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {isRealtimeConnected ? (
          <div className="flex items-center gap-2 rounded-full bg-[#ECF7F0] px-3 py-1.5 border border-[#D2EBDD]">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#198754] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#198754]"></span>
            </span>
            <span className="text-xs font-semibold text-[#28734A]">Live</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-full bg-[#FFF7E9] px-3 py-1.5 border border-[#F2E2C6]">
            <span className="relative flex h-2.5 w-2.5">
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#B8730B]"></span>
            </span>
            <span className="text-xs font-semibold text-[#8A5A13]">Reconnecting...</span>
          </div>
        )}
        <span className="rounded-full bg-[#F7F8FA] px-3 py-1.5 text-xs font-medium text-[#667385] border border-[#E3E8EF]">
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "Updating..."}
        </span>
        <div className="flex items-center gap-2 rounded-full bg-[#F5F8FC] px-3 py-1.5 border border-[#E0E8F2]">
          <div className="h-2 w-2 rounded-full bg-[#4D79B8]" />
          <span className="text-xs font-semibold text-[#4B607C]">Staff online</span>
        </div>
      </div>
    </header>
  );
}
