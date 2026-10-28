import { NextResponse } from 'next/server'
import { toPublicSettings } from '@/lib/settings'
import { getActivePincodes, getSettings } from '@/lib/settings/server'

export const dynamic = 'force-dynamic'

/** Customer-safe restaurant settings (no passcodes, no staff data). */
export async function GET() {
  try {
    const [settings, pincodes] = await Promise.all([getSettings(), getActivePincodes()])
    return NextResponse.json(toPublicSettings(settings, pincodes), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[GET /api/settings/public] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Unable to load settings' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
