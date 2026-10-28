"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { StaffUser } from "@/lib/auth/staff";
import { FeaturePermission, hasPermission } from "@/lib/auth/permissions";
import { usePathname } from "next/navigation";

interface StaffContextType {
  staff: StaffUser;
  hasPerm: (permission: FeaturePermission) => boolean;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  desktopMenuCollapsed: boolean;
  setDesktopMenuCollapsed: (collapsed: boolean) => void;
}

const StaffContext = createContext<StaffContextType | null>(null);

export function StaffProvider({ staff, children }: { staff: StaffUser; children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopMenuCollapsed, setDesktopMenuCollapsed] = useState(false);
  const pathname = usePathname();

  // Close mobile menu on route change, but not desktop
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <StaffContext.Provider value={{ 
      staff, 
      hasPerm: (perm) => hasPermission(staff.role, perm),
      mobileMenuOpen,
      setMobileMenuOpen,
      desktopMenuCollapsed,
      setDesktopMenuCollapsed
    }}>
      {children}
    </StaffContext.Provider>
  );
}

export function useStaff() {
  const context = useContext(StaffContext);
  if (!context) {
    throw new Error("useStaff must be used within a StaffProvider");
  }
  return context;
}
