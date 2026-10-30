"use client";

/* Oceana's shared stock-ledger actions for dishes and ingredients:
   ± count, top up to par, restock (supplier/cost/expiry), waste, history. */
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOc } from "./DashShell";
import { useMenu, useStockData, type Ingredient, type MenuItem, type RecipeLine } from "./oc-data";
import { ist } from "./oc-utils";
import { recordStockChange } from "./(main)/stock/actions";

export type EntityType = "menu_item" | "ingredient";
type Ref = { type: EntityType; id: string; name: string; unit: string; qty: number; par: number | null };

export const thresholdOf = (x: { low_stock_threshold?: number | null }, settings: Record<string, string>) =>
  x.low_stock_threshold != null ? Number(x.low_stock_threshold) : Number(settings.low_stock_threshold || 5);

export function maxMakeable(menuItemId: string, recipes: RecipeLine[], ingredients: Ingredient[]) {
  const lines = recipes.filter((l) => l.menu_item_id === menuItemId);
  if (!lines.length) return null;
  let max = Infinity;
  for (const l of lines) {
    const ing = ingredients.find((i) => i.id === l.ingredient_id);
    const possible = ing ? Math.floor(Number(ing.stock_qty) / Number(l.qty_per_item)) : 0;
    if (possible < max) max = possible;
  }
  return max === Infinity ? 0 : Math.max(0, max);
}

const REASON_LABEL: Record<string, string> = {
  sale: "Sale", restock: "Restock", manual_adjust: "Manual adjustment", cancel_restore: "Order cancelled",
  waste: "Waste", top_up_par: "Top up to par", stock_take: "Stock take",
};

export function useStockActions() {
  const { toast } = useOc();
  const { patch } = useMenu();
  const { recipes, reload } = useStockData();
  const [modal, setModal] = useState<React.ReactNode>(null);
  const close = () => setModal(null);

  const refOf = (type: EntityType, x: MenuItem | Ingredient): Ref => type === "menu_item"
    ? { type, id: x.id, name: (x as MenuItem).item_name, unit: "pcs", qty: Number(x.stock_qty || 0), par: x.par_level ?? null }
    : { type, id: x.id, name: (x as Ingredient).name, unit: (x as Ingredient).unit, qty: Number(x.stock_qty || 0), par: x.par_level ?? null };

  /** Writes the new count, logs the movement and refreshes the local cache. */
  const write = async (r: Ref, next: number, reason: "manual_adjust" | "restock" | "waste" | "top_up_par" | "stock_take", delta: number, extra: Record<string, unknown> = {}) => {
    const result = await recordStockChange({
      entity_type: r.type,
      entity_id: r.id,
      stock_qty: next,
      reason,
      qty_change: delta,
      supplier_name: typeof extra.supplier_name === "string" ? extra.supplier_name : null,
      cost_per_unit: typeof extra.cost_per_unit === "number" ? extra.cost_per_unit : null,
      total_cost: typeof extra.total_cost === "number" ? extra.total_cost : null,
      expiry_date: typeof extra.expiry_date === "string" ? extra.expiry_date : null,
      note: typeof extra.note === "string" ? extra.note : null,
    });
    if (!result.success) { toast(result.error || "Could not update stock"); return false; }
    const savedQty = result.stock_qty ?? next;
    if (r.type === "menu_item") patch(r.id, { stock_qty: savedQty });
    else void reload();
    return true;
  };

  const bump = async (type: EntityType, x: MenuItem | Ingredient, d: number) => {
    const r = refOf(type, x);
    const next = Math.max(0, r.qty + d);
    await write(r, next, "manual_adjust", next - r.qty);
  };
  const topUp = async (type: EntityType, x: MenuItem | Ingredient) => {
    const r = refOf(type, x);
    if (r.par == null) return;
    if (await write(r, r.par, "top_up_par", r.par - r.qty)) toast(r.name + " topped up to " + r.par);
  };

  const restock = async (type: EntityType, x: MenuItem | Ingredient) => {
    const r = refOf(type, x);
    const { data } = await createClient().from("stock_movements").select("supplier_name").not("supplier_name", "is", null).limit(500);
    const suppliers = [...new Set((data || []).map((s: { supplier_name: string }) => s.supplier_name))].sort();
    setModal(<RestockModal r={r} suppliers={suppliers} onCancel={close} onSave={async (qty, supplier, cost, expiry, note) => {
      const next = r.qty + qty;
      const ok = await write(r, next, "restock", qty, {
        supplier_name: supplier, cost_per_unit: cost, total_cost: cost != null ? Math.round(cost * qty * 100) / 100 : null, expiry_date: expiry, note,
      });
      if (ok) { close(); toast("Restocked " + r.name + " +" + qty + " " + r.unit); }
    }} />);
  };

  const waste = (type: EntityType, x: MenuItem | Ingredient) => {
    const r = refOf(type, x);
    setModal(<WasteModal r={r} onCancel={close} onSave={async (qty, note) => {
      if (qty > r.qty) { toast("Waste quantity cannot exceed current stock"); return; }
      const next = Math.max(0, r.qty - qty);
      if (await write(r, next, "waste", next - r.qty, { note })) { close(); toast("Logged waste: " + r.name + " −" + qty + " " + r.unit); }
    }} />);
  };

  const history = async (type: EntityType, x: MenuItem | Ingredient, menu: MenuItem[]) => {
    const r = refOf(type, x);
    const { data } = await createClient().from("stock_movements").select("*").eq("entity_type", type).eq("entity_id", r.id).order("created_at", { ascending: false }).limit(50);
    const rows = (data || []) as Array<{ id: string; created_at: string; reason: string; note: string | null; supplier_name: string | null; staff: string | null; qty_change: number; balance_after: number }>;
    const usedIn = type === "ingredient" ? menu.filter((m) => recipes.some((l) => l.ingredient_id === r.id && l.menu_item_id === m.id)) : null;
    setModal(
      <div className="modal"><div className="mcard">
        <h3>History — {r.name}</h3>
        {usedIn ? <p style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", margin: "-2px 0 10px" }}>{usedIn.length ? `Used in ${usedIn.length} dish${usedIn.length === 1 ? "" : "es"}: ${usedIn.map((m) => m.item_name).join(", ")}` : "Not used in any recipe"}</p> : null}
        {rows.length ? <div className="ledger">{rows.map((m) => (
          <div key={m.id}><span>{ist(m.created_at)} · {REASON_LABEL[m.reason] || m.reason}{m.note ? " · " + m.note : ""}{m.supplier_name ? " · " + m.supplier_name : ""} · {m.staff}</span>
            <b>{Number(m.qty_change) > 0 ? "+" : ""}{m.qty_change} → {m.balance_after}</b></div>
        ))}</div> : <div className="none">No stock movements recorded yet</div>}
        <div className="mrow" style={{ marginTop: 10 }}><button className="go" onClick={close}>Close</button></div>
      </div></div>,
    );
  };

  return { bump, topUp, restock, waste, history, modal, setModal };
}

function RestockModal({ r, suppliers, onCancel, onSave }: {
  r: Ref; suppliers: string[]; onCancel: () => void;
  onSave: (qty: number, supplier: string | null, cost: number | null, expiry: string | null, note: string | null) => Promise<void>;
}) {
  const { toast } = useOc();
  const [v, setV] = useState({ qty: "", supplier: "", cost: "", expiry: "", note: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <div className="modal"><div className="mcard">
      <h3>Restock {r.name}</h3>
      <input className="f2" inputMode="decimal" placeholder={`Quantity received (${r.unit}) *`} autoFocus value={v.qty} onChange={set("qty")} />
      <input className="f2" list="rsupplierlist" placeholder="Supplier (optional)" value={v.supplier} onChange={set("supplier")} />
      <datalist id="rsupplierlist">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
      <input className="f2" inputMode="decimal" placeholder={`Cost per ${r.unit} (optional)`} value={v.cost} onChange={set("cost")} />
      {r.type === "ingredient" ? <>
        <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", display: "block", margin: "-2px 0 4px" }}>Expiry date (optional)</label>
        <input className="f2" type="date" value={v.expiry} onChange={set("expiry")} />
      </> : null}
      <input className="f2" placeholder="Note (optional)" value={v.note} onChange={set("note")} />
      <div className="mrow"><button onClick={onCancel}>Cancel</button><button className="go" onClick={() => {
        const qty = Number(v.qty);
        if (!qty || qty <= 0) { toast("Enter the quantity received"); return; }
        void onSave(qty, v.supplier.trim() || null, v.cost.trim() === "" ? null : Number(v.cost), v.expiry || null, v.note.trim() || null);
      }}>Record</button></div>
    </div></div>
  );
}

function WasteModal({ r, onCancel, onSave }: { r: Ref; onCancel: () => void; onSave: (qty: number, note: string) => Promise<void> }) {
  const { toast } = useOc();
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="modal"><div className="mcard">
      <h3>Log waste — {r.name}</h3>
      <input className="f2" inputMode="decimal" placeholder={`Quantity (${r.unit}) *`} autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
      <input className="f2" placeholder="Reason (required) — e.g. spoiled, dropped" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mrow"><button onClick={onCancel}>Cancel</button><button className="x" onClick={() => {
        const n = Number(qty);
        if (!n || n <= 0) { toast("Enter the quantity"); return; }
        if (!note.trim()) { toast("A reason is required for waste"); return; }
        void onSave(n, note.trim());
      }}>Log waste</button></div>
    </div></div>
  );
}

