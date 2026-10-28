"use server";

import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/auth/staff";
import type { StaffRole } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SETTING_KEYS, isValidTime, parseOrderTypes, type RawSettings, type SettingKey } from "@/lib/settings";
import { setUndoPasscode } from "@/lib/settings/passcode";

type ActionResult = { success: true } | { success: false; error: string };

const STAFF_ROLES: StaffRole[] = ["admin", "counter", "waiter", "kitchen"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GSTIN_RE = /^\d{2}[A-Z0-9]{13}$/;

const fail = (error: string): ActionResult => ({ success: false, error });

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message.replace(/^(Unauthorized|Forbidden): /, "") : "Something went wrong.";
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const MAX_LENGTH: Partial<Record<SettingKey, number>> = {
  restaurant_name: 80,
  tagline: 120,
  address: 300,
  phone: 30,
  city: 60,
  logo_url: 500,
  hours: 120,
  delivery_note: 200,
  payment_methods: 200,
  unknown_policy: 600,
  google_review_url: 500,
};

const AMOUNT_KEYS: SettingKey[] = ["min_order", "delivery_fee", "free_delivery_above"];
const BOOLEAN_KEYS: SettingKey[] = ["orders_paused", "auto_print"];

/** Validates and normalises a partial settings patch. Returns an error message or the clean rows. */
function validateSettingsPatch(patch: Partial<RawSettings>): { error: string } | { rows: Array<{ key: SettingKey; value: string }> } {
  const rows: Array<{ key: SettingKey; value: string }> = [];

  for (const [key, rawValue] of Object.entries(patch)) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) return { error: `Unknown setting: ${key}` };
    if (typeof rawValue !== "string") return { error: `Invalid value for ${key}` };
    const k = key as SettingKey;
    let value = rawValue.trim();

    const max = MAX_LENGTH[k];
    if (max && value.length > max) return { error: `${k.replace(/_/g, " ")} is too long (max ${max} characters).` };

    if (k === "restaurant_name" && !value) return { error: "Restaurant name is required." };
    if ((k === "logo_url" || k === "google_review_url") && value && !isHttpsUrl(value)) {
      return { error: `${k === "logo_url" ? "Logo" : "Google review link"} must be a valid https:// link.` };
    }
    if (k === "phone" && value && !/^[+\d][\d\s()-]{5,}$/.test(value)) return { error: "Enter a valid phone number." };
    if (k === "gst_percent") {
      const n = Number(value || 0);
      if (!Number.isFinite(n) || n < 0 || n > 28) return { error: "GST % must be between 0 and 28." };
      value = String(n);
    }
    if (k === "gstin") {
      value = value.toUpperCase();
      if (value && !GSTIN_RE.test(value)) return { error: "GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5." };
    }
    if ((k === "open_time" || k === "close_time") && value && !isValidTime(value)) return { error: "Enter opening hours as HH:MM." };
    if (AMOUNT_KEYS.includes(k)) {
      const n = Number(value || 0);
      if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: `${k.replace(/_/g, " ")} must be a whole amount in ₹.` };
      value = String(n);
    }
    if (BOOLEAN_KEYS.includes(k) && value !== "true" && value !== "false") return { error: `Invalid value for ${k}` };
    if (k === "order_types") {
      const types = parseOrderTypes(value);
      if (!types.delivery && !types.takeaway && !types.dineIn) {
        return { error: "Keep at least one order type on. Use \"Pause orders\" to stop all orders." };
      }
    }

    rows.push({ key: k, value });
  }

  const open = rows.find((r) => r.key === "open_time");
  const close = rows.find((r) => r.key === "close_time");
  if (open && close && Boolean(open.value) !== Boolean(close.value)) return { error: "Set both opening and closing time, or leave both blank." };
  if (open && close && open.value && open.value === close.value) return { error: "Opening and closing time can't be the same." };

  return { rows };
}

