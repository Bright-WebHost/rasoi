import test from 'node:test'
import assert from 'node:assert/strict'
import { getBlastAttemptedCount, getBlastSentCount } from '../lib/orders/blast-result.ts'

test('reads sent counts from common workflow response fields', () => {
  assert.equal(getBlastSentCount({ sent: 7 }), 7)
  assert.equal(getBlastSentCount({ sentCount: '8' }), 8)
  assert.equal(getBlastSentCount({ messages_sent: 9 }), 9)
})

test('reads counts from nested or item-array workflow responses', () => {
  assert.equal(getBlastSentCount({ data: { sent_count: 12 } }), 12)
  assert.equal(getBlastSentCount([{ result: { sent: 3 } }]), 3)
  assert.equal(getBlastAttemptedCount({ response: { attemptedCount: 15 } }), 15)
})

test('does not invent a sent count when the workflow omits one', () => {
  assert.equal(getBlastSentCount({ success: true }), undefined)
  assert.equal(getBlastSentCount({ sent: 'unknown' }), undefined)
})
