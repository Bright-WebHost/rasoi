"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useOrderManager } from "@/app/(dashboard)/dashboard/OrderManagerProvider";
import { useStaff } from "@/components/providers/StaffProvider";
import { canAccessPage, type PageRoute } from "@/lib/auth/permissions";

export default function Sidebar({ restaurantName = "Pabbas", logoUrl = "" }: { restaurantName?: string; logoUrl?: string }) {
  // Remember which logo URL failed to load, so a newly uploaded logo gets a fresh try.
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { refreshOrders, toggleSound, soundEnabled } = useOrderManager();
  const { staff, mobileMenuOpen, setMobileMenuOpen, desktopMenuCollapsed, setDesktopMenuCollapsed } = useStaff();
  // Same list the pages use to allow/redirect, so the sidebar never offers a page that bounces you back.
  const canOpen = (page: PageRoute) => canAccessPage(staff.role, page);
  const waitingForPerson = useWaitingForPersonCount(canOpen("/dashboard/chat"));

  return (
    <>
      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-50 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Main Sidebar (Desktop Sticky + Mobile Drawer) */}
      <aside className={`print:hidden bg-[#0A1017] text-white flex-col border-r border-[#1C2633] shrink-0 z-50
        fixed inset-y-0 left-0 md:sticky top-0 h-screen transition-all duration-300 ease-in-out flex
        ${desktopMenuCollapsed ? 'w-[260px] md:w-[72px] px-2 py-4' : 'w-[260px] md:w-[240px] p-4'}
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className={`flex items-center py-2 mb-4 ${desktopMenuCollapsed ? 'justify-center px-0' : 'justify-between px-2'}`}>
          <div className="flex items-center gap-3 overflow-hidden">
            {logoUrl && failedLogoUrl !== logoUrl ? (
              <img
                src={logoUrl}
                alt={restaurantName}
                onError={() => setFailedLogoUrl(logoUrl)}
                className="w-10 h-10 rounded-[10px] object-cover bg-white shadow-[0_4px_12px_rgba(0,0,0,0.3)] shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-[10px] bg-gradient-to-br from-[#E23744] to-[#B0202B] text-white font-[Fraunces] text-xl font-bold grid place-items-center shadow-[0_4px_12px_rgba(226,55,68,0.3)] shrink-0">
                {restaurantName.trim().charAt(0).toUpperCase() || "P"}
              </div>
            )}
            {!desktopMenuCollapsed && (
              <div className="flex flex-col overflow-hidden">
                <span className="text-[18px] font-extrabold tracking-[-0.5px] leading-none text-white whitespace-nowrap truncate">{restaurantName}</span>
                <span className="text-[9px] tracking-[2px] text-[#A1B2C6] mt-1 font-bold uppercase whitespace-nowrap truncate">
                  {staff.role === 'admin' ? 'Admin Dashboard' : 
                   staff.role === 'kitchen' ? 'Kitchen Dashboard' :
                   staff.role === 'counter' ? 'Counter Dashboard' :
                   staff.role === 'waiter' ? 'Waiter Dashboard' : 'Staff Dashboard'}
                </span>
              </div>
            )}
          </div>
          <button 
            onClick={() => setMobileMenuOpen(false)} 
            className="md:hidden text-[#8799AF] hover:text-white p-2 -mr-2 shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <nav className="flex flex-col gap-1.5 flex-1 overflow-y-auto overflow-x-hidden pr-0.5 pb-4 scrollbar-hide">
          {canOpen("/dashboard/orders") && (
            <SidebarLink href="/dashboard" label="Orders" icon="🧾" active={pathname === "/dashboard"} collapsed={desktopMenuCollapsed} />
          )}
          {canOpen("/dashboard/kitchen") && (
            <SidebarLink href="/dashboard/kitchen" label="Kitchen" icon="🍳" active={pathname === "/dashboard/kitchen"} collapsed={desktopMenuCollapsed} />
          )}
          {canOpen("/dashboard/pos") && (
            <SidebarLink href="/dashboard/pos" label="POS" icon="💻" active={pathname === "/dashboard/pos"} collapsed={desktopMenuCollapsed} />
          )}
          {canOpen("/dashboard/tables") && (
            <SidebarLink href="/dashboard/tables" label="Tables" icon="🍽️" active={pathname === "/dashboard/tables"} collapsed={desktopMenuCollapsed} />
          )}
          {canOpen("/dashboard/chat") && (
            <SidebarLink href="/dashboard/chat" label="Live Chat" icon="💬" active={pathname === "/dashboard/chat"} collapsed={desktopMenuCollapsed} badge={waitingForPerson} />
          )}
          {canOpen("/dashboard/menu") && (
            <SidebarLink href="/dashboard/menu" label="Menu" icon="📋" active={pathname === "/dashboard/menu"} collapsed={desktopMenuCollapsed} />
          )}
          {canOpen("/dashboard/riders") && (
            <SidebarLink href="/dashboard/riders" label="Riders" icon="🛵" active={pathname === "/dashboard/riders"} collapsed={desktopMenuCollapsed} />
          )}
          {canOpen("/dashboard/stats") && (
            <SidebarLink href="/dashboard/stats" label="Analytics" icon="📊" active={pathname === "/dashboard/stats"} collapsed={desktopMenuCollapsed} />
          )}
          {canOpen("/dashboard/contacts") && (
            <SidebarLink href="/dashboard/contacts" label="Contacts" icon="👥" active={pathname === "/dashboard/contacts"} collapsed={desktopMenuCollapsed} />
          )}
          {canOpen("/dashboard/blast") && (
            <SidebarLink href="/dashboard/blast" label="Blast" icon="📣" active={pathname === "/dashboard/blast"} collapsed={desktopMenuCollapsed} />
          )}
          {canOpen("/dashboard/settings") && (
            <SidebarLink href="/dashboard/settings" label="Settings" icon="⚙️" active={pathname === "/dashboard/settings"} collapsed={desktopMenuCollapsed} />
          )}
        </nav>

        <div className="mt-auto flex flex-col gap-1.5 border-t border-[#1C2633] pt-3">
          <button 
            onClick={() => setDesktopMenuCollapsed(!desktopMenuCollapsed)} 
            className="hidden md:flex items-center justify-center p-2 mb-1 rounded-xl text-[#8799AF] hover:text-white hover:bg-[#111923] transition-colors"
            title={desktopMenuCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-300 ${desktopMenuCollapsed ? 'rotate-180' : ''}`}>
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          
          <SidebarButton onClick={() => { void refreshOrders(); setMobileMenuOpen(false); }} icon="↻" label="Refresh Now" collapsed={desktopMenuCollapsed} />
          <SidebarButton onClick={toggleSound} icon={soundEnabled ? "🔕" : "🔔"} label={soundEnabled ? "Disable sound" : "Enable sound"} collapsed={desktopMenuCollapsed} />
          <SidebarButton 
            onClick={async () => {
              await supabase.auth.signOut();
              router.push("/dashboard/login");
            }} 
            icon="🚪" 
            label="Sign out"
            collapsed={desktopMenuCollapsed}
          />
        </div>
      </aside>
    </>
  );
}