export async function saveSettings(patch: Partial<RawSettings>): Promise<ActionResult> {
  try {
    await authorize("settings");
    const result = validateSettingsPatch(patch);
    if ("error" in result) return fail(result.error);
    if (result.rows.length === 0) return { success: true };

    const now = new Date().toISOString();
    const { error } = await createAdminClient()
      .from("settings")
      .upsert(result.rows.map((r) => ({ ...r, updated_at: now })), { onConflict: "key" });
    if (error) return fail("Could not save settings. Please try again.");

    // Dashboard layout passes settings (auto-print, bill header) to every page.
    revalidatePath("/dashboard", "layout");
    return { success: true };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

export async function changeUndoPasscode(pin: string): Promise<ActionResult> {
  try {
    await authorize("settings");
    if (!/^\d{4}$/.test(pin)) return fail("Passcode must be exactly 4 digits.");
    await setUndoPasscode(pin);
    revalidatePath("/dashboard/settings");
    return { success: true };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

/* ---------------- Delivery pincodes ---------------- */

export async function addPincode(pincode: string, area: string): Promise<ActionResult> {
  try {
    await authorize("settings");
    const pin = String(pincode ?? "").trim();
    const areaName = String(area ?? "").trim().slice(0, 80);
    if (!/^\d{6}$/.test(pin)) return fail("Enter a valid 6-digit pincode.");

    const { error } = await createAdminClient()
      .from("delivery_pincodes")
      .upsert({ pincode: pin, area: areaName, active: true }, { onConflict: "pincode" });
    if (error) return fail("Could not add that pincode.");

    revalidatePath("/dashboard/settings");
    return { success: true };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

export async function removePincode(pincode: string): Promise<ActionResult> {
  try {
    await authorize("settings");
    const { error } = await createAdminClient().from("delivery_pincodes").delete().eq("pincode", String(pincode));
    if (error) return fail("Could not remove that pincode.");
    revalidatePath("/dashboard/settings");
    return { success: true };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

/* ---------------- Staff & roles ---------------- */

async function findAuthUserId(email: string): Promise<string | null> {
  const admin = createAdminClient();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("Could not look up logins.");
    const users: Array<{ id: string; email?: string }> = data?.users ?? [];
    const match = users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match.id;
    if (users.length < 200) return null;
  }
  return null;
}

async function activeAdminCount(): Promise<number> {
  const { count } = await createAdminClient()
    .from("staff_members")
    .select("email", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("is_active", true);
  return count ?? 0;
}

async function getStaffRow(email: string) {
  const { data } = await createAdminClient()
    .from("staff_members")
    .select("email, role, is_active")
    .eq("email", email)
    .maybeSingle();
  return data as { email: string; role: StaffRole; is_active: boolean } | null;
}

function validatePassword(password: string) {
  if (typeof password !== "string" || password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 72) return "Password is too long.";
  return null;
}

export async function addStaff(input: { name: string; email: string; role: StaffRole; password: string }): Promise<ActionResult> {
  try {
    await authorize("settings");
    const name = String(input.name ?? "").trim().slice(0, 60);
    const email = String(input.email ?? "").trim().toLowerCase();
    const role = input.role;

    if (!name) return fail("Name is required.");
    if (!EMAIL_RE.test(email)) return fail("Enter a valid email address.");
    if (!STAFF_ROLES.includes(role)) return fail("Choose a valid role.");
    const passwordError = validatePassword(input.password);
    if (passwordError) return fail(passwordError);

    if (await getStaffRow(email)) return fail("This email is already a staff member.");

    const admin = createAdminClient();
    let createdUserId: string | null = null;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: { display_name: name },
    });

    if (createError) {
      // Login already exists (e.g. a removed staff member coming back) — reuse it with the new password.
      const existingId = await findAuthUserId(email);
      if (!existingId) return fail(createError.message || "Could not create the login.");
      const { error: updateError } = await admin.auth.admin.updateUserById(existingId, {
        password: input.password,
        email_confirm: true,
        user_metadata: { display_name: name },
      });
      if (updateError) return fail("Could not update the existing login.");
    } else {
      createdUserId = created?.user?.id ?? null;
    }

    const { error: insertError } = await admin
      .from("staff_members")
      .insert({ email, name, role, is_active: true });

    if (insertError) {
      if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
      return fail("Could not add the staff member.");
    }

    revalidatePath("/dashboard/settings");
    return { success: true };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

export async function updateStaff(emailInput: string, changes: { role?: StaffRole; is_active?: boolean }): Promise<ActionResult> {
  try {
    const me = await authorize("settings");
    const email = String(emailInput ?? "").trim().toLowerCase();
    const row = await getStaffRow(email);
    if (!row) return fail("Staff member not found.");

    const update: { role?: StaffRole; is_active?: boolean } = {};
    if (changes.role !== undefined) {
      if (!STAFF_ROLES.includes(changes.role)) return fail("Choose a valid role.");
      update.role = changes.role;
    }
    if (changes.is_active !== undefined) update.is_active = Boolean(changes.is_active);

    const isSelf = email === me.email.toLowerCase();
    if (isSelf && update.role && update.role !== "admin") return fail("You can't remove your own admin role.");
    if (isSelf && update.is_active === false) return fail("You can't take yourself off duty.");

    const losesAdmin = row.role === "admin" && row.is_active && ((update.role && update.role !== "admin") || update.is_active === false);
    if (losesAdmin && (await activeAdminCount()) <= 1) return fail("At least one active admin is required.");

    const { error } = await createAdminClient().from("staff_members").update(update).eq("email", email);
    if (error) return fail("Could not update the staff member.");

    revalidatePath("/dashboard/settings");
    return { success: true };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

export async function removeStaff(emailInput: string): Promise<ActionResult> {
  try {
    const me = await authorize("settings");
    const email = String(emailInput ?? "").trim().toLowerCase();
    if (email === me.email.toLowerCase()) return fail("You can't remove yourself.");

    const row = await getStaffRow(email);
    if (!row) return fail("Staff member not found.");
    if (row.role === "admin" && row.is_active && (await activeAdminCount()) <= 1) {
      return fail("At least one active admin is required.");
    }

    const admin = createAdminClient();
    const { error } = await admin.from("staff_members").delete().eq("email", email);
    if (error) return fail("Could not remove the staff member.");

    // Staff logins are only used for the dashboard (customers sign in via WhatsApp),
    // so the login is deleted too and the old password stops working everywhere.
    const userId = await findAuthUserId(email);
    if (userId) await admin.auth.admin.deleteUser(userId);

    revalidatePath("/dashboard/settings");
    return { success: true };
  } catch (err) {
    return fail(errorMessage(err));
  }
}

export async function resetStaffPassword(emailInput: string, password: string): Promise<ActionResult> {
  try {
    await authorize("settings");
    const email = String(emailInput ?? "").trim().toLowerCase();
    const passwordError = validatePassword(password);
    if (passwordError) return fail(passwordError);
    if (!(await getStaffRow(email))) return fail("Staff member not found.");

    const admin = createAdminClient();
    const userId = await findAuthUserId(email);
    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return fail("Could not reset the password.");
    } else {
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return fail("Could not create a login for this staff member.");
    }
    return { success: true };
  } catch (err) {
    return fail(errorMessage(err));
  }
}
