import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { gstBreakup } from '@/lib/settings'
import { getSettings } from '@/lib/settings/server'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orderNumber = searchParams.get('order_number')

    if (!orderNumber) {
      return new Response('Order number is required', { status: 400 })
    }

    const adminClient = createAdminClient()
    const [{ data: order, error }, settings] = await Promise.all([
      adminClient.from('orders').select('*, order_items(*)').eq('order_number', orderNumber).single(),
      getSettings(),
    ])

    if (error || !order) {
      return new Response('Order not found', { status: 404 })
    }

    const rawItems = (order.order_items && order.order_items.length > 0)
      ? order.order_items
      : (Array.isArray(order.items_json) ? order.items_json : [])
    const items = rawItems.map((item: any, idx: number) => ({
      id: item.id || `item-${idx}`,
      item_name: item.item_name || item.name || 'Item',
      quantity: Number(item.quantity) || 1,
      unit_price: Number(item.unit_price || item.price || 0)
    }))
    
    const itemsSubtotal = items.reduce((sum: number, item: any) => sum + item.unit_price * item.quantity, 0)
    const deliveryFee = Number(order.delivery_fee || 0)
    const gst = gstBreakup(itemsSubtotal, settings.gstPercent)
    const summaryRows: Array<[string, string]> = [
      ['Item Total', `₹${itemsSubtotal.toFixed(2)}`],
      ...(deliveryFee > 0 ? [['Delivery Fee', `₹${deliveryFee.toFixed(2)}`] as [string, string]] : []),
      ...(gst ? [[`Incl. CGST ${gst.halfRate}% + SGST ${gst.halfRate}%`, `₹${(gst.cgst + gst.sgst).toFixed(2)}`] as [string, string]] : []),
    ]

    // Format date nicely
    const date = new Date(order.created_at).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })

    const pmRaw = String(order.payment_method || '').toLowerCase()
    const payLabel = pmRaw === 'upi' ? 'UPI' : pmRaw === 'card' ? 'CARD' : 'CASH'
    const typeLabel = order.order_type === 'dine-in' ? 'DINE-IN' : String(order.order_type || 'delivery').toUpperCase()
    const deliverTo = order.order_type === 'delivery'
      ? [order.address, order.landmark, order.city, order.pincode].filter(Boolean).join(', ')
      : order.order_type === 'dine-in' && order.table_number ? `Table ${order.table_number}` : ''
    const RED = '#c8102e'
    const label = { fontSize: '13px', color: '#9ca3af', letterSpacing: '1px' } as const

    return new ImageResponse(
      (
        <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', fontFamily: 'sans-serif' }}>
          {/* Header */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 32px 22px', borderBottom: '2px dashed #e5e7eb' }}>
            <span style={{ fontSize: '40px', fontWeight: 800, color: RED, letterSpacing: '2px' }}>{settings.restaurantName.toUpperCase()}</span>
            {settings.tagline ? <span style={{ fontSize: '16px', color: '#6b7280', marginTop: '6px' }}>{settings.tagline}</span> : null}
            {settings.address ? <span style={{ fontSize: '14px', color: '#9ca3af', marginTop: '4px' }}>{settings.address}</span> : null}
            {settings.phone ? <span style={{ fontSize: '14px', color: '#9ca3af', marginTop: '2px' }}>{settings.phone}</span> : null}
            {settings.gstin ? <span style={{ fontSize: '13px', color: '#9ca3af', marginTop: '2px' }}>GSTIN: {settings.gstin}</span> : null}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', padding: '22px 32px 0' }}>
            {/* Payment pill */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', backgroundColor: RED, color: '#ffffff', fontSize: '15px', fontWeight: 700, letterSpacing: '1.5px', padding: '7px 20px', borderRadius: '999px' }}>
                {payLabel} · {typeLabel}
              </div>
            </div>

            {/* Order no + date */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={label}>ORDER</span>
                <span style={{ fontSize: '24px', fontWeight: 800, color: '#111827' }}>{order.order_number}</span>
              </div>
              <span style={{ fontSize: '15px', color: '#6b7280' }}>{date}</span>
            </div>

            {/* Customer + deliver to */}
            <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#f9fafb', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px' }}>
              <span style={label}>CUSTOMER</span>
              <span style={{ fontSize: '19px', fontWeight: 700, color: '#111827' }}>{order.customer_name || 'Guest'}</span>
              {deliverTo ? (
                <div style={{ display: 'flex', flexDirection: 'column', marginTop: '8px' }}>
                  <span style={label}>{order.order_type === 'delivery' ? 'DELIVER TO' : 'TABLE'}</span>
                  <span style={{ fontSize: '15px', color: '#374151' }}>{deliverTo}</span>
                </div>
              ) : null}
            </div>

            {/* Items */}
            <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '14px' }}>
              {items.map((item: any) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontSize: '17px', color: '#111827' }}>{item.quantity}x {item.item_name}</span>
                  <span style={{ fontSize: '17px', fontWeight: 600, color: '#111827' }}>Rs {(item.unit_price * item.quantity).toFixed(0)}</span>
                </div>
              ))}
            </div>

            {/* Summary */}
            {summaryRows.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px dashed #e5e7eb', paddingTop: '10px', marginBottom: '14px' }}>
                {summaryRows.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '14px', color: '#6b7280' }}>{k}</span>
                    <span style={{ fontSize: '14px', color: '#374151' }}>{v}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Total box */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: RED, borderRadius: '12px', padding: '16px 22px' }}>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff', letterSpacing: '2px' }}>TOTAL</span>
              <span style={{ fontSize: '32px', fontWeight: 800, color: '#ffffff' }}>Rs {Number(order.total).toFixed(0)}</span>
            </div>

            <span style={{ fontSize: '14px', color: '#9ca3af', textAlign: 'center', alignSelf: 'center', marginTop: '18px' }}>Thank you for ordering with {settings.restaurantName}!</span>
          </div>
        </div>
      ),
      {
        width: 600,
        height: 550 + items.length * 34 + summaryRows.length * 24 + (deliverTo ? 60 : 0) + (settings.gstin ? 20 : 0) + (settings.phone ? 20 : 0),
      }
    )
  } catch (e: any) {
    console.error(e)
    return new Response('Failed to generate receipt', { status: 500 })
  }
}
