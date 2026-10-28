import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  try {
    const adminClient = createAdminClient()
    const { data: tables, error } = await adminClient
      .from('restaurant_tables')
      .select('*')
      .eq('is_active', true)
      .order('table_number', { ascending: true })

    if (error) {
      console.error('[GET /api/tables] Supabase error:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ tables })
  } catch (err: any) {
    console.error('[GET /api/tables] Internal error:', err)
    return NextResponse.json({ error: err?.message || 'Failed to fetch tables' }, { status: 500 })
  }
}
