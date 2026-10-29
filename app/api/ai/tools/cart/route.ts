import { NextResponse } from 'next/server'
import { timingSafeSecretEquals } from '@/lib/server/internal-auth'
import { createAdminClient } from '@/lib/supabase/admin'

type CartItem = {
  menu_item_id: string
  item_name: string
  unit_price: number
  quantity: number
}

type IncomingItem = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCartItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is CartItem =>
    isRecord(item) &&
    typeof item.menu_item_id === 'string' &&
    typeof item.item_name === 'string' &&
    Number.isFinite(Number(item.unit_price)) &&
    Number.isFinite(Number(item.quantity))
  ).map(item => ({
    menu_item_id: item.menu_item_id,
    item_name: item.item_name,
    unit_price: Number(item.unit_price),
    quantity: Number(item.quantity),
  }))
}

function formatCartResponse(items: CartItem[]) {
  if (items.length === 0) {
    return { empty: true, items: [], total: 0, ai_system_instruction: 'Tell the user their cart is empty.' }
  }

  const total = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)
  let formattedMessage = "We've updated your Rasoi Delivery order.\n\n*Your order:*\n"
  for (const item of items) {
    formattedMessage += `• ${item.item_name} - ${item.quantity}\n`
  }
  formattedMessage += `\n*Total: ₹${total}*\n\nDo you want me to add something else, or shall we place the order?`

  return {
    empty: false,
    items,
    total,
    formatted_reply_for_user: formattedMessage,
    ai_system_instruction: "CRITICAL: You MUST reply to the user using EXACTLY the text provided in the 'formatted_reply_for_user' field. Do not invent your own response. Just output the formatted_reply_for_user.",
  }
}

export async function POST(request: Request) {
  const secretHeader = request.headers.get('x-rasoi-ai-secret')?.trim()
  const expectedSecret = process.env.RASOI_AI_WEBHOOK_SECRET?.trim()

  if (!timingSafeSecretEquals(secretHeader, expectedSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isRecord(parsed)) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const body = parsed
  const channelUserId = typeof body.channel_user_id === 'string' ? body.channel_user_id.trim() : ''
  const action = typeof body.action === 'string' ? body.action : ''

  if (!channelUserId) {
    return NextResponse.json({ error: 'channel_user_id is required' }, { status: 400 })
  }
  if (!['get', 'clear', 'add', 'update', 'remove'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  const { data: cartData, error: cartError } = await adminClient
    .from('ai_carts')
    .select('items')
    .eq('channel_user_id', channelUserId)
    .single()

  let currentItems: CartItem[] = []
  if (!cartError && cartData?.items) {
    currentItems = normalizeCartItems(cartData.items)
  }

  if (action === 'get') {
    return NextResponse.json(formatCartResponse(currentItems))
  }

  if (action === 'clear') {
    const { error } = await adminClient
      .from('ai_carts')
      .upsert({ channel_user_id: channelUserId, items: [] }, { onConflict: 'channel_user_id' })
    if (error) return NextResponse.json({ error: 'Failed to clear cart' }, { status: 500 })
    return NextResponse.json(formatCartResponse([]))
  }

  const rawItems: unknown[] = Array.isArray(body.items) ? body.items : [{
    menu_item_id: body.menu_item_id,
    item_name: body.item_name,
    quantity: body.quantity,
  }]
  const itemsToProcess: IncomingItem[] = rawItems.filter(isRecord)

  if (itemsToProcess.length !== rawItems.length) {
    return NextResponse.json({ error: 'Each cart item must be an object' }, { status: 400 })
  }
  if (itemsToProcess.length === 0 || (itemsToProcess.length === 1 && !itemsToProcess[0].menu_item_id && !itemsToProcess[0].item_name && !itemsToProcess[0].name && !itemsToProcess[0].item)) {
    return NextResponse.json(formatCartResponse(currentItems))
  }

  const errors: string[] = []

  for (const itemToProcess of itemsToProcess) {
    let actualMenuId = typeof itemToProcess.menu_item_id === 'string' ? itemToProcess.menu_item_id : ''
    const incomingNameValue = itemToProcess.item_name || itemToProcess.name || itemToProcess.item
    const incomingName = typeof incomingNameValue === 'string' ? incomingNameValue.trim() : ''

    if (!actualMenuId && incomingName) {
      const { data: exactMatch } = await adminClient.from('menu_items').select('id').ilike('item_name', incomingName).maybeSingle()
      if (exactMatch) {
        actualMenuId = exactMatch.id
      } else {
        const fuzzyPattern = `%${incomingName.split(' ').join('%')}%`
        const { data: fuzzyMatch } = await adminClient.from('menu_items').select('id').ilike('item_name', fuzzyPattern).limit(1).maybeSingle()
        if (fuzzyMatch) actualMenuId = fuzzyMatch.id
      }
    }

    if (!actualMenuId) {
      errors.push(`Could not find menu item matching: ${incomingName || String(itemToProcess.menu_item_id ?? '')}`)
      continue
    }

    const { data: menuItem, error: menuError } = await adminClient
      .from('menu_items')
      .select('id, item_name, price, available')
      .eq('id', actualMenuId)
      .single()

    if (menuError || !menuItem) {
      errors.push(`Menu item not found for ID: ${actualMenuId}`)
      continue
    }
    if (!menuItem.available) {
      errors.push(`Menu item ${menuItem.item_name} is currently unavailable`)
      continue
    }

    const existingItemIndex = currentItems.findIndex(item => item.menu_item_id === actualMenuId)
    if (action === 'add' || action === 'update') {
      const parsedQuantity = Number(itemToProcess.quantity)
      const quantity = Number.isFinite(parsedQuantity) ? parsedQuantity || 1 : 1
      if (quantity <= 0) {
        if (existingItemIndex > -1) currentItems.splice(existingItemIndex, 1)
      } else if (existingItemIndex > -1) {
        currentItems[existingItemIndex].quantity = action === 'add' ? currentItems[existingItemIndex].quantity + quantity : quantity
      } else {
        currentItems.push({
          menu_item_id: menuItem.id,
          item_name: menuItem.item_name,
          unit_price: Number(menuItem.price),
          quantity,
        })
      }
    } else if (action === 'remove') {
      if (existingItemIndex > -1) currentItems.splice(existingItemIndex, 1)
    }
  }

  if (errors.length > 0 && currentItems.length === 0) {
    return NextResponse.json({ error: errors[0], empty: true, items: [] }, { status: 200 })
  }

  const { error: upsertError } = await adminClient
    .from('ai_carts')
    .upsert({ channel_user_id: channelUserId, items: currentItems, updated_at: new Date().toISOString() }, { onConflict: 'channel_user_id' })

  if (upsertError) {
    return NextResponse.json({ error: 'Failed to update cart' }, { status: 500 })
  }

  return NextResponse.json(formatCartResponse(currentItems))
}
