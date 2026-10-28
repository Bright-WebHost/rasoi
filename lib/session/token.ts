/**
 * Ordering Session — Token utilities
 *
 * Handles generation of cryptographically secure tokens
 * and SHA-256 hashing for server-side storage.
 *
 * These functions are server-only.
 */

import { randomBytes, createHash } from 'crypto'

/** Default token lifetime in seconds (5 minutes). */
export const TOKEN_TTL_SECONDS = 300

/**
 * Generates a cryptographically secure random token.
 * Returns a URL-safe base64 string (48 random bytes → 64 chars).
 */
export function generateToken(): string {
  return randomBytes(48).toString('base64url')
}

/**
 * Produces a SHA-256 hex digest of the raw token.
 * Only the hash is stored server-side — the raw token is never persisted.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}
