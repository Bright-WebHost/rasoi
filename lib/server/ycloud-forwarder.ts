// Forwards accepted ycloud_event_inbox rows to the Rasoi n8n workflow.
// Delivery is at-least-once: n8n must treat x-rasoi-event-id as its idempotency key.

export type ForwarderConfig = { url: string; secret: string }

type InboxRow = { id: string; provider_event_id: string; attempts: number; payload: unknown }
type ForwarderAdminClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown | null }>
}

// Disabled unless explicitly enabled, so deploying this code changes nothing by itself.
export function forwarderConfig(env: Record<string, string | undefined> = process.env): ForwarderConfig | null {
  if (env.RASOI_WHATSAPP_FORWARDING_ENABLED?.trim() !== 'true') return null
  const url = env.N8N_WHATSAPP_INBOUND_WEBHOOK_URL?.trim() || ''
  const secret = env.RASOI_WHATSAPP_INBOUND_SECRET?.trim() || ''
  if (!url.startsWith('https://') || !secret) return null
  return { url, secret }
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
      const res = await fetchImpl(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-rasoi-whatsapp-secret': config.secret,
          'x-rasoi-event-id': row.provider_event_id,
        },
        body: JSON.stringify(row.payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) errorCode = `http_${res.status}`
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
