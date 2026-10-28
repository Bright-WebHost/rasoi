/**
 * Supabase admin client — uses the service-role key.
 *
 * ONLY import this in server-side code (API routes, Server Actions).
 * Never expose the service-role key to the browser.
 *
 * The admin client is intentionally typed as `any` to avoid type inference
 * issues with custom table names (ordering_sessions) that are not in
 * Supabase's default Database type. All call sites manually type-assert
 * their return values for safety.
 */

import { createClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adminClient: any = null

export function createAdminClient() {
  if (adminClient) return adminClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()

  if (!url || !serviceKey || !url.startsWith('http')) {
    console.error('Missing Supabase Config. URL:', !!url, 'Key:', !!serviceKey)
    throw new Error('Supabase server configuration is incomplete.')
  }

  adminClient = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return adminClient
}