/** Chats where the customer asked for a person and the AI is still paused (polled every 20s). */
function useWaitingForPersonCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let active = true;
    const load = async () => {
      const { count: c } = await supabase
        .from("chat_sessions")
        .select("id", { count: "exact", head: true })
        .eq("ai_enabled", false)
        .eq("ai_disabled_by", "customer_request");
      if (active) setCount(c ?? 0);
    };
    void load();
    const timer = window.setInterval(load, 20000);
    return () => { active = false; window.clearInterval(timer); };
  }, [enabled]);
  return count;
}

function SidebarLink({ href, label, icon, active = false, collapsed = false, badge = 0 }: { href: string; label: string; icon: string; active?: boolean; collapsed?: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      title={label}
      className={`relative flex items-center rounded-[10px] font-bold text-[13px] transition-all duration-200 overflow-hidden ${
        collapsed ? 'justify-center px-0 py-2.5 w-full' : 'px-3 py-2.5 gap-3'
      } ${
        active 
          ? 'bg-[#17212D] text-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] border border-[#233142]' 
          : 'text-[#8799AF] hover:bg-[#111923] hover:text-[#C7D3E1] border border-transparent'
      }`}
    >
      <span className="text-[15px] opacity-80 shrink-0">{icon}</span>
      {!collapsed && <span className="whitespace-nowrap truncate">{label}</span>}
      {badge > 0 && (
        <span title={`${badge} customer(s) asked for a person`} className={`${collapsed ? "absolute top-1 right-1" : "ml-auto"} min-w-[18px] h-[18px] px-1 rounded-full bg-[#E23744] text-white text-[10px] font-extrabold grid place-items-center`}>
          {badge}
        </span>
      )}
      {active && <span className={`absolute left-0 w-1 rounded-r bg-[#E23744] ${collapsed ? 'h-5' : 'h-6'}`} />}
    </Link>
  );
}

function SidebarButton({ onClick, label, icon, collapsed = false }: { onClick: () => void; label: string; icon: string; collapsed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex items-center rounded-[10px] font-bold text-[13px] text-[#8799AF] hover:bg-[#111923] hover:text-[#C7D3E1] transition-all border border-transparent overflow-hidden ${
        collapsed ? 'justify-center px-0 py-2.5 w-full' : 'px-3 py-2.5 gap-3 text-left w-full'
      }`}
    >
      <span className="text-[15px] opacity-80 shrink-0">{icon}</span>
      {!collapsed && <span className="whitespace-nowrap truncate">{label}</span>}
    </button>
  );
}
