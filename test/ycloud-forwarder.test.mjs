import test from 'node:test'
import assert from 'node:assert/strict'
import { drainYCloudInbox, forwarderConfig } from '../lib/server/ycloud-forwarder.ts'

const config = { url: 'https://n8n.example.test/webhook/x', secret: 'synthetic-secret' }
function fakeAdmin(rows, finishStatus = (args) => args.p_ok ? 'processed' : 'retryable') {
  const calls = []
  return {
    calls,
    rpc(fn, args) {
      calls.push({ fn, args })
      if (fn === 'claim_ycloud_events') return Promise.resolve({ data: rows, error: null })
      return Promise.resolve({ data: finishStatus(args), error: null })
    },
  }
}
const row = (n) => ({ id: `id-${n}`, provider_event_id: `evt-${n}`, attempts: 1, payload: { id: `evt-${n}`, type: 'whatsapp.inbound_message.received' } })

test('forwarding is off unless explicitly enabled with an https url and secret', () => {
  assert.equal(forwarderConfig({}), null)
  assert.equal(forwarderConfig({ N8N_WHATSAPP_INBOUND_WEBHOOK_URL: config.url, RASOI_WHATSAPP_INBOUND_SECRET: 's' }), null)
  assert.equal(forwarderConfig({ RASOI_WHATSAPP_FORWARDING_ENABLED: 'true', N8N_WHATSAPP_INBOUND_WEBHOOK_URL: 'http://x', RASOI_WHATSAPP_INBOUND_SECRET: 's' }), null)
  assert.deepEqual(forwarderConfig({ RASOI_WHATSAPP_FORWARDING_ENABLED: 'true', N8N_WHATSAPP_INBOUND_WEBHOOK_URL: config.url, RASOI_WHATSAPP_INBOUND_SECRET: 's' }), { url: config.url, secret: 's' })
})

test('sends the header secret and event id, and records success', async () => {
  const admin = fakeAdmin([row(1)])
  let sent
  const result = await drainYCloudInbox(admin, config, { fetchImpl: async (url, init) => { sent = init; return new Response(null, { status: 200 }) } })
  assert.equal(sent.headers['x-rasoi-whatsapp-secret'], 'synthetic-secret')
  assert.equal(sent.headers['x-rasoi-event-id'], 'evt-1')
  assert.deepEqual(JSON.parse(sent.body), row(1).payload)
  assert.deepEqual(admin.calls[1].args, { p_id: 'id-1', p_attempt: 1, p_ok: true, p_error_code: null })
  assert.equal(result.processed, 1)
})

test('n8n down, auth rejected, and timeouts are recorded as retryable, not lost', async () => {
  const admin = fakeAdmin([row(1), row(2), row(3)])
  const responses = [
    async () => new Response(null, { status: 503 }),
    async () => new Response(null, { status: 403 }),
    async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) },
  ]
  let i = 0
  const result = await drainYCloudInbox(admin, config, { fetchImpl: () => responses[i++]() })
  assert.deepEqual(admin.calls.slice(1).map(c => c.args.p_error_code), ['http_503', 'http_403', 'timeout'])
  assert.equal(result.retryable, 3)
})

test('a lost lease is counted and does not throw', async () => {
  const admin = fakeAdmin([row(1)], () => null)
  const result = await drainYCloudInbox(admin, config, { fetchImpl: async () => new Response(null, { status: 200 }) })
  assert.equal(result.lost, 1)
})

test('claim failure surfaces as an error so the caller can return 503', async () => {
  const admin = { rpc: () => Promise.resolve({ data: null, error: { code: 'x' } }) }
  await assert.rejects(drainYCloudInbox(admin, config), /inbox_claim_failed/)
})
