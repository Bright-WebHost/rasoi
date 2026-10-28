import { timingSafeEqual } from 'crypto'

/**
 * Shared secret for server-to-server calls inside the app (e.g. the YCloud webhook
 * calling the rider accept/decline/deliver routes). Read from the environment only;
 * never hard-code it and never log it.
 */
export function internalSecret(): string {
  return (process.env.PABBAS_WHATSAPP_INBOUND_SECRET || process.env.PABBAS_AI_WEBHOOK_SECRET || process.env.PABBAS_N8N_WEBHOOK_SECRET || '').trim()
}

export const INTERNAL_SECRET_HEADER = 'x-pabbas-whatsapp-secret'

/** True only if the secret is configured and the request carries it. Fails closed. */
export function isInternalRequest(request: Request): boolean {
  const expected = internalSecret()
  const provided = request.headers.get(INTERNAL_SECRET_HEADER)?.trim() || ''
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
