import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkOrderRules, closedMessage, deliveryFeeFor, isOpenAt } from '@/lib/settings'
import { getActivePincodes, getSettings } from '@/lib/settings/server'
import { createCustomerOrder } from '@/lib/orders/create'

/**
 * WhatsApp checkout, one step per call from the n8n Order Bridge:
 *   start → (takeaway | delivery → address) → confirm
 * plus edit and reorder. Progress lives in chat_sessions.flow_state.checkout;
 * the order itself is created by the same createCustomerOrder() as the website.
 */

type Step = 'choose_mode' | 'await_address' | 'confirm' | 'placing'
type CheckoutState = {
  step: Step
  order_type?: 'takeaway' | 'delivery'
  address?: string
  pincode?: string
  last_address?: string
  last_order_number?: string
  at: string
}
type Button = { id: string; title: string }
type CartLine = { menu_item_id: string; item_name: string; quantity: number; unit_price: number }

const EVENTS = ['start', 'takeaway', 'delivery', 'use_last_address', 'address', 'confirm', 'edit', 'reorder', 'upsell', 'track'] as const
type CheckoutEvent = (typeof EVENTS)[number]

const STATE_TTL_MS = 30 * 60 * 1000
const B = {
  takeaway: { id: 'btn_takeaway', title: '🛍️ Takeaway' },
  delivery: { id: 'btn_delivery', title: '🛵 Delivery' },
  edit: { id: 'btn_edit_order', title: '✏️ Edit Order' },
  confirm: { id: 'btn_confirm_order', title: '✅ Confirm Order' },
  lastAddress: { id: 'btn_use_last_address', title: '📍 Use this address' },
  checkout: { id: 'btn_checkout', title: 'Place Order' },
  addMore: { id: 'btn_add_more', title: 'Add More' },
  track: { id: 'btn_track', title: '📍 Track Order' },
} satisfies Record<string, Button>

const rs = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const reply = (text: string, buttons: Button[] = [], extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: true, reply: text, buttons: buttons.slice(0, 3), ...extra })

