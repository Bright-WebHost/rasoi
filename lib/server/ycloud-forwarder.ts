// Forwards accepted YCloud inbox rows to the Rasoi workflow. Rider completion buttons
// bypass customer AI and go straight to the protected delivery status endpoint.
// Delivery is at-least-once: consumers must treat x-rasoi-event-id as an idempotency key.

export type ForwarderConfig = { url: string; secret: string; appBaseUrl: string }

type InboxRow = { id: string; provider_event_id: string; attempts: number; payload: unknown }
type ForwarderAdminClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown | null }>
  from(table: 'ycloud_message_status_events'): {
    upsert(row: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates: boolean }): Promise<{ error: unknown | null }>
  }
}

// Disabled unless explicitly enabled, so deploying this code changes nothing by itself.
export function forwarderConfig(env: Record<string, string | undefined> = process.env): ForwarderConfig | null {
  if (env.RASOI_WHATSAPP_FORWARDING_ENABLED?.trim() !== 'true') return null
  const url = env.N8N_WHATSAPP_INBOUND_WEBHOOK_URL?.trim() || ''
  const secret = env.RASOI_WHATSAPP_INBOUND_SECRET?.trim() || ''
  if (!url.startsWith('https://') || !secret) return null
  return { url, secret, appBaseUrl: env.NEXT_PUBLIC_SITE_URL?.trim() || '' }
}

type RiderDeliveryAction =
  | { recognized: false }
  | { recognized: true; error: string }
  | { recognized: true; order_number: string; rider_phone: string; payment_status: 'collected' | 'unpaid' }

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Identify rider completion buttons before an inbound event reaches the customer AI workflow. */
export function riderDeliveryAction(payloadValue: unknown): RiderDeliveryAction {
  const payload = asObject(payloadValue)
  const data = asObject(payload.data)
  const message = asObject(
    payload.whatsappInboundMessage || payload.whatsappMessage || payload.message ||
      data.whatsappInboundMessage || data.whatsappMessage || data.message,
  )
  const interactive = asObject(message.interactive)
  const buttonReply = asObject(interactive.button_reply)
  const listReply = asObject(interactive.list_reply)
  const rawText = asObject(message.text).body
  const rawContent = buttonReply.id || listReply.id || rawText || message.body
  const content = typeof rawContent === 'string' ? rawContent.trim() : ''
  const match = /^deliver_(collected|unpaid)_(.+)$/i.exec(content)
  if (!match) return { recognized: false }

  const sender = asObject(message.sender)
  const rawPhone = message.from || sender.phone || data.from || payload.from
  const riderPhone = typeof rawPhone === 'string' || typeof rawPhone === 'number' ? String(rawPhone).trim() : ''
  const orderNumber = match[2].trim()
  if (!orderNumber || !riderPhone) return { recognized: true, error: 'incomplete_payload' }

  return {
    recognized: true,
    order_number: orderNumber,
    rider_phone: riderPhone,
    payment_status: match[1].toLowerCase() === 'unpaid' ? 'unpaid' : 'collected',
  }
}

export async function drainYCloudInbox(
  admin: ForwarderAdminClient,
  config: ForwarderConfig,
  { limit = 10, timeoutMs = 8000, fetchImpl = fetch }: { limit?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
) {
  const result = { claimed: 0, processed: 0, retryable: 0, failed: 0, lost: 0 }
  const { data, error } = await admin.rpc('claim_ycloud_events', { p_limit: limit, p_lease_seconds: 120 })
  if (error) throw new Error('inbox_claim_failed')
  const rows = (data ?? []) as InboxRow[]
  result.claimed = rows.length

  for (const row of rows) {
    let errorCode: string | null = null
    try {
      const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {}
      if (payload.type === 'whatsapp.message.updated') {
        const nestedData = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
        const message = payload.whatsappMessage && typeof payload.whatsappMessage === 'object'
          ? payload.whatsappMessage as Record<string, unknown>
          : nestedData.whatsappMessage && typeof nestedData.whatsappMessage === 'object'
            ? nestedData.whatsappMessage as Record<string, unknown>
            : null
        const group = payload.whatsappGroup && typeof payload.whatsappGroup === 'object'
          ? payload.whatsappGroup as Record<string, unknown>
          : nestedData.whatsappGroup && typeof nestedData.whatsappGroup === 'object'
            ? nestedData.whatsappGroup as Record<string, unknown>
            : null
        const details = message ?? group
        const rawStatus = typeof details?.status === 'string' ? details.status.toLowerCase() : ''
        const allowedStatuses = new Set(['accepted', 'failed', 'sent', 'delivered', 'read'])
        const asText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : null
        const stored = await admin.from('ycloud_message_status_events').upsert({
          provider_event_id: row.provider_event_id,
          provider_message_id: asText(message?.id),
          whatsapp_message_id: asText(message?.wamid),
          external_id: asText(message?.externalId) ?? asText(group?.dedupeKey),
          status: allowedStatuses.has(rawStatus) ? rawStatus : null,
          recipient_phone: asText(message?.to) ?? asText(group?.displayPhoneNumber),
          sender_phone: asText(message?.from),
          error_code: asText(details?.errorCode),
          error_message: asText(details?.errorMessage),
          event_created_at: asText(payload.createTime),
          payload: row.payload,
        }, { onConflict: 'provider_event_id', ignoreDuplicates: true })
        const statusCode = stored.error && typeof stored.error === 'object' && 'code' in stored.error ? String(stored.error.code) : ''
        if (stored.error && statusCode !== '23505') errorCode = 'status_persist_failed'
      } else {
        const riderAction = riderDeliveryAction(payload)
        let destination = config.url
        let requestBody = row.payload

        if (riderAction.recognized) {
          if ('error' in riderAction) {
            errorCode = `rider_action_${riderAction.error}`
          } else {
            try {
              const appUrl = new URL(config.appBaseUrl)
              if (appUrl.protocol !== 'https:') throw new Error('insecure_app_url')
              destination = new URL('/api/webhooks/rider/deliver', appUrl).toString()
              requestBody = {
                order_number: riderAction.order_number,
                rider_phone: riderAction.rider_phone,
                payment_status: riderAction.payment_status,
              }
            } catch {
              errorCode = 'rider_action_app_url_missing_or_insecure'
            }
          }
        }

        if (!errorCode) {
          const res = await fetchImpl(destination, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-rasoi-whatsapp-secret': config.secret,
              'x-rasoi-event-id': row.provider_event_id,
            },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(timeoutMs),
          })
          if (!res.ok) errorCode = `http_${res.status}`
        }
      }
    } catch (e) {
      errorCode = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network'
    }

    const finish = await admin.rpc('finish_ycloud_event', {
      p_id: row.id, p_attempt: row.attempts, p_ok: errorCode === null, p_error_code: errorCode,
    })
    const status = finish.error ? null : finish.data as string | null
    if (status === 'processed' || status === 'retryable' || status === 'failed') result[status]++
    else result.lost++
  }
  return result
}
