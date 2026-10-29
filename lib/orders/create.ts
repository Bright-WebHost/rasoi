import { createAdminClient } from '@/lib/supabase/admin'
import { checkOrderRules, deliveryFeeFor, formatTime12h, isOpenAt } from '@/lib/settings'
import { getActivePincodes, getSettings } from '@/lib/settings/server'

/**
 * Creates a customer order (website checkout and WhatsApp checkout).
 * All business rules live here so both channels behave identically:
 * live menu prices, availability, hours/pause, order types, minimum order,
 * delivery pincodes, delivery fee, and scheduled pickup time.
 */

const MAX_CART_ITEMS = 50
const MAX_QUANTITY_PER_ITEM = 20
const MIN_SCHEDULE_LEAD_MS = 10 * 60 * 1000
const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000

export type OrderSource = 'pwa' | 'whatsapp'

export interface CreateOrderInput {
  source: OrderSource
  orderType: unknown
  customerName?: unknown
  customerPhone?: unknown
  /** app_customers.id from a trusted session (website cookie or AI backend) */
  customerId?: string | null
  channelUserId?: unknown
  idempotencyKey?: unknown
  paymentMethod?: unknown
  deliveryAddress?: unknown
  landmark?: unknown
  pincode?: unknown
  scheduledTime?: unknown
  tableNumber?: unknown
  cartItems: unknown
}

export type CreateOrderResult =
  | { ok: true; orderId: string; orderNumber: string; orderType: string; status: string; total: number; deliveryFee: number; scheduledFor: string | null; isDuplicate: boolean }
  | { ok: false; status: number; error: string; code?: string }

const fail = (status: number, error: string, code?: string): CreateOrderResult => ({ ok: false, status, error, code })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function normalizeOrderType(value: unknown): 'delivery' | 'takeaway' | 'dine-in' | null {
  if (value === 'delivery' || value === 'dine-in' || value === 'takeaway') return value
  if (value === 'pickup') return 'takeaway'
  return null
}

