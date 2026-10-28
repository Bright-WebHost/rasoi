import type { SupabaseClient } from '@supabase/supabase-js'
import type { MenuItem } from '@/lib/types'
import type { Database, SupabaseMenuRow, MenuItemRow } from '@/lib/supabase/types'
import { menuItems as localMenuItems, categories as localCategories, featuredItems as localFeaturedItems, displayCategory } from '@/lib/menu-data'

// ---------------------------------------------------------------------------
// Helpers — transform a Supabase row into the frontend MenuItem shape
// ---------------------------------------------------------------------------

/**
 * Generates a deterministic placeholder image URL from a menu item name.
 */
function placeholderImage(name: string): string {
  const photos = [
    'photo-1579954115545-a95591f28bfc',
    'photo-1551024601-bec78aea704b',
    'photo-1497034825429-c343d7c6a68f',
    'photo-1560008581-09826d1de69e',
    'photo-1572490122747-3968b75cc699',
    'photo-1563805042-7684c019e1cb',
    'photo-1570197788417-0e82375c9371',
  ]
  const idx = name.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % photos.length
  return `https://images.unsplash.com/${photos[idx]}?auto=format&fit=crop&w=900&q=85`
}

/**
 * Converts a Supabase legacy `menu` row to the frontend `MenuItem` type.
 */
function rowToMenuItem(row: SupabaseMenuRow): MenuItem {
  return {
    id: String(row.id),
    name: row.name,
    category: row.category,
    description: row.description,
    price: row.price,
    image: placeholderImage(row.name),
    vegetarian: row.vegetarian,
  }
}

/**
 * Converts a production `menu_items` row from the verified live schema into the
 * frontend `MenuItem` shape used by the current website UI.
 */
function rowToProductionMenuItem(row: {
  id: string
  item_name: string
  category: string | null
  price: number | string | null
  description: string | null
  image_url: string | null
  available?: boolean | null
  variants?: unknown
  item_number?: number | null
  is_pinned?: boolean | null
  vegetarian?: boolean | null
  is_veg?: boolean | null
}): MenuItem {
  const safePrice = typeof row.price === 'number' ? row.price : Number(row.price ?? 0)

  // Determine if item is vegetarian:
  // 1. Explicit boolean property if present in row (row.vegetarian or row.is_veg)
  // 2. Keyword detection in item name, category, or description
  // 3. Default to true (Pabbas is an iconic pure-vegetarian dairy & ice cream brand)
  const text = `${row.item_name || ''} ${row.category || ''} ${row.description || ''}`
  const isExplicitNonVeg =
    row.vegetarian === false ||
    row.is_veg === false ||
    /\b(non-?veg|chicken|mutton|fish|meat|prawn|crab)\b/i.test(text)

  const isVegetarian =
    row.vegetarian === true ||
    row.is_veg === true ||
    !isExplicitNonVeg

  return {
    id: String(row.id),
    name: row.item_name || 'Unnamed item',
    category: row.category || 'General',
    description: row.description || '',
    price: Number.isFinite(safePrice) ? safePrice : 0,
    image: row.image_url || placeholderImage(row.item_name || 'item'),
    vegetarian: isVegetarian,
    badge: undefined,
    featured: undefined,
    is_pinned: row.is_pinned ?? false,
    options: Array.isArray(row.variants) ? row.variants.map((variant: any) => ({
      label: typeof variant?.name === 'string' ? variant.name : 'Variant',
      values: typeof variant?.options === 'object' && variant?.options
        ? Array.isArray((variant as any).options)
          ? (variant as any).options.map((opt: any) => String(opt ?? ''))
          : []
        : [],
    })) : undefined,
  }
}

// ---------------------------------------------------------------------------
// Query functions (server-side)
// ---------------------------------------------------------------------------

type SupabaseServerClient = SupabaseClient<Database>

/**
 * Fetches all active production menu items from Supabase menu_items table.
 */
export async function fetchProductionMenuItems(client: SupabaseServerClient): Promise<MenuItem[] | null> {
  const { data, error } = await client
    .from('menu_items')
    .select('*')
    .eq('available', true)
    .order('item_number', { ascending: true })

  if (error) {
    console.error('[menu/queries] Failed to fetch production menu items:', error.message)
    return null
  }

  return (data ?? []).map((row: any) => rowToProductionMenuItem(row))
}

/**
 * Legacy query: Fetches all menu items from practice `menu` table.
 */
export async function fetchMenuItems(client: SupabaseServerClient): Promise<MenuItem[] | null> {
  const { data, error } = await client
    .from('menu')
    .select('*')
    .order('id', { ascending: true })

  if (error) {
    console.error('[menu/queries] Failed to fetch menu items:', error.message)
    return null
  }

  return data.map(rowToMenuItem)
}

/**
 * Legacy query: Fetches a single menu item by its database id.
 */
export async function fetchMenuItemById(client: SupabaseServerClient, id: number): Promise<MenuItem | null> {
  const { data, error } = await client
    .from('menu')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('[menu/queries] Failed to fetch menu item:', error.message)
    return null
  }

  return rowToMenuItem(data)
}

// ---------------------------------------------------------------------------
// Local fallback accessors
// ---------------------------------------------------------------------------

export function getLocalMenuItems(): MenuItem[] {
  return localMenuItems
}

export function getLocalCategories(): string[] {
  return localCategories
}

export function getLocalFeaturedItems(): MenuItem[] {
  return localFeaturedItems
}

export { displayCategory }

