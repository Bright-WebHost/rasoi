import { NextResponse } from 'next/server'
import { getSessionCookie } from '@/lib/session/cookies'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionCookie()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Next.js 15+ dynamic route params are Promises
  const resolvedParams = await params
  const addressId = resolvedParams.id

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { address, landmark, pincode, label, is_default } = body

  const admin = createAdminClient()

  const { data: updatedAddress, error } = await admin.rpc('update_customer_address', {
    p_customer_id: session.customerId,
    p_address_id: addressId,
    p_address: address !== undefined ? (typeof address === 'string' && address.trim().length > 0 ? address.trim().slice(0, 500) : null) : null,
    p_landmark: landmark !== undefined ? (typeof landmark === 'string' && landmark ? landmark.trim().slice(0, 200) : null) : null,
    p_pincode: pincode !== undefined ? (typeof pincode === 'string' && pincode ? pincode.trim().slice(0, 20) : null) : null,
    p_label: label !== undefined ? (typeof label === 'string' && label ? label.trim().slice(0, 100) : null) : null,
    p_is_default: is_default !== undefined ? Boolean(is_default) : null
  })

  if (error) {
    if (error.message.includes('Address not found')) {
      return NextResponse.json({ error: 'Address not found or unauthorized' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to update address' }, { status: 500 })
  }

  return NextResponse.json({ address: updatedAddress })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionCookie()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const resolvedParams = await params
  const addressId = resolvedParams.id

  const admin = createAdminClient()

  const { data: success, error } = await admin.rpc('delete_customer_address', {
    p_customer_id: session.customerId,
    p_address_id: addressId
  })

  if (error) {
    if (error.message.includes('Address not found')) {
      return NextResponse.json({ error: 'Address not found or unauthorized' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to delete address' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
