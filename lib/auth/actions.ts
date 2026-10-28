/**
 * Auth / Session actions.
 *
 * This module provides utilities for:
 *  - Indian phone number validation (kept from original implementation)
 *  - Session-based sign out
 *
 * The Supabase OTP functions (sendOtp, verifyOtp) have been removed.
 * Authentication is now handled via the WhatsApp-linked ordering session
 * flow (see /api/session/* routes).
 */

export interface PhoneValidation {
  isValid: boolean
  formatted: string // +91XXXXXXXXXX
  display: string   // 98765 43210
  error?: string
}

/**
 * Validates and formats Indian 10-digit mobile numbers (+91).
 */
export function validateIndianPhone(input: string): PhoneValidation {
  // Remove whitespace, dashes, brackets, and leading '+'
  const cleaned = input.replace(/[\s\-()]/g, '')
  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned

  // Remove leading 91 or 0 if present and total length exceeds 10
  if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2)
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.slice(1)
  }

  // Indian numbers must be exactly 10 digits and start with 6, 7, 8, or 9
  const indianMobileRegex = /^[6-9]\d{9}$/
  if (!indianMobileRegex.test(digits)) {
    return {
      isValid: false,
      formatted: '',
      display: digits,
      error: 'Please enter a valid 10-digit Indian mobile number (e.g. 98765 43210).',
    }
  }

  const formatted = `+91${digits}`
  const display = `${digits.slice(0, 5)} ${digits.slice(5)}`

  return {
    isValid: true,
    formatted,
    display,
  }
}

/**
 * Signs the customer out by clearing the ordering session cookie.
 */
export async function signOut(): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/session/me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signout' }),
    })
    const data = await res.json()
    if (!res.ok) {
      return { success: false, error: data.error || 'Sign out failed.' }
    }
    return { success: true }
  } catch {
    return { success: false, error: 'Network error during sign out.' }
  }
}
