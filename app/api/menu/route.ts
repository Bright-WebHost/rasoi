import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchProductionMenuItems } from '@/lib/menu/queries';

export const dynamic = 'force-dynamic';

/** Up to 3 items that are in 2+ real orders today (India time). Honest social proof only. */
async function popularToday(supabase: ReturnType<typeof createAdminClient>): Promise<Set<string>> {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const { data } = await supabase
      .from('orders')
      .select('id, items_json')
      .gte('created_at', new Date(`${today}T00:00:00+05:30`).toISOString())
      .not('status', 'in', '(cancelled,draft)');
    const ordersPerItem = new Map<string, number>();
    for (const order of (data ?? []) as Array<{ items_json: Array<{ item_name?: string; name?: string }> | null }>) {
      const names = new Set((Array.isArray(order.items_json) ? order.items_json : []).map((li) => String(li.item_name || li.name || '').toLowerCase().trim()).filter(Boolean));
      for (const n of names) ordersPerItem.set(n, (ordersPerItem.get(n) || 0) + 1);
    }
    return new Set([...ordersPerItem.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n));
  } catch {
    return new Set();
  }
}

export async function GET() {
  try {
    const supabase = createAdminClient();
    console.info('[GET /api/menu] Fetching menu items');
    const items = await fetchProductionMenuItems(supabase);

    if (items === null) {
      console.error('[GET /api/menu] Menu fetch failed.');
      return NextResponse.json(
        { error: 'MENU_FETCH_FAILED', message: 'Unable to load menu' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (items.length === 0) {
      console.info('[GET /api/menu] Menu fetch succeeded with zero active items.');
      return NextResponse.json({ items: [] }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }

    console.info(`[GET /api/menu] Menu fetch succeeded: ${items.length} items.`);
    const popular = await popularToday(supabase);
    const withPopular = items.map((item) => (popular.has(item.name.toLowerCase().trim()) ? { ...item, popular_today: true } : item));
    return NextResponse.json({ items: withPopular }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error: unknown) {
    console.error('[GET /api/menu] Unexpected error:', error instanceof Error ? { message: error.message } : 'Unknown error');
    return NextResponse.json(
      { error: 'MENU_FETCH_FAILED', message: 'Unable to load menu' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
