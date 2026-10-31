"use server";

import { authorize } from "@/lib/auth/staff";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function setContactBlocked(phone: string, blocked: boolean) {
  await authorize("contacts");

  const normalizedPhone = String(phone || "").replace(/\D/g, "");
  if (normalizedPhone.length < 10 || normalizedPhone.length > 15 || typeof blocked !== "boolean") {
    return { success: false, error: "Invalid contact update." };
  }

  try {
    const { data, error } = await createAdminClient()
      .from("customers")
      .update({ is_blocked: blocked })
      .eq("phone", normalizedPhone)
      .select("phone")
      .maybeSingle();

    if (error) {
      console.error("setContactBlocked error:", error.message);
      return { success: false, error: "Could not update this contact." };
    }
    if (!data) return { success: false, error: "Contact not found." };

    return { success: true };
  } catch (error) {
    console.error("setContactBlocked error:", error);
    return { success: false, error: "Could not update this contact." };
  }
}

export async function importContacts(text: string) {
  await authorize("contacts");

  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    const adminClient = createAdminClient();
    
    // Verify staff
    const { data: staffData } = await adminClient
      .from("staff_members")
      .select("name")
      .eq("email", session.user.email)
      .maybeSingle();

    if (!staffData) {
      return { success: false, error: "Not a staff member" };
    }

    // Clean numbers logic ported from reference
    const raw = String(text || "").split(/[\s,;]+/).filter(Boolean);
    const seen: Record<string, boolean> = {};
    const rows: { phone: string; source: string }[] = [];

    const cleanNum = (rawStr: string) => {
      const p = String(rawStr || "").replace(/[^0-9]/g, "");
      if (!p) return "";
      if (p.length === 11 && p[0] === "0") return "91" + p.slice(1);
      if (p.length === 10 && "6789".includes(p[0])) return "91" + p;
      if (p.length === 12 && p.slice(0, 2) === "91") return p;
      return p.length >= 10 ? p : "";
    };

    raw.forEach((r) => {
      const p = cleanNum(r);
      if (p && !seen[p]) {
        seen[p] = true;
        rows.push({ phone: p, source: "import" });
      }
    });

    if (!rows.length) {
      return { success: false, error: "No valid Indian mobile numbers found." };
    }

    // Upsert into customers table
    const { error } = await adminClient
      .from("customers")
      .upsert(rows, { onConflict: "phone", ignoreDuplicates: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, count: rows.length };
  } catch (err: any) {
    console.error("importContacts error:", err);
    return { success: false, error: err.message || "Failed to import contacts" };
  }
}
