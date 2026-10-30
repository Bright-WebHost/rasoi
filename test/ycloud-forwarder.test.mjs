import test from 'node:test'
import assert from 'node:assert/strict'
import { drainYCloudInbox, forwarderConfig, riderDeliveryAction } from '../lib/server/ycloud-forwarder.ts'

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
    from(table) {
      return { upsert: async (row, options) => {
        calls.push({ table, row, options })
        return { error: null }
      } }
    },
  }
}
const row = (n) => ({ id: `id-${n}`, provider_event_id: `evt-${n}`, attempts: 1, payload: { id: `evt-${n}`, type: 'whatsapp.inbound_message.received' } })

test('forwarding is off unless explicitly enabled with an https url and secret', () => {
  assert.equal(forwarderConfig({}), null)
  assert.equal(forwarderConfig({ N8N_WHATSAPP_INBOUND_WEBHOOK_URL: config.url, RASOI_WHATSAPP_INBOUND_SECRET: 's' }), null)
  assert.equal(forwarderConfig({ RASOI_WHATSAPP_FORWARDING_ENABLED: 'true', N8N_WHATSAPP_INBOUND_WEBHOOK_URL: 'http://x', RASOI_WHATSAPP_INBOUND_SECRET: 's' }), null)
  assert.deepEqual(forwarderConfig({ RASOI_WHATSAPP_FORWARDING_ENABLED: 'true', N8N_WHATSAPP_INBOUND_WEBHOOK_URL: config.url, RASOI_WHATSAPP_INBOUND_SECRET: 's', NEXT_PUBLIC_SITE_URL: 'https://rasoi.example.test' }), { url: config.url, secret: 's', appBaseUrl: 'https://rasoi.example.test' })
})

test('extracts the rider phone, order number, and payment choice from YCloud buttons', () => {
  assert.deepEqual(riderDeliveryAction({
    data: { whatsappInboundMessage: { from: '+919999999999', type: 'interactive', interactive: { button_reply: { id: 'deliver_collected_RAS-123' } } } },
  }), { recognized: true, order_number: 'RAS-123', rider_phone: '+919999999999', payment_status: 'collected' })
  assert.deepEqual(riderDeliveryAction({
    whatsappInboundMessage: { from: '+918888888888', type: 'interactive', interactive: { button_reply: { id: 'deliver_unpaid_RAS-124' } } },
  }), { recognized: true, order_number: 'RAS-124', rider_phone: '+918888888888', payment_status: 'unpaid' })
  assert.deepEqual(riderDeliveryAction({ whatsappInboundMessage: { from: '+919999999999', text: { body: 'Hi' } } }), { recognized: false })
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

test('routes rider completion buttons to the protected delivery endpoint instead of the AI workflow', async () => {
  const admin = fakeAdmin([{
    ...row(4),
    payload: {
      id: 'evt-4',
      type: 'whatsapp.inbound_message.received',
      whatsappInboundMessage: {
        id: 'msg-4',
        from: '+919999999999',
        type: 'interactive',
        interactive: { button_reply: { id: 'deliver_collected_RAS-204' } },
      },
    },
  }])
  const configWithApp = { ...config, appBaseUrl: 'https://rasoi.example.test' }
  let sentUrl
  let sent
  const result = await drainYCloudInbox(admin, configWithApp, { fetchImpl: async (url, init) => {
    sentUrl = url
    sent = init
    return new Response(null, { status: 200 })
  } })
  assert.equal(sentUrl, 'https://rasoi.example.test/api/webhooks/rider/deliver')
  assert.equal(sent.headers['x-rasoi-whatsapp-secret'], config.secret)
  assert.equal(sent.headers['x-rasoi-event-id'], 'evt-4')
  assert.deepEqual(JSON.parse(sent.body), { order_number: 'RAS-204', rider_phone: '+919999999999', payment_status: 'collected' })
  assert.equal(result.processed, 1)
})

test('does not send malformed rider buttons into the customer AI workflow', async () => {
  const admin = fakeAdmin([{
    ...row(5),
    payload: {
      id: 'evt-5',
      type: 'whatsapp.inbound_message.received',
      whatsappInboundMessage: { id: 'msg-5', type: 'interactive', interactive: { button_reply: { id: 'deliver_unpaid_RAS-205' } } },
    },
  }])
  let requests = 0
  const result = await drainYCloudInbox(admin, { ...config, appBaseUrl: 'https://rasoi.example.test' }, { fetchImpl: async () => {
    requests += 1
    return new Response(null, { status: 200 })
  } })
  assert.equal(requests, 0)
  assert.equal(result.retryable, 1)
  assert.equal(admin.calls.find((call) => call.fn === 'finish_ycloud_event').args.p_error_code, 'rider_action_incomplete_payload')
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

test('YCloud status events are stored locally and never sent to the inbound workflow', async () => {
  const statusEvent = {
    id: 'evt-status-local',
    type: 'whatsapp.message.updated',
    whatsappMessage: { id: 'ycloud-msg-1', status: 'read' },
  }
  const admin = fakeAdmin([{ id: 'row-status', provider_event_id: statusEvent.id, attempts: 1, payload: statusEvent }])
  let outboundRequests = 0
  const result = await drainYCloudInbox(admin, config, { fetchImpl: async () => {
    outboundRequests += 1
    return new Response(null, { status: 200 })
  } })
  const persisted = admin.calls.find((call) => call.table === 'ycloud_message_status_events')
  assert.equal(outboundRequests, 0)
  assert.equal(persisted.row.provider_event_id, statusEvent.id)
  assert.equal(persisted.row.status, 'read')
  assert.equal(result.processed, 1)
})
