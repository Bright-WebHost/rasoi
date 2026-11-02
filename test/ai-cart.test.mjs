import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAiCartChange } from '../lib/server/ai-cart.ts'

const golden = { menu_item_id: 'golden-id', item_name: 'Golden Gadbad', unit_price: 260 }
const shake = { menu_item_id: 'shake-id', item_name: 'Classic Choco Shake', unit_price: 155 }

test('remove decrements requested quantity instead of deleting the cart line', () => {
  assert.deepEqual(
    applyAiCartChange([{ ...golden, quantity: 6 }], 'remove', golden, 3),
    [{ ...golden, quantity: 3 }],
  )
})

test('remove deletes a line only when requested quantity reaches its current quantity', () => {
  assert.deepEqual(
    applyAiCartChange([{ ...golden, quantity: 3 }], 'remove', golden, 3),
    [],
  )
})

test('update to zero removes only the requested cart line', () => {
  assert.deepEqual(
    applyAiCartChange([{ ...golden, quantity: 3 }, { ...shake, quantity: 1 }], 'update', golden, 0),
    [{ ...shake, quantity: 1 }],
  )
})

test('removing one item preserves other cart lines and quantities', () => {
  assert.deepEqual(
    applyAiCartChange([{ ...golden, quantity: 4 }, { ...shake, quantity: 2 }], 'remove', golden, 1),
    [{ ...golden, quantity: 3 }, { ...shake, quantity: 2 }],
  )
})

test('add and update keep the requested item separate from other cart lines', () => {
  const cart = [{ ...golden, quantity: 6 }, { ...shake, quantity: 1 }]
  assert.deepEqual(
    applyAiCartChange(cart, 'update', golden, 3),
    [{ ...golden, quantity: 3 }, { ...shake, quantity: 1 }],
  )
  assert.deepEqual(
    applyAiCartChange(cart, 'add', golden, 2),
    [{ ...golden, quantity: 8 }, { ...shake, quantity: 1 }],
  )
})
