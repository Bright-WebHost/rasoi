import crypto from 'node:crypto'

export const YCloudReplayToleranceMs = 5 * 60 * 1000
export const YCloudSupportedEvents = new Set([
  'whatsapp.inbound_message.received',
  'whatsapp.message.updated',
])

export type YCloudEvent = {
  id: string
  type: string
  [key: string]: unknown
}

export function verifyYCloudSignature(rawBody: string, header: string, secret: string, now = Date.now()): boolean {
  let timestamp = ''
  let signature = ''
  for (const part of header.split(',')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key === 't') timestamp = value
    if (key === 's') signature = value
  }
  if (!/^\d+$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) return false
  const timestampMs = Number(timestamp) * 1000
  if (!Number.isSafeInteger(timestampMs) || Math.abs(now - timestampMs) > YCloudReplayToleranceMs) return false
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest()
  const supplied = Buffer.from(signature, 'hex')
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied)
}

export function parseYCloudEvent(rawBody: string): { event?: YCloudEvent; messageId?: string; error?: string } {
  let value: unknown
  try { value = JSON.parse(rawBody) } catch { return { error: 'invalid_json' } }
  if (!value || typeof value !== 'object') return { error: 'invalid_event' }
  const body = value as Record<string, unknown>
  if (typeof body.id !== 'string' || !body.id.trim() || typeof body.type !== 'string' || !body.type.trim()) return { error: 'missing_event_id_or_type' }
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {}
  const message = (body.whatsappInboundMessage || body.whatsappMessage || data.whatsappInboundMessage || data.whatsappMessage || body.message || data.message || {}) as Record<string, unknown>
  const messageId = typeof message.id === 'string' && message.id.trim() ? message.id.trim() : undefined
  if (body.type === 'whatsapp.inbound_message.received' && !messageId) return { error: 'missing_message_id' }
  return { event: body as YCloudEvent, messageId }
}

type InboxAdminClient = {
  from(table: 'ycloud_event_inbox'): {
    upsert(row: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates: boolean }): Promise<{ error: unknown | null }>
  }
}

export async function persistYCloudEvent(admin: InboxAdminClient, event: YCloudEvent, messageId: string | undefined): Promise<{ error: unknown | null; duplicate: boolean }> {
  const { error } = await admin.from('ycloud_event_inbox').upsert({
    provider_event_id: event.id,
    event_type: event.type,
    provider_message_id: messageId ?? null,
    payload: event,
    status: 'pending',
  }, { onConflict: 'provider_event_id', ignoreDuplicates: true })
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (code === '23505') return { error: null, duplicate: true }
  return { error, duplicate: false }
}
