import test from 'node:test'
import assert from 'node:assert/strict'
import { rangeEnd, rangeStart } from '../app/(dashboard)/dashboard/oc-utils.ts'

const dayMs = 86400000
const todayIST = new Date(Date.now() + 19800000).toISOString().slice(0, 10)
const todayStart = new Date(`${todayIST}T00:00:00+05:30`).getTime()

test('today and all-time ranges include date-only expenses for the entire current IST day', () => {
  const expenseAtNoon = new Date(`${todayIST}T12:00:00+05:30`).getTime()
  for (const range of ['today', 'all']) {
    const state = { range, from: '', to: '' }
    const start = rangeStart(state).getTime()
    const end = rangeEnd(state)
    assert.ok(start <= expenseAtNoon, `${range} starts before today's expense`)
    assert.ok(expenseAtNoon < end, `${range} includes today's date-only expense`)
    assert.equal(end, todayStart + dayMs)
  }
})

test('yesterday and custom ranges end at the next IST midnight', () => {
  const yesterday = { range: 'yesterday', from: '', to: '' }
  assert.equal(rangeEnd(yesterday), rangeStart(yesterday).getTime() + dayMs)
  assert.equal(rangeEnd({ range: 'custom', from: '2026-11-02', to: '2026-11-02' }),
    new Date('2026-11-03T00:00:00+05:30').getTime())
})

test('an unapplied custom range keeps the existing current-time bound', () => {
  const before = Date.now()
  const end = rangeEnd({ range: 'custom', from: todayIST, to: '' })
  assert.ok(end >= before && end <= Date.now())
})
