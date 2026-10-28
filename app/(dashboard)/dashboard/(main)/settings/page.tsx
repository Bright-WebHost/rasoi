import { requirePage } from "@/lib/auth/staff";
import type { StaffRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeliveryPincodes, getRawSettings } from "@/lib/settings/server";
import { isDefaultUndoPasscode } from "@/lib/settings/passcode";
import SettingsBoard, { type StaffMemberRow } from "./SettingsBoard";

export default async function SettingsPage() {
  const me = await requirePage("/dashboard/settings");

  const [settings, pincodes, staffResult, defaultPasscode] = await Promise.all([
    getRawSettings(),
    getDeliveryPincodes(),
    createAdminClient().from("staff_members").select("email, name, role, is_active, created_at").order("created_at"),
    isDefaultUndoPasscode().catch(() => false),
  ]);

  const staff: StaffMemberRow[] = (staffResult.data ?? []).map((s: { email: string; name: string | null; role: StaffRole; is_active: boolean | null }) => ({
    email: s.email,
    name: s.name ?? "",
    role: s.role,
    is_active: s.is_active !== false,
  }));

  return (
    <SettingsBoard
      initialSettings={settings}
      pincodes={pincodes}
      staff={staff}
      currentEmail={me.email.toLowerCase()}
      isDefaultPasscode={defaultPasscode}
    />
  );
}