export async function POST(request: Request) {
  const secret = request.headers.get('x-pabbas-ai-secret')?.trim()
  if (!secret || secret !== process.env.PABBAS_AI_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const event = String(body.event || '') as CheckoutEvent
  const channelUserId = typeof body.channel_user_id === 'string' ? body.channel_user_id : ''
  const rawPhone = typeof body.phone === 'string' ? body.phone : ''
  const customerName = typeof body.customer_name === 'string' && body.customer_name.trim() ? body.customer_name.trim() : 'WhatsApp Customer'
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!EVENTS.includes(event) || !channelUserId || !rawPhone) {
    return NextResponse.json({ error: 'event, phone and channel_user_id are required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data: phone } = await db.rpc('normalize_phone', { raw: rawPhone })
  const customerPhone = typeof phone === 'string' && phone ? phone : rawPhone.replace(/\D/g, '')

  const [settings, pincodes, sessionRes, cartRes] = await Promise.all([
    getSettings(),
    getActivePincodes(),
    db.from('chat_sessions').select('id, flow_state').eq('phone', customerPhone).maybeSingle(),
    db.from('ai_carts').select('items').eq('channel_user_id', channelUserId).maybeSingle(),
  ])
  const session = sessionRes.data as { id: string; flow_state: Record<string, unknown> | null } | null
  const flow = (session?.flow_state ?? {}) as Record<string, unknown>
  const saved = flow.checkout as CheckoutState | undefined
  const state = saved && Date.now() - new Date(saved.at).getTime() < STATE_TTL_MS ? saved : undefined
  const cart = (Array.isArray(cartRes.data?.items) ? cartRes.data.items : []) as CartLine[]

  const saveState = async (next: CheckoutState | null) => {
    if (!session) return
    const flowState = { ...flow, checkout: next }
    await db.from('chat_sessions').update({ flow_state: flowState }).eq('id', session.id)
  }

  // Live prices for whatever is in the cart, same as the order will use.
  const priced = async (lines: CartLine[]) => {
    const ids = lines.map((l) => l.menu_item_id).filter(Boolean)
    const { data } = ids.length
      ? await db.from('menu_items').select('id, item_name, price, available').in('id', ids)
      : { data: [] as Array<{ id: string; item_name: string; price: number; available: boolean }> }
    type MenuRow = { id: string; item_name: string; price: number; available: boolean }
    const byId = new Map<string, MenuRow>(((data ?? []) as MenuRow[]).map((m) => [m.id, m]))
    const ok: Array<CartLine & { line: number }> = []
    const unavailable: string[] = []
    for (const l of lines) {
      const m = byId.get(l.menu_item_id)
      if (!m || !m.available) unavailable.push(l.item_name)
      else ok.push({ ...l, item_name: m.item_name, unit_price: Number(m.price), line: Number(m.price) * l.quantity })
    }
    return { lines: ok, unavailable, subtotal: ok.reduce((s, l) => s + l.line, 0) }
  }
  const itemList = (lines: Array<CartLine & { line: number }>) => lines.map((l) => `• ${l.item_name} ×${l.quantity} — ${rs(l.line)}`).join('\n')

  const enabled = { takeaway: settings.orderTypes.takeaway, delivery: settings.orderTypes.delivery }

  /** "Add ₹40 more for FREE delivery" — only when delivery has a fee and a free threshold. */
  const deliveryNudge = (subtotal: number) => {
    if (!enabled.delivery || settings.deliveryFee <= 0 || settings.freeDeliveryAbove <= 0) return ''
    const remaining = Math.ceil(settings.freeDeliveryAbove - subtotal)
    return remaining > 0 ? `\n🛵 Add ${rs(remaining)} more for *FREE delivery*` : '\n🎉 You get *FREE delivery* on this order'
  }

  // ---------- track ----------
  if (event === 'track') {
    const { data: o } = await db
      .from('orders')
      .select('order_number, status, order_type, created_at, rider_name, rider_phone, total')
      .eq('customer_phone', customerPhone)
      .neq('status', 'draft')
      .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!o) return reply("I can't see an order from you in the last 24 hours. Would you like to place one? 😊", [B.addMore])
    const placed = new Date(o.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
    const pickup = o.order_type !== 'delivery'
    const status: Record<string, string> = {
      new: '✅ Received — waiting for the restaurant to confirm',
      preparing: '👩‍🍳 Being prepared right now',
      ready_for_pickup: pickup ? '🛍️ Ready! You can pick it up now' : '📦 Packed and waiting for the delivery partner',
      out_for_delivery: `🛵 On the way${o.rider_name ? ` with ${o.rider_name}${o.rider_phone ? ` (📞 ${o.rider_phone})` : ''}` : ''}`,
      delivered: pickup ? '🎉 Picked up. Enjoy!' : '🎉 Delivered. Enjoy!',
      cancelled: '❌ This order was cancelled',
    }
    const active = ['new', 'preparing', 'ready_for_pickup', 'out_for_delivery'].includes(o.status)
    return reply(`*Order #${o.order_number}* (placed ${placed})\n\n${status[o.status] || o.status}\n\nTotal: ${rs(Number(o.total))}`, active ? [B.track] : [])
  }

  // ---------- upsell (one-tap add-on) ----------
  if (event === 'upsell') {
    const itemId = text.replace(/^btn_upsell:/i, '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) return reply("Sorry, I couldn't add that. What would you like? 😊", [B.checkout, B.addMore])
    const { data: item } = await db.from('menu_items').select('id, item_name, price, available').eq('id', itemId).maybeSingle()
    if (!item || !item.available) return reply("Sorry, that item isn't available right now 😔", [B.checkout, B.addMore])
    const next = cart.map((l) => ({ ...l }))
    const existing = next.find((l) => l.menu_item_id === item.id)
    if (existing) existing.quantity = Math.min(20, existing.quantity + 1)
    else next.push({ menu_item_id: item.id, item_name: item.item_name, unit_price: Number(item.price), quantity: 1 })
    await db.from('ai_carts').upsert({ channel_user_id: channelUserId, items: next, updated_at: new Date().toISOString() }, { onConflict: 'channel_user_id' })
    const p = await priced(next)
    return reply(`✅ Added *${item.item_name}*!\n\n${itemList(p.lines)}\n\n*Item total:* ${rs(p.subtotal)}${deliveryNudge(p.subtotal)}`, [B.checkout, B.addMore])
  }

  const fresh = (patch: Omit<CheckoutState, 'at'>): CheckoutState => ({ ...patch, at: new Date().toISOString() })

  // ---------- reorder ----------
  if (event === 'reorder') {
    const { data: last } = await db
      .from('orders')
      .select('order_number, items_json')
      .eq('customer_phone', customerPhone)
      .not('status', 'in', '(cancelled,draft)')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const previous = (Array.isArray(last?.items_json) ? last.items_json : []) as Array<{ menu_item_id?: string; item_name?: string; name?: string; quantity?: number }>
    if (!previous.length) return reply("I couldn't find a previous order. What would you like today? 😊", [], { action: 'start_whatsapp_order' })

    // Match by id first, then by name (older WhatsApp orders only stored names).
    const { data: menu } = await db.from('menu_items').select('id, item_name, price, available')
    const all = (menu ?? []) as Array<{ id: string; item_name: string; price: number; available: boolean }>
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
    const lines: CartLine[] = []
    const missing: string[] = []
    for (const p of previous) {
      const name = String(p.item_name || p.name || '')
      const m = all.find((x) => x.id === p.menu_item_id) || all.find((x) => norm(x.item_name) === norm(name))
      if (!m || !m.available) { if (name) missing.push(name); continue }
      lines.push({ menu_item_id: m.id, item_name: m.item_name, unit_price: Number(m.price), quantity: Math.max(1, Math.min(20, Number(p.quantity) || 1)) })
    }
    if (!lines.length) return reply(`Sorry, the items from your last order aren't available right now 😔\n\nWhat else can I get you?`, [B.addMore])

    await db.from('ai_carts').upsert({ channel_user_id: channelUserId, items: lines, updated_at: new Date().toISOString() }, { onConflict: 'channel_user_id' })
    await saveState(null)
    const p = await priced(lines)
    return reply(
      `🔁 I've added your last order:\n\n${itemList(p.lines)}\n\n*Item total:* ${rs(p.subtotal)}${deliveryNudge(p.subtotal)}` +
        (missing.length ? `\n\n_Not available right now: ${missing.join(', ')}_` : '') +
        `\n\nPlace the order, or add something else?`,
      [B.checkout, B.addMore]
    )
  }

  // ---------- edit ----------
  if (event === 'edit') {
    await saveState(null)
    const p = await priced(cart)
    if (!p.lines.length) return reply('Your cart is empty 🛒 What would you like to order?')
    return reply(`Sure! Here's your cart:\n\n${itemList(p.lines)}\n\nTell me what to change, e.g. *"add 1 vanilla cone"* or *"remove fries"*.`, [B.checkout])
  }

  // ---------- everything below needs a cart and an open shop ----------
  if (event === 'confirm' && saved?.step === 'placing' && Date.now() - new Date(saved.at).getTime() < 10 * 60 * 1000) {
    return saved.last_order_number
      ? reply(`✅ Your order *#${saved.last_order_number}* is already placed. We'll update you here.`)
      : reply('⏳ Placing your order…')
  }
  if (!isOpenAt(settings)) {
    await saveState(null)
    return reply(closedMessage(settings) + (settings.hoursText && !settings.ordersPaused ? `\nHours: ${settings.hoursText}` : ''))
  }
  const p = await priced(cart)
  if (!p.lines.length) {
    await saveState(null)
    return reply("Your cart is empty 🛒 Tell me what you'd like, e.g. *\"2 masala fries\"*.")
  }
  const soldOut = p.unavailable.length ? `\n\n_Removed (not available right now): ${p.unavailable.join(', ')}_` : ''

  const askMode = async () => {
    await saveState(fresh({ step: 'choose_mode' }))
    return reply(`🧾 *Your order*\n\n${itemList(p.lines)}\n\n*Item total:* ${rs(p.subtotal)}${deliveryNudge(p.subtotal)}${soldOut}\n\nHow would you like to get it?`, [B.takeaway, B.delivery, B.edit])
  }

  const confirmTakeaway = async () => {
    const err = checkOrderRules(settings, pincodes, { orderType: 'takeaway', itemsSubtotal: p.subtotal })
    if (err) return reply(err, [B.edit])
    await saveState(fresh({ step: 'confirm', order_type: 'takeaway' }))
    return reply(
      `🧾 *Order summary*\n\n${itemList(p.lines)}\n\n*Total:* ${rs(p.subtotal)}\n🛍️ Takeaway${settings.address ? ` from ${settings.address}` : ''}${soldOut}\n\nShall I place the order?`,
      [B.confirm, B.edit]
    )
  }

  const askAddress = async () => {
    // Minimum order / hours first, so we don't ask for an address we can't use.
    const err = checkOrderRules(settings, [], { orderType: 'delivery', itemsSubtotal: p.subtotal })
    if (err) return reply(err, [B.edit])
    const { data: lastDelivery } = await db
      .from('orders')
      .select('address, pincode')
      .eq('customer_phone', customerPhone)
      .eq('order_type', 'delivery')
      .not('address', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastAddress = lastDelivery?.address
      ? [lastDelivery.address, lastDelivery.pincode && !String(lastDelivery.address).includes(lastDelivery.pincode) ? lastDelivery.pincode : ''].filter(Boolean).join(', ')
      : ''
    await saveState(fresh({ step: 'await_address', order_type: 'delivery', last_address: lastAddress || undefined }))
    const note = settings.deliveryNote ? `\n_${settings.deliveryNote}_` : ''
    return lastAddress
      ? reply(`🛵 Where should we deliver?${note}\n\nUse your last address?\n📍 ${lastAddress}\n\nOr just send a new address with pincode.`, [B.lastAddress, B.edit])
      : reply(`🛵 Please send your full delivery address with a landmark and *pincode*.${note}`, [B.edit])
  }

  const confirmDelivery = async (address: string) => {
    // A usable address has a house/flat number, or at least a few words (street + area).
    const words = address.split(/[\s,]+/).filter(Boolean).length
    if (address.length < 12 || (!/\d/.test(address) && words < 3)) {
      return reply('That address looks incomplete. Please send your full address — house/flat no., street, area and pincode 📍', [B.edit])
    }
    const pincode = address.match(/\b\d{6}\b/)?.[0] || ''
    const err = checkOrderRules(settings, pincodes, { orderType: 'delivery', itemsSubtotal: p.subtotal, pincode })
    if (err) {
      // Stay on the address step so the customer can just resend it.
      await saveState(fresh({ step: 'await_address', order_type: 'delivery', last_address: state?.last_address }))
      return reply(err.includes('pincode') ? `${err} 📮` : err, [B.edit])
    }
    const fee = deliveryFeeFor(settings, p.subtotal)
    await saveState(fresh({ step: 'confirm', order_type: 'delivery', address, pincode }))
    const feeLine = fee > 0 ? rs(fee) : settings.deliveryFee > 0 ? `~${rs(settings.deliveryFee)}~ FREE 🎉` : 'FREE'
    return reply(
      `🧾 *Order summary*\n\n${itemList(p.lines)}\n\nItem total: ${rs(p.subtotal)}\nDelivery: ${feeLine}\n*Total: ${rs(p.subtotal + fee)}*\n\n📍 ${address}${soldOut}\n\nShall I place the order?`,
      [B.confirm, B.edit]
    )
  }

  const place = async () => {
    if (!state || state.step !== 'confirm' || !state.order_type) return askMode()
    // Claim the confirm step atomically: a double tap can only place one order.
    if (session) {
      const { data: claimed } = await db
        .from('chat_sessions')
        .update({ flow_state: { ...flow, checkout: { ...state, step: 'placing', at: new Date().toISOString() } } })
        .eq('id', session.id)
        .eq('flow_state->checkout->>step', 'confirm')
        .select('id')
      if (!claimed?.length) return reply('⏳ Placing your order…')
    }
    const result = await createCustomerOrder({
      source: 'whatsapp',
      orderType: state.order_type,
      customerName,
      customerPhone,
      deliveryAddress: state.address,
      pincode: state.pincode,
      cartItems: p.lines.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity })),
    })
    if (!result.ok) {
      await saveState(fresh({ step: 'confirm', order_type: state.order_type, address: state.address, pincode: state.pincode }))
      return reply(`Sorry, I couldn't place the order: ${result.error}`, [B.edit])
    }
    await db.from('ai_carts').update({ items: [], updated_at: new Date().toISOString() }).eq('channel_user_id', channelUserId)
    await saveState({ step: 'placing', last_order_number: result.orderNumber, at: new Date().toISOString() })
    // 22 Oct plan: send nothing on placement (customer gets invoice image + confirmation once restaurant accepts)
    return NextResponse.json({
      ok: true,
      silent: true,
      reply: '',
      order_number: result.orderNumber,
      total: result.total,
    })
  }

  switch (event) {
    case 'start':
      if (enabled.takeaway && enabled.delivery) return askMode()
      if (enabled.takeaway) return confirmTakeaway()
      if (enabled.delivery) return askAddress()
      return reply("Sorry, we're not taking WhatsApp orders right now. Please check back soon 🙏")
    case 'takeaway':
      return enabled.takeaway ? confirmTakeaway() : reply('Sorry, takeaway is not available right now.', enabled.delivery ? [B.delivery, B.edit] : [B.edit])
    case 'delivery':
      return enabled.delivery ? askAddress() : reply('Sorry, delivery is not available right now.', enabled.takeaway ? [B.takeaway, B.edit] : [B.edit])
    case 'use_last_address':
      return state?.last_address ? confirmDelivery(state.last_address) : askAddress()
    case 'address':
      return state?.step === 'await_address' ? confirmDelivery(text) : askMode()
    case 'confirm':
      return place()
  }
  return askMode()
}

