import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { parseYCloudEvent, persistYCloudEvent, persistYCloudMessageStatus, verifyYCloudSignature, yCloudMessageStatusRow } from '../lib/server/ycloud-webhook.ts'
import { timingSafeSecretEquals } from '../lib/server/internal-auth.ts'

const secret = 'synthetic-test-secret-do-not-use-in-production'
const now = Date.now()
function signed(body, timestamp = Math.floor(now / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},s=${sig}`
}
const inbound = (id = 'msg-1') => JSON.stringify({ id: 'evt-1', type: 'whatsapp.inbound_message.received', whatsappInboundMessage: { id } })

test('accepts valid YCloud HMAC and rejects invalid/stale signatures', () => {
  const body = inbound()
  assert.equal(verifyYCloudSignature(body, signed(body), secret, now), true)
  assert.equal(verifyYCloudSignature(body, signed(body), 'wrong-secret', now), false)
  assert.equal(verifyYCloudSignature(body, 't=bad,s=bad', secret, now), false)
  assert.equal(verifyYCloudSignature(body, signed(body, Math.floor(now / 1000) - 600), secret, now), false)
})

test('server secret comparisons accept only non-empty exact matches', () => {
  assert.equal(timingSafeSecretEquals('  same-secret ', 'same-secret'), true)
  assert.equal(timingSafeSecretEquals('wrong-secret', 'same-secret'), false)
  assert.equal(timingSafeSecretEquals('', 'same-secret'), false)
  assert.equal(timingSafeSecretEquals('same-secret', ''), false)
})

test('requires event and inbound message identifiers', () => {
  assert.equal(parseYCloudEvent(inbound()).event?.id, 'evt-1')
  assert.equal(parseYCloudEvent(JSON.stringify({ type: 'whatsapp.inbound_message.received', message: { id: 'm' } })).error, 'missing_event_id_or_type')
  assert.equal(parseYCloudEvent(JSON.stringify({ id: 'evt', type: 'whatsapp.inbound_message.received', message: {} })).error, 'missing_message_id')
  assert.equal(parseYCloudEvent('{').error, 'invalid_json')
})

function mockInbox() {
  const ids = new Set()
  return {
    ids,
    from(table) {
      assert.equal(table, 'ycloud_event_inbox')
      return { upsert: async (row, options) => {
        assert.equal(options.onConflict, 'provider_event_id')
        assert.equal(options.ignoreDuplicates, true)
        if (ids.has(row.provider_event_id)) return { error: null }
        ids.add(row.provider_event_id)
        return { error: null }
      } }
    }
  }
}

test('duplicate and concurrent event claims use the provider event id as the key', async () => {
  const admin = mockInbox()
  const { event, messageId } = parseYCloudEvent(inbound())
  const claims = await Promise.all(Array.from({ length: 20 }, () => persistYCloudEvent(admin, event, messageId)))
  assert.equal(claims.every(x => x.error === null), true)
  assert.equal(admin.ids.size, 1)
})

test('database errors are surfaced for retry by the route', async () => {
  const admin = { from: () => ({ upsert: async () => ({ error: new Error('synthetic db failure') }) }) }
  const { event, messageId } = parseYCloudEvent(inbound())
  const result = await persistYCloudEvent(admin, event, messageId)
  assert.ok(result.error)
})

test('database unique violations are treated as safe duplicate deliveries', async () => {
  const admin = { from: () => ({ upsert: async () => ({ error: { code: '23505' } }) }) }
  const { event, messageId } = parseYCloudEvent(inbound())
  const result = await persistYCloudEvent(admin, event, messageId)
  assert.equal(result.error, null)
  assert.equal(result.duplicate, true)
})

test('YCloud outbound status callbacks are normalized and persisted idempotently', async () => {
  const event = {
    id: 'evt-status-1',
    type: 'whatsapp.message.updated',
    createTime: '2026-10-29T10:00:00.000Z',
    whatsappMessage: {
      id: 'ycloud-message-1',
      wamid: 'wamid.test-1',
      externalId: 'rasoi-order-1-confirmed',
      to: '+919999999999',
      from: '+918888888888',
      status: 'delivered',
    },
  }
  assert.deepEqual(yCloudMessageStatusRow(event), {
    provider_event_id: 'evt-status-1',
    provider_message_id: 'ycloud-message-1',
    whatsapp_message_id: 'wamid.test-1',
    external_id: 'rasoi-order-1-confirmed',
    status: 'delivered',
    recipient_phone: '+919999999999',
    sender_phone: '+918888888888',
    error_code: null,
    error_message: null,
    event_created_at: '2026-10-29T10:00:00.000Z',
    payload: event,
  })
  let stored = null
  const admin = { from: (table) => ({ upsert: async (row, options) => {
    assert.equal(table, 'ycloud_message_status_events')
    assert.equal(options.onConflict, 'provider_event_id')
    assert.equal(options.ignoreDuplicates, true)
    stored = row
    return { error: null }
  } }) }
  const result = await persistYCloudMessageStatus(admin, event)
  assert.equal(result.error, null)
  assert.equal(stored.status, 'delivered')
})

test('migration enforces database uniqueness and retry state; route has no order/forwarding side effects', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261028_ycloud_event_inbox.sql', import.meta.url), 'utf8')
  const route = fs.readFileSync(new URL('../app/api/webhooks/ycloud/whatsapp/route.ts', import.meta.url), 'utf8')
  assert.match(migration, /provider_event_id text NOT NULL UNIQUE/)
  assert.match(migration, /'pending','processing','processed','retryable','failed'/)
  assert.match(migration, /ycloud_event_inbox_inbound_message_unique_idx/)
  assert.doesNotMatch(route, /create_customer_order|\/api\/orders|N8N_WHATSAPP_INBOUND_WEBHOOK_URL/)
  assert.match(route, /Temporary webhook storage failure/)
  assert.match(fs.readFileSync(new URL('../supabase/rasoi_initialization.sql', import.meta.url), 'utf8'), /\('orders_paused','true'\)/)
  const hardening = fs.readFileSync(new URL('../supabase/migrations/20261029_ycloud_status_and_atomic_orders.sql', import.meta.url), 'utf8')
  assert.match(hardening, /messages_ycloud_inbound_message_id_unique_idx/)
  assert.match(hardening, /pg_advisory_xact_lock/)
  assert.match(hardening, /CREATE TABLE IF NOT EXISTS public\.ycloud_message_status_events/)
})
