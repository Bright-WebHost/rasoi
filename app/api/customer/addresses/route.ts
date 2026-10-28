import { NextResponse } from 'next/server'
import { getSessionCookie } from '@/lib/session/cookies'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const session = await getSessionCookie()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: addresses, error } = await admin
    .from('customer_addresses')
    .select('*')
    .eq('customer_id', session.customerId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch addresses' }, { status: 500 })
  }

  return NextResponse.json({ addresses })
}

export async function POST(request: Request) {
  const session = await getSessionCookie()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { address, landmark, pincode, label, is_default } = body

  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    return NextResponse.json({ error: 'Address is required' }, { status: 400 })
  }

  const cleanAddress = address.trim().slice(0, 500)
  const cleanLandmark = landmark && typeof landmark === 'string' ? landmark.trim().slice(0, 200) : null
  const cleanPincode = pincode && typeof pincode === 'string' ? pincode.trim().slice(0, 20) : null
  const cleanLabel = label && typeof label === 'string' ? label.trim().slice(0, 100) : null
  let wantsDefault = is_default === true

  const admin = createAdminClient()

  const { data: newAddress, error } = await admin.rpc('create_customer_address', {
    p_customer_id: session.customerId,
    p_address: cleanAddress,
    p_landmark: cleanLandmark,
    p_pincode: cleanPincode,
    p_label: cleanLabel,
    p_is_default: wantsDefault
  })

  if (error) {
    return NextResponse.json({ error: 'Failed to create address' }, { status: 500 })
  }

  return NextResponse.json({ address: newAddress })
}
