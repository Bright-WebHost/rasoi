import { createClient } from "@/lib/supabase/client";

let redirecting = false;

/**
 * Called when a dashboard request fails in a way that may mean the login expired
 * (Supabase 401/42501, or a server action that got redirected to /dashboard/login).
 * Confirms with Supabase Auth first, so a flaky network never logs anyone out.
 * Returns true if the session is gone and the browser is being sent to the login page.
 */
export async function redirectIfSessionExpired(): Promise<boolean> {
  if (redirecting) return true;
  try {
    const { data, error } = await createClient().auth.getUser();
    if (data?.user && !error) return false;
    // Couldn't reach Supabase Auth (offline, timeout) — not proof the session expired.
    if (error && (error.name === "AuthRetryableFetchError" || !error.status)) return false;
  } catch {
    // Auth server unreachable → treat as a network problem, not an expired session.
    return false;
  }
  redirecting = true;
  window.location.href = "/dashboard/login?error=session_expired";
  return true;
}

/** Supabase errors that mean "no valid user token" rather than a real failure. */
export function isAuthError(error: { code?: string; status?: number; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42501" || error.code === "PGRST301" || error.status === 401 || /jwt|permission denied/i.test(error.message ?? "");
}
