/**
 * GET /api/ai/tools/menu
 *
 * Secure server-side tool endpoint for the Rasoi AI Agent.
 * Returns the full active Rasoi menu with categories and variants.
 *
 * This endpoint is called by n8n (not by the browser).
 * It uses the Supabase admin client server-side.
 */

import { NextResponse } from 'next/server'
import { timingSafeSecretEquals } from '@/lib/server/internal-auth'
import { createAdminClient } from '@/lib/supabase/admin'

type MenuRow = {
  id: string
  item_number: number | null
  item_name: string
  category: string | null
  description: string | null
  price: number
  variants: unknown
}

export async function GET(request: Request) {
  try {
    const aiSecret = request.headers.get('x-rasoi-ai-secret')?.trim()
    const expectedSecret = process.env.RASOI_AI_WEBHOOK_SECRET?.trim()
    
    if (!timingSafeSecretEquals(aiSecret, expectedSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createAdminClient()

    // Fetch active menu items from the actual production schema
    const { data: items, error: itemsError } = await supabase
      .from('menu_items')
      .select('id, item_number, item_name, category, description, price, available, variants')
      .eq('available', true)
      .order('item_number', { ascending: true })

    if (itemsError) {
      console.error('[AI Tool: get_menu] Failed to fetch menu items:', itemsError.message)
      return NextResponse.json({ error: 'Failed to fetch menu.' }, { status: 500 })
    }

    // Build the AI-friendly menu response
    const menu = ((items ?? []) as MenuRow[]).map((item) => ({
      id: item.id,
      item_number: item.item_number,
      item_name: item.item_name,
      category: item.category || 'Uncategorized',
      description: item.description || '',
      price: item.price,
      variants: item.variants || null,
    }))

    return NextResponse.json({ menu })
  } catch (err) {
    console.error('[AI Tool: get_menu] Error:', err instanceof Error ? err.message : 'unknown error')
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
