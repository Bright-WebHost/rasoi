import { createClient } from "@/lib/supabase/server";
import { StaffRole, FeaturePermission, PageRoute, hasPermission, canAccessPage } from "./permissions";
import { redirect, unstable_rethrow } from "next/navigation";
import { cache } from "react";

export interface StaffUser {
  id: string;
  email: string;
  role: StaffRole;
}

// Cache the lookup per request so it only hits the DB once
export const getStaffSession = cache(async (): Promise<StaffUser | null> => {
  try {
    const supabase = await createClient();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session?.user) {
      return null;
    }

    // Call the updated staff_check RPC which returns { staff, email, role }
    const result = await supabase.rpc("staff_check");
    const data = result.data as any;
    const error = result.error;
    
    if (error || !data || data.staff !== true || !data.role) {
      return null;
    }

    return {
      id: session.user.id,
      email: data.email,
      role: data.role as StaffRole,
    };
  } catch (err) {
    // Let Next.js internals (dynamic-rendering bailout, redirects) propagate instead of logging them.
    unstable_rethrow(err);
    console.error("Error in getStaffSession:", err);
    return null;
  }
});

// For Server Actions any signed-in staff member may call
export async function requireStaff(): Promise<StaffUser> {
  const staff = await getStaffSession();
  if (!staff) {
    throw new Error("Unauthorized: Please log in.");
  }
  return staff;
}

// For Server Actions
export async function authorize(permission: FeaturePermission): Promise<StaffUser> {
  const staff = await getStaffSession();
  
  if (!staff) {
    throw new Error("Unauthorized: Please log in.");
  }
  
  if (!hasPermission(staff.role, permission)) {
    throw new Error(`Forbidden: You do not have permission to ${permission}`);
  }
  
  return staff;
}

// For Server Components (Pages)
export async function requirePage(page: PageRoute): Promise<StaffUser> {
  const staff = await getStaffSession();
  
  if (!staff) {
    redirect("/login");
  }
  
  if (!canAccessPage(staff.role, page)) {
    // If they don't have access to this page, redirect them to the first page they DO have access to
    if (staff.role === "kitchen") {
      redirect("/dashboard/kitchen");
    } else if (staff.role === "waiter") {
      redirect("/dashboard/pos");
    } else {
      redirect("/dashboard/orders");
    }
  }
  
  return staff;
}
