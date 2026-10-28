/**
 * GET /api/ai/tools/menu
 *
 * Secure server-side tool endpoint for the Pabbas AI Agent.
 * Returns the full active Pabbas menu with categories and variants.
 *
 * This endpoint is called by n8n (not by the browser).
 * It uses the Supabase admin client server-side.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: Request) {
  try {
    const aiSecret = request.headers.get('x-pabbas-ai-secret')?.trim()
    const expectedSecret = process.env.PABBAS_AI_WEBHOOK_SECRET?.trim()
    
    if (!expectedSecret || aiSecret !== expectedSecret) {
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
    const menu = (items as any[]).map((item) => ({
      id: item.id,
      item_number: item.item_number,
      item_name: item.item_name,
      category: item.category || 'Uncategorized',
      description: item.description || '',
      price: item.price,
      variants: item.variants || null,
    }))

    return NextResponse.json({ menu })
  } catch (err: any) {
    console.error('[AI Tool: get_menu] Error:', err)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}