/** The stock strip under a dish/ingredient card. */
export function StockRow({ type, x, actions, menu }: {
  type: EntityType; x: MenuItem | Ingredient; actions: ReturnType<typeof useStockActions>; menu: MenuItem[];
}) {
  const { settings } = useOc();
  const qty = Number(x.stock_qty || 0);
  const unit = type === "menu_item" ? "pcs" : (x as Ingredient).unit;
  const thr = thresholdOf(x, settings);
  const warn = qty <= 0 ? "out" : qty <= thr ? "low" : "";
  const qn = unit === "pcs" ? String(qty) : qty + " " + unit;
  return (
    <div className={`mi-stockrow${warn ? " " + warn : ""}`}>
      <div className="mi-stocktop">
        <span>{warn === "out" ? "Out of stock" : warn === "low" ? qn + " left" : qn + " in stock"}</span>
        <div className="stp"><button onClick={() => void actions.bump(type, x, -1)}>−</button><b>{qty}</b><button onClick={() => void actions.bump(type, x, 1)}>+</button></div>
      </div>
      {x.par_level != null && qty < Number(x.par_level) ? <button className="chip" onClick={() => void actions.topUp(type, x)}>Top up to {x.par_level}</button> : null}
      <div className="mi-stockacts">
        <button onClick={() => void actions.restock(type, x)}>📥 Restock</button>
        <button onClick={() => actions.waste(type, x)}>🗑️ Waste</button>
        <button onClick={() => void actions.history(type, x, menu)}>📜 History</button>
      </div>
    </div>
  );
}

export function NotMigrated() {
  return (
    <div className="pnlwarn">
      ⚠ <b>Stock tables aren&apos;t set up in the database yet.</b> Apply <code>supabase/migrations/20261031_stock_pnl.sql</code> to Rasoi&apos;s
      Supabase project, then refresh this page.
    </div>
  );
}
