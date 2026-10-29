// Real PostgreSQL idempotency checks for ycloud_event_inbox. Opt-in: RUN_DB_TESTS=1.
// Uses synthetic ids only and deletes its own rows afterwards.
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { persistYCloudEvent } from '../lib/server/ycloud-webhook.ts'

dotenv.config({ path: '.env.local', quiet: true })
const enabled = process.env.RUN_DB_TESTS === '1'
const prefix = `synthetic-test-${crypto.randomUUID()}`

test('inbox accepts each event and inbound message exactly once under concurrency', { skip: !enabled }, async (t) => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
  const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()
  t.after(async () => {
    await db.query('delete from public.ycloud_event_inbox where provider_event_id like $1', [`${prefix}%`])
    await db.end()
  })
  const count = async (sql, arg) => Number((await db.query(sql, [arg])).rows[0].n)
  const event = (id, msg) => ({ id, type: 'whatsapp.inbound_message.received', whatsappInboundMessage: { id: msg } })

  // Same delivery retried 20 times in parallel.
  const same = await Promise.all(Array.from({ length: 20 }, () => persistYCloudEvent(admin, event(`${prefix}-a`, `${prefix}-msg-a`), `${prefix}-msg-a`)))
  assert.ok(same.every(r => r.error === null))
  assert.equal(await count('select count(*) n from public.ycloud_event_inbox where provider_event_id = $1', `${prefix}-a`), 1)

  // Same inbound message under 10 different event ids in parallel.
  const ids = Array.from({ length: 10 }, (_, i) => `${prefix}-b${i}`)
  const diff = await Promise.all(ids.map(id => persistYCloudEvent(admin, event(id, `${prefix}-msg-b`), `${prefix}-msg-b`)))
  assert.ok(diff.every(r => r.error === null), 'unique violations must be treated as duplicates, not errors')
  assert.equal(await count('select count(*) n from public.ycloud_event_inbox where provider_message_id = $1', `${prefix}-msg-b`), 1)

  // Status updates may reference an already-accepted message.
  const status = { id: `${prefix}-c`, type: 'whatsapp.message.updated', whatsappMessage: { id: `${prefix}-msg-a` } }
  assert.equal((await persistYCloudEvent(admin, status, `${prefix}-msg-a`)).error, null)
  assert.equal(await count('select count(*) n from public.ycloud_event_inbox where provider_message_id = $1', `${prefix}-msg-a`), 2)

  // Parallel workers never claim the same row. Guarded so real events are never touched.
  const real = await count("select count(*) n from public.ycloud_event_inbox where provider_event_id not like $1", `${prefix}%`)
  if (real === 0) {
    await db.query("update public.ycloud_event_inbox set status = 'pending', next_attempt_at = now() where provider_event_id like $1", [`${prefix}%`])
    const claims = await Promise.all(Array.from({ length: 6 }, () => admin.rpc('claim_ycloud_events', { p_limit: 3, p_lease_seconds: 60 })))
    assert.ok(claims.every(c => c.error === null))
    const claimed = claims.flatMap(c => c.data.map(r => r.id))
    assert.equal(claimed.length, 3, 'all 3 synthetic rows claimed')
    assert.equal(new Set(claimed).size, claimed.length, 'no row claimed twice')
  } else t.diagnostic('parallel-claim check skipped: inbox holds real events')

  // Anonymous clients cannot read the inbox.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await anon.from('ycloud_event_inbox').select('id').limit(1)
  assert.ok(error || data.length === 0)
})
