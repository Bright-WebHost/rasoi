import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function formatCartResponse(items: any[]) {
  if (!items || items.length === 0) {
    return { empty: true, items: [], total: 0, ai_system_instruction: "Tell the user their cart is empty." }
  }
  
  const total = items.reduce((sum: number, item: any) => sum + ((item.unit_price || item.price || 0) * item.quantity), 0)
  
  let formattedMessage = "We've updated your Pabbas Delivery order.\n\n*Your order:*\n";
  items.forEach(item => {
    formattedMessage += `• ${item.item_name} - ${item.quantity}\n`;
  });
  formattedMessage += `\n*Total: ₹${total}*\n\nDo you want me to add something else, or shall we place the order?`;

  return { 
    empty: false, 
    items, 
    total,
    formatted_reply_for_user: formattedMessage,
    ai_system_instruction: `CRITICAL: You MUST reply to the user using EXACTLY the text provided in the 'formatted_reply_for_user' field. Do not invent your own response. Just output the formatted_reply_for_user.`
  }
}

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

  const { channel_user_id, action, menu_item_id, quantity } = body

  if (!channel_user_id) {
    return NextResponse.json({ error: 'channel_user_id is required' }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Ensure cart exists
  const { data: cartData, error: cartError } = await adminClient
    .from('ai_carts')
    .select('items')
    .eq('channel_user_id', channel_user_id)
    .single()

  let currentItems: any[] = []
  if (!cartError && cartData?.items) {
    currentItems = Array.isArray(cartData.items) ? cartData.items : []
  }

  if (action === 'get') {
    return NextResponse.json(formatCartResponse(currentItems))
  }

  if (action === 'clear') {
    await adminClient
      .from('ai_carts')
      .upsert({ channel_user_id, items: [] }, { onConflict: 'channel_user_id' })
    return NextResponse.json(formatCartResponse([]))
  }

  // Normalize input to an array of items to process
  const itemsToProcess = Array.isArray(body.items) ? body.items : [{ menu_item_id, item_name: body.item_name, quantity }];

  if (itemsToProcess.length === 0 || (itemsToProcess.length === 1 && !itemsToProcess[0].menu_item_id && !itemsToProcess[0].item_name && !itemsToProcess[0].name && !itemsToProcess[0].item)) {
    // If the AI agent hallucinates an 'add' or 'update' action without providing any items, 
    // we should fail gracefully so the n8n workflow doesn't crash and can still send its reply text.
    return NextResponse.json(formatCartResponse(currentItems))
  }

  const errors: string[] = []

  for (const itemToProcess of itemsToProcess) {
    let actualMenuId = itemToProcess.menu_item_id;
    const incomingName = itemToProcess.item_name || itemToProcess.name || itemToProcess.item;

    if (!actualMenuId && incomingName) {
      // First try exact case-insensitive match
      const { data: exactMatch } = await adminClient.from('menu_items').select('id').ilike('item_name', incomingName).maybeSingle();
      if (exactMatch) {
        actualMenuId = exactMatch.id;
      } else {
        // Fallback to fuzzy match (e.g. "masala fries" -> "%masala%fries%")
        const fuzzyPattern = '%' + incomingName.split(' ').join('%') + '%';
        const { data: fuzzyMatch } = await adminClient.from('menu_items').select('id').ilike('item_name', fuzzyPattern).limit(1).maybeSingle();
        if (fuzzyMatch) {
          actualMenuId = fuzzyMatch.id;
        }
      }
    }

    if (!actualMenuId) {
      errors.push(`Could not find menu item matching: ${incomingName || itemToProcess.menu_item_id}`);
      continue;
    }

    // Fetch menu item details to ensure validity and get price
    const { data: menuItem, error: menuError } = await adminClient
      .from('menu_items')
      .select('id, item_name, price, available')
      .eq('id', actualMenuId)
      .single()

    if (menuError || !menuItem) {
      errors.push(`Menu item not found for ID: ${actualMenuId}`);
      continue;
    }

    if (!menuItem.available) {
      errors.push(`Menu item ${menuItem.item_name} is currently unavailable`);
      continue;
    }

    const existingItemIndex = currentItems.findIndex(i => i.menu_item_id === actualMenuId)
    
    if (action === 'add' || action === 'update') {
      const qty = Number(itemToProcess.quantity) || 1
      if (qty <= 0) {
        if (existingItemIndex > -1) currentItems.splice(existingItemIndex, 1)
      } else {
        if (existingItemIndex > -1) {
          currentItems[existingItemIndex].quantity = action === 'add' ? currentItems[existingItemIndex].quantity + qty : qty
        } else {
          currentItems.push({
            menu_item_id: menuItem.id,
            item_name: menuItem.item_name,
            unit_price: menuItem.price,
            quantity: qty
          })
        }
      }
    } else if (action === 'remove') {
      if (existingItemIndex > -1) currentItems.splice(existingItemIndex, 1)
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }
  }

  if (errors.length > 0 && currentItems.length === 0) {
    // If nothing succeeded, return the first error as a 200 so n8n doesn't crash
    return NextResponse.json({ error: errors[0], empty: true, items: [] }, { status: 200 })
  }

  const { error: upsertError } = await adminClient
    .from('ai_carts')
    .upsert({ channel_user_id, items: currentItems, updated_at: new Date().toISOString() }, { onConflict: 'channel_user_id' })

  if (upsertError) {
    return NextResponse.json({ error: 'Failed to update cart' }, { status: 500 })
  }

  return NextResponse.json(formatCartResponse(currentItems))
}
