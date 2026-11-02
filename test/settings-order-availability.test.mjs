import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { checkOrderRules } from '../lib/settings/index.ts'

const settings = {
  ordersPaused: false,
  openTime: '',
  closeTime: '',
  orderTypes: { delivery: true, takeaway: true, dineIn: true },
  minOrder: 0,
}

test('rejects website order types that are disabled in settings', () => {
  assert.match(
    checkOrderRules({ ...settings, orderTypes: { ...settings.orderTypes, delivery: false } }, [], {
      orderType: 'delivery',
      itemsSubtotal: 100,
    }),
    /delivery orders are not available/i,
  )
  assert.match(
    checkOrderRules({ ...settings, orderTypes: { ...settings.orderTypes, takeaway: false } }, [], {
      orderType: 'takeaway',
      itemsSubtotal: 100,
    }),
    /takeaway orders are not available/i,
  )
})

test('global pause rejects every new customer order type', () => {
  for (const orderType of ['delivery', 'takeaway', 'dine-in']) {
    assert.match(
      checkOrderRules({ ...settings, ordersPaused: true }, [], { orderType, itemsSubtotal: 100 }),
      /not taking orders right now/i,
    )
  }
})

test('database migration checks pause and order type before customer-order inserts', () => {
  const migration = fs.readFileSync(
    new URL('../supabase/migrations/20261102_enforce_customer_order_settings.sql', import.meta.url),
    'utf8',
  )
  assert.match(migration, /reject_unavailable_customer_order/)
  assert.match(migration, /orders_paused/)
  assert.match(migration, /order_types/)
  assert.match(migration, /BEFORE INSERT ON public\.orders/)
  assert.match(migration, /NOT IN \('pwa', 'whatsapp'\)/)
})