export async function createCustomerOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const orderType = normalizeOrderType(input.orderType)
  if (!orderType) return fail(400, 'Invalid order type')
  if (input.source === 'pwa' && !input.customerId) return fail(401, 'Please sign in before placing an order')

  const cartItems = input.cartItems
  if (!Array.isArray(cartItems) || cartItems.length === 0 || cartItems.length > MAX_CART_ITEMS) {
    return fail(400, 'Cart cannot be empty')
  }
  const idempotencyKey = str(input.idempotencyKey)
  if (input.source === 'whatsapp' && !idempotencyKey) return fail(400, 'A request id is required to place a WhatsApp order')
  if (idempotencyKey.length > 255) return fail(400, 'Invalid request id')

  const adminClient = createAdminClient()

  let customerData: { name?: string; phone?: string } | null = null
  if (input.customerId) {
    const { data } = await adminClient.from('app_customers').select('name, phone').eq('id', input.customerId).single()
    customerData = data
  }

  const resolvedName = str(input.customerName) || customerData?.name || 'Valued Customer'
  const resolvedPhone = str(input.customerPhone) || customerData?.phone || ''
  if (!resolvedPhone) return fail(400, 'Customer phone is required')

  const deliveryAddress = str(input.deliveryAddress)
  if (orderType === 'delivery' && !deliveryAddress) return fail(400, 'Delivery address is required for delivery orders')

  const validatedItems: Array<{ menu_item_id: string; variant_id: string | null; quantity: number; special_note: string | null }> = []
  for (const item of cartItems) {
    if (!item || typeof item !== 'object') return fail(400, 'Invalid cart item')
    const record = item as Record<string, unknown>
    const menuItemId = typeof record.menu_item_id === 'string' ? record.menu_item_id : null
    const variantId = typeof record.variant_id === 'string' ? record.variant_id : typeof record.variantId === 'string' ? record.variantId : null
    const quantity = typeof record.quantity === 'number' ? record.quantity : Number(record.quantity)
    if (!menuItemId) return fail(400, 'Each cart item requires a menu_item_id.')
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY_PER_ITEM) return fail(400, 'Invalid item quantity')
    const specialNote = typeof record.special_note === 'string' ? record.special_note.trim() : ''
    if (specialNote.length > 300) return fail(400, 'Special instructions must be 300 characters or fewer.')
    validatedItems.push({ menu_item_id: menuItemId, variant_id: variantId, quantity, special_note: specialNote || null })
  }

  const { data: liveMenuItems, error: menuError } = await adminClient
    .from('menu_items')
    .select('id, item_name, price, available')
    .in('id', validatedItems.map((item) => item.menu_item_id))
  if (menuError) {
    console.error('[createCustomerOrder] Menu lookup failed:', menuError.message)
    return fail(500, 'Unable to load menu items')
  }

  const menuLookup = new Map<string, { item_name: string; price: number; available: boolean }>()
  for (const row of (liveMenuItems ?? []) as Array<{ id: string; item_name: string; price: number; available: boolean }>) {
    menuLookup.set(row.id, { item_name: row.item_name, price: Number(row.price), available: Boolean(row.available) })
  }

  const orderedItems: Array<{ menu_item_id: string; variant_id: string | null; item_name: string; quantity: number; unit_price: number }> = []
  let itemsTotal = 0
  for (const item of validatedItems) {
    const menuItem = menuLookup.get(item.menu_item_id)
    if (!menuItem || menuItem.available !== true) return fail(400, 'One or more menu items are unavailable')
    if (!Number.isFinite(menuItem.price)) return fail(400, 'Invalid menu item price')
    itemsTotal += menuItem.price * item.quantity
    let itemName = menuItem.item_name
    let unitPrice = menuItem.price
    if (item.variant_id) {
      const { data: variant, error: variantError } = await adminClient
        .from('menu_item_variants')
        .select('id, menu_item_id, name, price, is_active')
        .eq('id', item.variant_id)
        .eq('menu_item_id', item.menu_item_id)
        .eq('is_active', true)
        .maybeSingle()
      if (variantError || !variant) return fail(400, 'One or more selected variants are unavailable')
      const variantPrice = Number(variant.price)
      if (Number.isFinite(variantPrice) && variantPrice > 0) unitPrice = variantPrice
      if (typeof variant.name === 'string' && variant.name.trim()) itemName = `${itemName} (${variant.name.trim()})`
    }
    orderedItems.push({ menu_item_id: item.menu_item_id, variant_id: item.variant_id, item_name: itemName, quantity: item.quantity, unit_price: unitPrice })
  }

  // Restaurant rules from Settings: hours / pause, order types, minimum order, delivery pincodes.
  const [settings, activePincodes] = await Promise.all([getSettings(), getActivePincodes()])
  const pincode = str(input.pincode)
  const ruleError = checkOrderRules(settings, activePincodes, { orderType, itemsSubtotal: itemsTotal, pincode: pincode || null })
  if (ruleError) return fail(400, ruleError, 'ORDER_RULES')

  // Scheduled pickup ("Schedule later" on the website)
  let scheduledFor: string | null = null
  const scheduledRaw = str(input.scheduledTime)
  if (orderType === 'takeaway' && scheduledRaw) {
    const when = new Date(scheduledRaw)
    const now = Date.now()
    if (Number.isNaN(when.getTime())) return fail(400, 'Please choose a valid pickup time.')
    if (when.getTime() < now + MIN_SCHEDULE_LEAD_MS) return fail(400, 'Pickup time must be at least 10 minutes from now.')
    if (when.getTime() > now + MAX_SCHEDULE_AHEAD_MS) return fail(400, 'You can schedule a pickup up to 7 days ahead.')
    if (!isOpenAt({ ...settings, ordersPaused: false }, when)) {
      return fail(400, `We're closed at that time. Please pick a time between ${formatTime12h(settings.openTime)} and ${formatTime12h(settings.closeTime)}.`, 'ORDER_RULES')
    }
    scheduledFor = when.toISOString()
  }

  const deliveryFee = orderType === 'delivery' ? deliveryFeeFor(settings, itemsTotal) : 0
  const total = Number((itemsTotal + deliveryFee).toFixed(2))

  let tableNumber: string | null = null
  if (orderType === 'dine-in') {
    const requested = str(input.tableNumber)
    if (!requested) return fail(400, 'Table selection is required for dine-in orders')
    const { data: tableRow, error: tableError } = await adminClient
      .from('restaurant_tables').select('table_number').eq('table_number', requested).maybeSingle()
    if (tableError || !tableRow) {
      console.error('[createCustomerOrder] Table lookup failed:', tableError?.message)
      return fail(400, 'Invalid table selection')
    }
    tableNumber = tableRow.table_number
  }

  const { data: rpcResult, error: createError } = await adminClient.rpc('create_customer_order_with_notes_atomic', {
    p_customer_id: input.customerId || null,
    p_order_type: orderType,
    p_customer_name: resolvedName,
    p_customer_phone: resolvedPhone,
    p_delivery_address: orderType === 'delivery' ? deliveryAddress : null,
    p_landmark: orderType === 'delivery' ? str(input.landmark) || null : null,
    p_pincode: orderType === 'delivery' ? pincode || null : null,
    p_scheduled_time: scheduledFor,
    p_payment_method: str(input.paymentMethod) || 'cash',
    p_idempotency_key: idempotencyKey || null,
    p_cart_items: validatedItems,
    p_table_number: tableNumber,
    p_party_size: 1,
    p_source: input.source,
    p_channel_user_id: str(input.channelUserId) || null,
  })
  if (createError || !rpcResult || typeof rpcResult !== 'object') {
    console.error('[createCustomerOrder] Atomic order RPC failed:', createError?.message || 'No order returned')
    const message = createError?.message || 'Failed to create order'
    if (createError?.code === 'PGRST202' || message.includes('Could not find the function')) {
      return fail(503, 'Order notes are not enabled on the database yet. Apply the latest Supabase migration and try again.')
    }
    const customerMessage = /Orders are paused|restaurant is closed|not available|Pincode not serviceable|Delivery address|required|Table unavailable|unavailable|minimum|Below minimum/i.test(message)
    return fail(customerMessage ? 400 : 500, customerMessage ? message : 'Failed to create order', customerMessage ? 'ORDER_RULES' : undefined)
  }

  const result = rpcResult as { order?: Record<string, unknown>; duplicate?: boolean }
  const created = result.order
  if (!created || typeof created.id !== 'string' || typeof created.order_number !== 'string') {
    return fail(500, 'Failed to create order')
  }

  return {
    ok: true,
    orderId: created.id,
    orderNumber: created.order_number,
    orderType: typeof created.order_type === 'string' ? created.order_type : orderType,
    status: typeof created.status === 'string' ? created.status : 'new',
    total: Number(created.total_amount ?? created.total ?? total),
    deliveryFee: Number(created.delivery_fee ?? deliveryFee),
    scheduledFor: typeof created.scheduled_for === 'string' ? created.scheduled_for : scheduledFor,
    isDuplicate: result.duplicate === true,
  }
}
