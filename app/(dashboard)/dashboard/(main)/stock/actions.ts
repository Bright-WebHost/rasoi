"use server";

import { authorize } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";

type StockEntity = "menu_item" | "ingredient";

export async function recordStockChange(input: {
  entity_type: StockEntity;
  entity_id: string;
  stock_qty: number;
  reason: "manual_adjust" | "restock" | "waste" | "top_up_par" | "stock_take";
  qty_change: number;
  supplier_name?: string | null;
  cost_per_unit?: number | null;
  total_cost?: number | null;
  expiry_date?: string | null;
  note?: string | null;
}) {
  const staff = await authorize("manage_stock");
  if (!["menu_item", "ingredient"].includes(input.entity_type) || !["manual_adjust", "restock", "waste", "top_up_par", "stock_take"].includes(input.reason)) {
    return { success: false, error: "Invalid stock change." };
  }
  const balance = Number(input.stock_qty);
  const delta = Number(input.qty_change);
  const cost = input.cost_per_unit == null ? null : Number(input.cost_per_unit);
  const totalCost = input.total_cost == null ? null : Number(input.total_cost);
  if (!input.entity_id || !Number.isFinite(balance) || balance < 0 || !Number.isFinite(delta)) {
    return { success: false, error: "Enter a valid stock count." };
  }
  if (cost != null && (!Number.isFinite(cost) || cost < 0) || totalCost != null && (!Number.isFinite(totalCost) || totalCost < 0)) {
    return { success: false, error: "Stock costs must be zero or greater." };
  }
  if (input.reason === "restock" && delta <= 0) return { success: false, error: "Restock quantity must be positive." };
  if (input.reason === "waste" && delta >= 0) return { success: false, error: "Waste quantity must be positive." };
  if (input.supplier_name && input.supplier_name.length > 120) return { success: false, error: "Keep supplier names under 120 characters." };
  if (input.note && input.note.length > 500) return { success: false, error: "Keep stock notes under 500 characters." };
  if (input.expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(input.expiry_date)) return { success: false, error: "Choose a valid expiry date." };

  const { data, error } = await createAdminClient().rpc("apply_stock_change", {
    p_entity_type: input.entity_type,
    p_entity_id: input.entity_id,
    p_stock_qty: balance,
    p_reason: input.reason,
    p_qty_change: delta,
    p_staff: staff.email.split("@")[0],
    p_supplier_name: input.supplier_name ?? null,
    p_cost_per_unit: cost,
    p_total_cost: totalCost,
    p_expiry_date: input.expiry_date ?? null,
    p_note: input.note ?? null,
  });
  if (error) {
    const missingFunction = error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message);
    return { success: false, error: missingFunction ? "Apply the stock migration before changing counts." : "Could not save the stock change." };
  }
  const savedQty = Number(data);
  return { success: true, stock_qty: Number.isFinite(savedQty) ? savedQty : balance };
}

export async function saveMenuStockSettings(input: {
  menu_item_id: string;
  track_stock: boolean;
  low_stock_threshold: number | null;
  par_level: number | null;
}) {
  await authorize("manage_stock");
  if (!input.menu_item_id) return { success: false, error: "Menu item is required." };
  const levels = [input.low_stock_threshold, input.par_level].filter((n) => n != null);
  if (levels.some((n) => !Number.isFinite(Number(n)) || Number(n) < 0)) {
    return { success: false, error: "Stock thresholds must be zero or greater." };
  }
  const { error } = await createAdminClient().from("menu_items").update({
    track_stock: input.track_stock,
    low_stock_threshold: input.track_stock ? input.low_stock_threshold : null,
    par_level: input.track_stock ? input.par_level : null,
  }).eq("id", input.menu_item_id);
  if (error) {
    const missingColumn = error.code === "42703" || /column .* does not exist/i.test(error.message);
    return { success: false, error: missingColumn ? "Apply the stock migration before changing tracking." : "Could not save stock tracking." };
  }
  return { success: true };
}

export async function saveIngredient(input: {
  id?: string;
  name: string;
  category: string;
  unit: "kg" | "g" | "l" | "ml" | "pcs";
  low_stock_threshold: number | null;
  par_level: number | null;
  cost_per_unit: number | null;
  nearest_expiry: string | null;
}) {
  await authorize("manage_stock");
  const name = input.name.trim();
  const category = input.category.trim();
  if (!name) return { success: false, error: "Ingredient name is required." };
  if (name.length > 120 || category.length > 80 || !["kg", "g", "l", "ml", "pcs"].includes(input.unit)) {
    return { success: false, error: "Check the ingredient name, category and unit." };
  }
  const numeric = [input.low_stock_threshold, input.par_level, input.cost_per_unit].filter((n) => n != null);
  if (numeric.some((n) => !Number.isFinite(Number(n)) || Number(n) < 0)) {
    return { success: false, error: "Stock levels and cost must be zero or greater." };
  }
  if (input.nearest_expiry && !/^\d{4}-\d{2}-\d{2}$/.test(input.nearest_expiry)) return { success: false, error: "Choose a valid expiry date." };

  const record = {
    name,
    category: category || null,
    unit: input.unit,
    low_stock_threshold: input.low_stock_threshold,
    par_level: input.par_level,
    cost_per_unit: input.cost_per_unit,
    nearest_expiry: input.nearest_expiry || null,
    track_stock: true,
    active: true,
  };
  const sb = createAdminClient();
  const result = input.id
    ? await sb.from("ingredients").update(record).eq("id", input.id).select("id").single()
    : await sb.from("ingredients").insert(record).select("id").single();
  if (result.error) {
    const duplicate = result.error.code === "23505";
    return { success: false, error: duplicate ? "An ingredient with that name already exists." : "Could not save the ingredient." };
  }
  return { success: true, id: (result.data as { id: string }).id };
}

/** Deletes an ingredient; one used by a recipe can only be archived (hidden, recipe intact). */
export async function deleteIngredient(id: string, archive = false) {
  await authorize("manage_stock");
  const sb = createAdminClient();
  const { error } = archive
    ? await sb.from("ingredients").update({ active: false }).eq("id", id)
    : await sb.from("ingredients").delete().eq("id", id);
  if (error) return { success: false, inUse: error.code === "23503", error: "Could not delete the ingredient." };
  return { success: true, inUse: false };
}
