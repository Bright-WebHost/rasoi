import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The undo passcode lives hashed in `settings_private`, which only the
 * service role can read. Until an admin sets one, the old default "0000"
 * keeps working so existing behaviour doesn't change.
 */
const KEY = "undo_passcode_hash";
export const DEFAULT_UNDO_PASSCODE = "0000";

function hash(pin: string, salt = randomBytes(16).toString("hex")) {
  return `scrypt$${salt}$${scryptSync(pin, salt, 32).toString("hex")}`;
}

async function getStoredHash(): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("settings_private")
    .select("value")
    .eq("key", KEY)
    .maybeSingle();
  if (error) {
    // Table not created yet (migration pending) → behave as "no custom passcode".
    // Any other failure must not silently fall back to the default PIN.
    if (error.code === "PGRST205" || error.code === "42P01") return null;
    throw new Error("Could not check the passcode. Please try again.");
  }
  return data?.value || null;
}

export async function isDefaultUndoPasscode() {
  return (await getStoredHash()) === null;
}

export async function verifyUndoPasscode(pin: string) {
  if (!/^\d{4}$/.test(pin)) return false;
  const stored = await getStoredHash();
  if (!stored) return pin === DEFAULT_UNDO_PASSCODE;

  const [, salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  const actual = scryptSync(pin, salt, 32);
  const expectedBuf = Buffer.from(expected, "hex");
  return expectedBuf.length === actual.length && timingSafeEqual(actual, expectedBuf);
}

export async function setUndoPasscode(pin: string) {
  const { error } = await createAdminClient()
    .from("settings_private")
    .upsert({ key: KEY, value: hash(pin), updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
