export type AiCartLine = {
  menu_item_id: string
  item_name: string
  unit_price: number
  quantity: number
}

export type AiCartAction = 'add' | 'update' | 'remove'

export function applyAiCartChange(
  items: AiCartLine[],
  action: AiCartAction,
  item: Omit<AiCartLine, 'quantity'>,
  quantity: number,
): AiCartLine[] {
  const next = items.map((line) => ({ ...line }))
  const index = next.findIndex((line) => line.menu_item_id === item.menu_item_id)

  if (action === 'remove') {
    if (index >= 0) {
      const remaining = next[index].quantity - quantity
      if (remaining > 0) next[index].quantity = remaining
      else next.splice(index, 1)
    }
    return next
  }

  if (action === 'update' && quantity === 0) {
    if (index >= 0) next.splice(index, 1)
    return next
  }

  if (index >= 0) {
    next[index].quantity = action === 'add' ? next[index].quantity + quantity : quantity
    next[index].item_name = item.item_name
    next[index].unit_price = item.unit_price
  } else {
    next.push({ ...item, quantity })
  }

  return next
}
