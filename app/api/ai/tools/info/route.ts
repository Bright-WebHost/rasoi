import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { closedMessage, isOpenAt } from '@/lib/settings'
import { getDeliveryPincodes, getSettings } from '@/lib/settings/server'

export async function POST(request: Request) {
  const secretHeader = request.headers.get('x-pabbas-ai-secret')?.trim()
  const expectedSecret = process.env.PABBAS_AI_WEBHOOK_SECRET?.trim()

  if (!expectedSecret || secretHeader !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Since info is small, returning all verified info is efficient and prevents hallucination.
  // Settings (edited by the admin in the dashboard) win over the older restaurant_info rows.
  const [{ data: legacyInfo, error }, settings, pincodes] = await Promise.all([
    adminClient.from('restaurant_info').select('info_key, info_value'),
    getSettings(),
    getDeliveryPincodes(),
  ])

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch restaurant info' }, { status: 500 })
  }

  const info = new Map<string, string>()
  for (const row of (legacyInfo ?? []) as Array<{ info_key: string; info_value: string }>) {
    if (row.info_value && !row.info_value.includes('PENDING')) info.set(row.info_key, row.info_value)
  }

  const activePincodes = pincodes.filter((p) => p.active)
  const types = [settings.orderTypes.delivery && 'Delivery', settings.orderTypes.takeaway && 'Takeaway', settings.orderTypes.dineIn && 'Dine-in'].filter(Boolean)
  const fromSettings: Record<string, string> = {
    restaurant_name: settings.restaurantName,
    tagline: settings.tagline,
    address: settings.address,
    phone: settings.phone,
    city: settings.city,
    opening_hours: settings.hoursText,
    open_now: isOpenAt(settings) ? 'Yes, we are open and taking orders right now.' : closedMessage(settings),
    order_types: types.length ? `We accept: ${types.join(', ')}.` : '',
    minimum_order: settings.minOrder > 0 ? `Minimum order for delivery is Rs ${settings.minOrder}.` : 'There is no minimum order.',
    delivery_charges:
      settings.deliveryFee > 0
        ? `Delivery fee is Rs ${settings.deliveryFee}${settings.freeDeliveryAbove > 0 ? `, free for orders of Rs ${settings.freeDeliveryAbove} or more` : ''}.`
        : 'Delivery is free.',
    delivery_note: settings.deliveryNote,
    delivery_areas: activePincodes.length
      ? `We deliver to these pincodes: ${activePincodes.map((p) => (p.area ? `${p.pincode} (${p.area})` : p.pincode)).join(', ')}.`
      : '',
    payment_methods: settings.paymentMethods,
    google_review_link: settings.googleReviewUrl,
    when_you_dont_know: settings.unknownPolicy,
  }
  for (const [key, value] of Object.entries(fromSettings)) {
    if (value) info.set(key, value)
  }

  return NextResponse.json({
    info: Array.from(info, ([info_key, info_value]) => ({ info_key, info_value })),
  })
}
