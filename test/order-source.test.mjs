import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardOrderSourceKey } from '../lib/orders/type-utils.ts'

test('WhatsApp chat and website orders share the WhatsApp source label', () => {
  assert.equal(dashboardOrderSourceKey('whatsapp'), 'whatsapp')
  assert.equal(dashboardOrderSourceKey('pwa'), 'whatsapp')
  assert.equal(dashboardOrderSourceKey('website'), 'whatsapp')
})

test('table and POS orders use the remaining source labels', () => {
  assert.equal(dashboardOrderSourceKey('pwa', 'dine-in', 'T4'), 'table')
  assert.equal(dashboardOrderSourceKey(null, 'dine-in', 'T4'), 'table')
  assert.equal(dashboardOrderSourceKey('pos'), 'pos')
  assert.equal(dashboardOrderSourceKey('pos', 'dine-in', 'T4'), 'pos')
})
