"use client";

/* Menu cache shared by POS, Menu and Stock: loaded once per session, like
   Oceana's PMENU/MENU globals, so switching screens never refetches it. */
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/** Browser client without the generated table typings (they only cover the original tables). */
export const db = () => createClient() as unknown as SupabaseClient;

export type VariantOption = { label: string; values: string[] };
export type MenuItem = {
  id: string;
  item_number: number;
  item_name: string;
  category: string;
  price: number;
  available: boolean;
  description: string | null;
  image_url: string | null;
  variants: { options?: VariantOption[] } | null;
  is_pinned?: boolean | null;
  track_stock?: boolean | null;
  stock_qty?: number | null;
  low_stock_threshold?: number | null;
  par_level?: number | null;
  stock_updated_at?: string | null;
};

let menuCache: MenuItem[] | null = null;
let menuPromise: Promise<MenuItem[]> | null = null;
const listeners = new Set<(m: MenuItem[]) => void>();

async function loadMenu(force = false): Promise<MenuItem[]> {
  if (menuCache && !force) return menuCache;
  if (!menuPromise || force) {
    menuPromise = (async () => {
      const { data } = await createClient().from("menu_items").select("*").order("category").order("item_number");
      menuCache = (data || []) as MenuItem[];
      listeners.forEach((l) => l(menuCache!));
      return menuCache;
    })().finally(() => { menuPromise = null; });
  }
  return menuPromise;
}

export function useMenu(refreshOnMount = false) {
  const [menu, setMenu] = useState<MenuItem[]>(menuCache || []);
  const [loaded, setLoaded] = useState(Boolean(menuCache));
  useEffect(() => {
    const l = (m: MenuItem[]) => { setMenu(m); setLoaded(true); };
    listeners.add(l);
    void loadMenu(refreshOnMount);
    return () => { listeners.delete(l); };
  }, [refreshOnMount]);
  const reload = useCallback(() => loadMenu(true), []);
  /** Optimistic local edit (e.g. toggling availability) without a refetch. */
  const patch = useCallback((id: string, changes: Partial<MenuItem>) => {
    if (!menuCache) return;
    menuCache = menuCache.map((m) => (m.id === id ? { ...m, ...changes } : m));
    listeners.forEach((fn) => fn(menuCache!));
  }, []);
  return { menu, loaded, reload, patch };
}

export const FALLBACK_IMG = "/placeholder-dish.svg";

export type Ingredient = {
  id: string; name: string; category: string | null; unit: string; stock_qty: number;
  low_stock_threshold: number | null; par_level: number | null; cost_per_unit: number | null;
  nearest_expiry: string | null; track_stock: boolean; active: boolean; image_url: string | null;
  stock_updated_at: string | null;
};
export type RecipeLine = { menu_item_id: string; ingredient_id: string; qty_per_item: number };
type StockState = { ingredients: Ingredient[]; recipes: RecipeLine[]; migrated: boolean };

let stockCache: StockState | null = null;
let stockPromise: Promise<StockState> | null = null;
const stockListeners = new Set<(s: StockState) => void>();

/** Postgres "relation does not exist" — the stock migration hasn't been applied. */
const missing = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message || "")));

async function loadStock(force = false): Promise<StockState> {
  if (stockCache && !force) return stockCache;
  if (!stockPromise || force) {
    stockPromise = (async () => {
      const sb = createClient();
      const [ing, rec] = await Promise.all([
        sb.from("ingredients").select("*").eq("active", true).order("category").order("name"),
        sb.from("recipe_lines").select("menu_item_id,ingredient_id,qty_per_item"),
      ]);
      stockCache = {
        ingredients: (ing.data || []) as Ingredient[],
        recipes: (rec.data || []) as RecipeLine[],
        migrated: !missing(ing.error) && !missing(rec.error),
      };
      stockListeners.forEach((l) => l(stockCache!));
      return stockCache;
    })().finally(() => { stockPromise = null; });
  }
  return stockPromise;
}

export function useStockData(refreshOnMount = false) {
  const [state, setState] = useState<StockState | null>(stockCache);
  useEffect(() => {
    stockListeners.add(setState);
    if (!stockCache || refreshOnMount) void loadStock(refreshOnMount);
    return () => { stockListeners.delete(setState); };
  }, [refreshOnMount]);
  const reload = useCallback(() => loadStock(true), []);
  return { ...(state || { ingredients: [], recipes: [], migrated: true }), loaded: Boolean(state), reload };
}

export const isMissingTable = missing;
