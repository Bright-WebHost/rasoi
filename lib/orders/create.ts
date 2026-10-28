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
  deliveryAddress?: unknown
  landmark?: unknown
  pincode?: unknown
  scheduledTime?: unknown
  tableNumber?: unknown
  cartItems: unknown
}

export type CreateOrderResult =
  | { ok: true; orderId: string; orderNumber: string; orderType: string; status: string; total: number; deliveryFee: number; scheduledFor: string | null }
  | { ok: false; status: number; error: string; code?: string }

const fail = (status: number, error: string, code?: string): CreateOrderResult => ({ ok: false, status, error, code })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function normalizeOrderType(value: unknown): 'delivery' | 'takeaway' | 'dine-in' | null {
  if (value === 'delivery' || value === 'dine-in' || value === 'takeaway') return value
  if (value === 'pickup') return 'takeaway'
  return null
}

// Columns added by later migrations. If one is missing (migration not run yet),
// the order is still saved without it rather than failing for the customer.
const OPTIONAL_COLUMNS = ['delivery_fee', 'scheduled_for']

export async function createCustomerOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const orderType = normalizeOrderType(input.orderType)
  if (!orderType) return fail(400, 'Invalid order type')

  const cartItems = input.cartItems
  if (!Array.isArray(cartItems) || cartItems.length === 0 || cartItems.length > MAX_CART_ITEMS) {
    return fail(400, 'Cart cannot be empty')
  }

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

  const validatedItems: Array<{ menu_item_id: string; quantity: number }> = []
  for (const item of cartItems) {
    if (!item || typeof item !== 'object') return fail(400, 'Invalid cart item')
    const record = item as Record<string, unknown>
    const menuItemId = typeof record.menu_item_id === 'string' ? record.menu_item_id : null
    const quantity = typeof record.quantity === 'number' ? record.quantity : Number(record.quantity)
    if (!menuItemId) return fail(400, 'Each cart item requires a menu_item_id.')
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY_PER_ITEM) return fail(400, 'Invalid item quantity')
    validatedItems.push({ menu_item_id: menuItemId, quantity })
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

  const orderedItems: Array<{ menu_item_id: string; item_name: string; quantity: number; unit_price: number }> = []
  let itemsTotal = 0
  for (const item of validatedItems) {
    const menuItem = menuLookup.get(item.menu_item_id)
    if (!menuItem || menuItem.available !== true) return fail(400, 'One or more menu items are unavailable')
    if (!Number.isFinite(menuItem.price)) return fail(400, 'Invalid menu item price')
    itemsTotal += menuItem.price * item.quantity
    orderedItems.push({ menu_item_id: item.menu_item_id, item_name: menuItem.item_name, quantity: item.quantity, unit_price: menuItem.price })
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

  const { data: orderNumber, error: numberError } = await adminClient.rpc('next_order_number', { src: input.source })
  if (numberError || typeof orderNumber !== 'string') {
    console.error('[createCustomerOrder] next_order_number failed:', numberError?.message)
    return fail(500, 'Unable to generate order number')
  }

  const isDelivery = orderType === 'delivery'
  const payload: Record<string, unknown> = {
    order_number: orderNumber,
    customer_phone: resolvedPhone,
    customer_name: resolvedName,
    items: orderedItems.map((item) => `${item.item_name} x ${item.quantity}`).join(', '),
    total,
    delivery_fee: deliveryFee,
    status: 'new',
    order_type: orderType,
    source: input.source,
    address: isDelivery ? deliveryAddress : null,
    landmark: isDelivery ? str(input.landmark) || null : null,
    city: null,
    pincode: isDelivery ? pincode || null : null,
    table_number: tableNumber,
    items_json: orderedItems.map((item) => ({ ...item, round: 1 })),
  }
  if (scheduledFor) payload.scheduled_for = scheduledFor

  const insert = (p: Record<string, unknown>) =>
    adminClient.from('orders').insert(p).select('id, order_number, status, order_type').single()

  let { data: created, error: insertError } = await insert(payload)
  for (const column of OPTIONAL_COLUMNS) {
    if (insertError && new RegExp(column).test(insertError.message || '') && column in payload) {
      console.warn(`[createCustomerOrder] orders.${column} missing — run the latest supabase migration`)
      delete payload[column]
      ;({ data: created, error: insertError } = await insert(payload))
    }
  }
  if (insertError || !created) {
    console.error('[createCustomerOrder] Order insert failed:', insertError?.message || 'No order returned')
    return fail(500, 'Failed to create order')
  }

  const { error: itemsError } = await adminClient.from('order_items').insert(
    orderedItems.map((item) => ({ order_id: created.id, ...item, size: null, notes: null }))
  )
  if (itemsError) {
    console.error('[createCustomerOrder] Order item insert failed:', itemsError.message)
    const { error: cleanupError } = await adminClient.from('orders').delete().eq('id', created.id)
    if (cleanupError) console.error('[createCustomerOrder] Orphaned order cleanup failed:', cleanupError.message)
    return fail(500, 'Failed to create order items')
  }

  if (orderType === 'dine-in' && tableNumber) {
    const { error: tableUpdateError } = await adminClient
      .from('restaurant_tables').update({ is_active: true, current_order_id: created.id }).eq('table_number', tableNumber)
    if (tableUpdateError) console.error('[createCustomerOrder] Table update failed:', tableUpdateError.message)
  }

  return {
    ok: true,
    orderId: created.id,
    orderNumber: created.order_number,
    orderType: created.order_type,
    status: created.status,
    total,
    deliveryFee,
    scheduledFor: 'scheduled_for' in payload ? scheduledFor : null,
  }
}
