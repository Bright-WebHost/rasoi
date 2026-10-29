import { timingSafeEqual } from 'crypto'

/**
 * Shared secret for server-to-server calls inside the app (e.g. the YCloud webhook
 * calling the rider accept/decline/deliver routes). Read from the environment only;
 * never hard-code it and never log it.
 */
export function internalSecret(): string {
  return (process.env.RASOI_WHATSAPP_INBOUND_SECRET || process.env.RASOI_AI_WEBHOOK_SECRET || process.env.RASOI_N8N_WEBHOOK_SECRET || '').trim()
}

export const INTERNAL_SECRET_HEADER = 'x-rasoi-whatsapp-secret'

/** Constant-time comparison for configured server-to-server secrets. */
export function timingSafeSecretEquals(provided: string | null | undefined, expected: string | null | undefined): boolean {
  const supplied = Buffer.from((provided ?? '').trim(), 'utf8')
  const configured = Buffer.from((expected ?? '').trim(), 'utf8')
  return supplied.length > 0 && configured.length > 0 && supplied.length === configured.length && timingSafeEqual(supplied, configured)
}

/** True only if the secret is configured and the request carries it. Fails closed. */
export function isInternalRequest(request: Request): boolean {
  const expected = internalSecret()
  const provided = request.headers.get(INTERNAL_SECRET_HEADER)?.trim() || ''
  return timingSafeSecretEquals(provided, expected)
}
