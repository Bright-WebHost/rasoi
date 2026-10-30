"use client";

/* Oceana Menu Management: card grid per category, availability switch, pin,
   edit/delete, and the add/edit modal with combo picker, stock and recipe. */
import { useState } from "react";
import { useOc } from "../../DashShell";
import { db, FALLBACK_IMG, useMenu, useStockData, type MenuItem } from "../../oc-data";
import { maxMakeable, StockRow, thresholdOf, useStockActions } from "../../StockKit";
import { rs } from "../../oc-utils";
import { deleteMenuItem, saveMenuItem, setMenuItemAvailable, setMenuItemPinned, uploadMenuImage } from "./actions";
import { recordStockChange, saveMenuStockSettings } from "../stock/actions";

/** "Size: Regular, Large" lines <-> Rasoi's variants JSON. */
const variantsToText = (v: MenuItem["variants"]) => (v?.options || []).map((o) => `${o.label}: ${o.values.join(", ")}`).join("\n");
const textToVariants = (t: string) => {
  const options = t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [label, rest = ""] = l.split(":");
    return { label: label.trim(), values: rest.split(",").map((x) => x.trim()).filter(Boolean) };
  }).filter((o) => o.label && o.values.length);
  return options.length ? { options } : null;
};

export function MenuCard({ m, actions, onEdit }: { m: MenuItem; actions: ReturnType<typeof useStockActions>; onEdit: (m: MenuItem) => void }) {
  const { toast } = useOc();
  const { menu, patch, reload } = useMenu();
  const { recipes, ingredients } = useStockData();
  const hasRecipe = recipes.some((r) => r.menu_item_id === m.id);
  const toggleAvail = async () => {
    const next = !m.available;
    const r = await setMenuItemAvailable(m.id, next);
    if (!r.success) { toast("Could not update"); return; }
    patch(m.id, { available: next });
    toast(m.item_name + (next ? " back on the menu" : " marked sold out"));
  };
  const togglePin = async () => {
    const next = !m.is_pinned;
    const r = await setMenuItemPinned(m.id, next);
    if (!r.success) { toast("Could not update"); return; }
    patch(m.id, { is_pinned: next });
    toast(m.item_name + (next ? " pinned to top of customer menu" : " unpinned"));
  };
  const del = async () => {
    if (!confirm("Delete " + m.item_name + "? This removes it from the menu permanently.")) return;
    const r = await deleteMenuItem(m.id);
    if (!r.success) { toast("Could not delete — it may still be on past orders"); return; }
    toast(m.item_name + " deleted");
    void reload();
  };
  const max = hasRecipe ? maxMakeable(m.id, recipes, ingredients) : null;
  return (
    <div className={`micard ${m.available ? "" : "off"} ${m.is_pinned ? "pinned" : ""}`}>
      <div className="mi-imgwrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.image_url || FALLBACK_IMG} alt="" loading="lazy" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_IMG; }} />
        <span className="mi-num2">#{m.item_number}</span>
        {m.is_pinned ? <span className="mi-pin">📌 Featured</span> : null}
        {m.available ? null : <div className="mi-sold">Sold out</div>}
      </div>
      <div className="mi-body2">
        <b>{m.item_name}</b>
        {m.description ? <p>{m.description}</p> : null}
        <div className="mi-price2">{rs(m.price)}</div>
      </div>
      {m.track_stock ? <StockRow type="menu_item" x={m} actions={actions} menu={menu} />
        : hasRecipe ? (
          <div className={`mi-stockrow${(max ?? 0) <= 0 ? " out" : ""}`}>
            <div className="mi-stocktop"><span>{(max ?? 0) <= 0 ? "Can't make any right now" : `Can make ${max} more`}</span></div>
            <div className="mi-stockacts"><button onClick={() => onEdit(m)}>✏️ Edit Recipe</button></div>
          </div>
        ) : null}
      <div className="mi-foot">
        <button className="sw" aria-pressed={m.available} title={m.available ? "Mark unavailable" : "Mark available"} onClick={() => void toggleAvail()}><i /></button>
        <div className="mi-acts">
          <button className={m.is_pinned ? "pinon" : ""} title={m.is_pinned ? "Unpin" : "Pin to top of customer menu"} onClick={() => void togglePin()}>📌</button>
          <button title="Edit" onClick={() => onEdit(m)}>✏️</button>
          <button className="danger" title="Delete" onClick={() => void del()}>🗑️</button>
        </div>
      </div>
    </div>
  );
}

export function MenuModal({ item, autoRecipe, autoTrack, onClose }: { item: MenuItem | null; autoRecipe?: boolean; autoTrack?: boolean; onClose: () => void }) {
  const { toast } = useOc();
  const { menu, reload } = useMenu();
  const { ingredients, recipes, migrated, reload: reloadStock } = useStockData();
  const cats = [...new Set(menu.map((m) => m.category))].sort();
  const nextNum = item ? item.item_number : menu.reduce((mx, m) => Math.max(mx, m.item_number || 0), 0) + 1;
  const [v, setV] = useState({
    num: String(nextNum), name: item?.item_name || "", cat: item?.category || "", desc: item?.description || "",
    price: item ? String(Number(item.price)) : "", avail: item ? item.available : true, feat: Boolean(item?.is_pinned),
    track: Boolean(item?.track_stock || autoTrack), qty: item?.stock_qty != null ? String(item.stock_qty) : "",
    thr: item?.low_stock_threshold != null ? String(item.low_stock_threshold) : "", par: item?.par_level != null ? String(item.par_level) : "",
    opts: variantsToText(item?.variants ?? null),
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(item?.image_url || FALLBACK_IMG);
  const [combo, setCombo] = useState<Record<string, number>>({});
  const [comboQ, setComboQ] = useState("");
  const existingRecipe = item ? recipes.filter((r) => r.menu_item_id === item.id) : [];
  const [useRecipe, setUseRecipe] = useState(Boolean(autoRecipe || existingRecipe.length));
  const [recipe, setRecipe] = useState<Record<string, number>>(() => Object.fromEntries(existingRecipe.map((r) => [r.ingredient_id, Number(r.qty_per_item)])));
  const [recipeQ, setRecipeQ] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  const syncCombo = (next: Record<string, number>) => {
    setCombo(next);
    const parts = Object.entries(next).map(([id, q]) => { const m = menu.find((x) => x.id === id); return m ? (q > 1 ? q + "x " : "") + m.item_name : null; }).filter(Boolean);
    if (parts.length) setV((cur) => ({ ...cur, desc: parts.join(", ") }));
  };

  const save = async () => {
    const num = parseInt(v.num, 10), price = Number(v.price);
    if (!num || !v.name.trim() || !v.cat.trim() || !price) { toast("Item number, name, category and price are all required"); return; }
    const hasRecipe = useRecipe && Object.keys(recipe).length > 0;
    const track = hasRecipe ? false : v.track;
    if (track && (v.qty.trim() === "" || isNaN(Number(v.qty)))) { toast("Enter the current stock count"); return; }
    setSaving(true);
    try {
      let image = item?.image_url || null;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await uploadMenuImage(fd);
        if (!up.success) throw new Error(up.error);
        image = up.url;
      }
      const r = await saveMenuItem({
        item_number: num, item_name: v.name.trim(), category: v.cat.trim(), price, available: v.avail,
        description: v.desc.trim() || null, image_url: image, variants: textToVariants(v.opts),
      }, item?.id || null);
      if (!r.success) throw new Error(r.error);
      const fresh = await reload();
      const saved = fresh.find((m) => m.item_number === num);
      if (saved) {
        const sb = db();
        if (Boolean(saved.is_pinned) !== v.feat) await setMenuItemPinned(saved.id, v.feat);
        if (migrated) {
          const stockMetaResult = await saveMenuStockSettings({
            menu_item_id: saved.id,
            track_stock: track,
            low_stock_threshold: track && v.thr.trim() !== "" ? Number(v.thr) : null,
            par_level: track && v.par.trim() !== "" ? Number(v.par) : null,
          });
          if (!stockMetaResult.success) throw new Error(stockMetaResult.error);
          if (track) {
            const nextQty = Number(v.qty);
            const previousQty = Number(item?.stock_qty || 0);
            if (!item || previousQty !== nextQty) {
              const stockResult = await recordStockChange({
                entity_type: "menu_item",
                entity_id: saved.id,
                stock_qty: nextQty,
                reason: "manual_adjust",
                qty_change: nextQty - previousQty,
                note: item ? "Count updated from Menu" : "Opening count from Menu",
              });
              if (!stockResult.success) throw new Error(stockResult.error);
            }
          }
          const { error: deleteRecipeError } = await sb.from("recipe_lines").delete().eq("menu_item_id", saved.id);
          if (deleteRecipeError) throw deleteRecipeError;
          if (hasRecipe) {
            const { error: insertRecipeError } = await sb.from("recipe_lines").insert(Object.entries(recipe).map(([ingredient_id, qty_per_item]) => ({ menu_item_id: saved.id, ingredient_id, qty_per_item })));
            if (insertRecipeError) throw insertRecipeError;
          }
          await Promise.all([reload(), reloadStock()]);
        }
      }
      toast(v.name.trim() + " saved");
      onClose();
    } catch (e) {
      setSaving(false);
      const msg = e instanceof Error ? e.message : "";
      toast(/duplicate|already/i.test(msg) ? "That item number is already used" : msg || "Could not save — try again");
    }
  };

  const comboOpts = menu.filter((m) => m.id !== item?.id && (!comboQ || m.item_name.toLowerCase().includes(comboQ.toLowerCase())));
  const recipeOpts = ingredients.filter((i) => !recipeQ || i.name.toLowerCase().includes(recipeQ.toLowerCase()));
  const listBox: React.CSSProperties = { maxHeight: 170, overflow: "auto", border: "1px solid var(--line)", borderRadius: 10, padding: 4, marginBottom: 10 };
  const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", fontSize: 12.5 };
  const numStyle: React.CSSProperties = { width: 56, padding: 4, border: "1px solid var(--line)", borderRadius: 7, fontSize: 12 };

  return (
    <div className="modal">
      <div className="mcard wide">
        <h3>{item ? "Edit item" : "Add item"}</h3>
        <div className="mimgpick">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_IMG; }} />
          <input type="file" accept="image/*" onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFile(f);
            const rd = new FileReader(); rd.onload = () => setPreview(String(rd.result)); rd.readAsDataURL(f);
          }} />
        </div>
        <input className="f2" inputMode="numeric" placeholder="Item number *" value={v.num} onChange={set("num")} />
        <input className="f2" placeholder="Dish name *" value={v.name} onChange={set("name")} />
        <input className="f2" list="mcatlist" placeholder="Category *" value={v.cat} onChange={set("cat")} />
        <datalist id="mcatlist">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        <label className="avrow"><input type="checkbox" checked={v.feat} onChange={set("feat")} /> 📌 Pin to top of customer menu (combo / offer)</label>
        {v.feat ? (
          <div>
            <p style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", margin: "2px 0 6px" }}>What&apos;s in this combo? Pick dishes — the description below fills in automatically, and you can still edit it.</p>
            <input className="f2" placeholder="Search dishes…" style={{ marginBottom: 8 }} value={comboQ} onChange={(e) => setComboQ(e.target.value)} />
            <div style={listBox}>
              {comboOpts.length ? comboOpts.map((m) => (
                <label key={m.id} style={rowStyle}>
                  <input type="checkbox" className="cbox" checked={combo[m.id] != null} onChange={(e) => {
                    const next = { ...combo };
                    if (e.target.checked) next[m.id] = next[m.id] || 1; else delete next[m.id];
                    syncCombo(next);
                  }} />
                  <span style={{ flex: 1 }}>{m.item_name}</span>
                  <input type="number" min={1} style={numStyle} disabled={combo[m.id] == null} value={combo[m.id] || 1}
                    onChange={(e) => syncCombo({ ...combo, [m.id]: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                </label>
              )) : <div style={{ padding: 8, color: "var(--muted)", fontSize: 12 }}>No dishes matched</div>}
            </div>
          </div>
        ) : null}
        <textarea className="f2" placeholder="Description (optional)" value={v.desc} onChange={set("desc")} />
        <input className="f2" inputMode="decimal" placeholder="Price *" value={v.price} onChange={set("price")} />
        <textarea className="f2" placeholder={"Options (optional) — one per line, e.g.\nSize: Regular, Large"} value={v.opts} onChange={set("opts")} />
        <label className="avrow"><input type="checkbox" checked={v.avail} onChange={set("avail")} /> Available on menu</label>
        {migrated ? (
          <>
            <label className="avrow"><input type="checkbox" checked={v.track && !useRecipe} disabled={useRecipe} onChange={set("track")} /> 📦 Track stock for this item</label>
            {useRecipe ? <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-4px 0 10px" }}>Stock for this dish is tracked via its recipe ingredients — see Stock → Ingredients.</div> : null}
            {v.track && !useRecipe ? (
              <div>
                <input className="f2" inputMode="numeric" placeholder="Current stock *" value={v.qty} onChange={set("qty")} />
                <input className="f2" inputMode="numeric" placeholder="Low-stock alert at (optional)" value={v.thr} onChange={set("thr")} />
                <input className="f2" inputMode="numeric" placeholder="Par level — daily top-up target (optional)" value={v.par} onChange={set("par")} />
              </div>
            ) : null}
            <label className="avrow"><input type="checkbox" checked={useRecipe} onChange={(e) => setUseRecipe(e.target.checked)} /> 🧾 Build a recipe for this dish (deduct raw ingredients instead of a simple count)</label>
            {useRecipe ? (
              <div>
                <p style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", margin: "2px 0 6px" }}>Pick the ingredients this dish uses and how much of each per order.</p>
                <input className="f2" placeholder="Search ingredients…" style={{ marginBottom: 8 }} value={recipeQ} onChange={(e) => setRecipeQ(e.target.value)} />
                <div style={listBox}>
                  {recipeOpts.length ? recipeOpts.map((i) => (
                    <label key={i.id} style={rowStyle}>
                      <input type="checkbox" className="cbox" checked={recipe[i.id] != null} onChange={(e) => {
                        const next = { ...recipe };
                        if (e.target.checked) next[i.id] = next[i.id] || 1; else delete next[i.id];
                        setRecipe(next);
                      }} />
                      <span style={{ flex: 1 }}>{i.name}</span>
                      <input type="number" min={0.001} step={0.001} placeholder="qty" style={numStyle} disabled={recipe[i.id] == null} value={recipe[i.id] ?? ""}
                        onChange={(e) => setRecipe({ ...recipe, [i.id]: Math.max(0.001, Number(e.target.value) || 0.001) })} />
                      <span style={{ width: 26, color: "var(--muted)", fontSize: 11 }}>{i.unit}</span>
                    </label>
                  )) : <div style={{ padding: 8, color: "var(--muted)", fontSize: 12 }}>No ingredients yet — add some from Stock → Ingredients first</div>}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="mrow">
          <button onClick={onClose}>Cancel</button>
          <button className="go" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

export default function MenuView() {
  const { menu } = useMenu(true);
  useStockData(true);
  const { settings } = useOc();
  const actions = useStockActions();
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<{ item: MenuItem | null } | null>(null);
  const query = q.trim().toLowerCase();
  const rows = query ? menu.filter((m) => m.item_name.toLowerCase().includes(query) || m.category.toLowerCase().includes(query) || String(m.item_number) === query) : menu;
  const cats = [...new Set(rows.map((m) => m.category))];
  const low = menu.filter((m) => m.track_stock && Number(m.stock_qty) <= thresholdOf(m, settings)).length;
  return (
    <div>
      <div className="mhead">
        <div><h2>Menu Management</h2><p>Manage your menu items, categories, and availability.</p></div>
        <button className="btn sm" style={{ padding: "11px 18px" }} onClick={() => setModal({ item: null })}>+ Add Item</button>
      </div>
      {low ? <div className="stats"><div className="stat r"><span>Low / Out of Stock</span><b>{low}</b></div></div> : null}
      <input className="srch" placeholder={`Search ${menu.length} items…`} value={q} onChange={(e) => setQ(e.target.value)} />
      {cats.length ? cats.map((c) => {
        const items = rows.filter((m) => m.category === c);
        return (
          <div key={c} className="mcat">
            <h4>{c} <span className="mcatcount">{items.length}</span></h4>
            <div className="mgrid">{items.map((m) => <MenuCard key={m.id} m={m} actions={actions} onEdit={(it) => setModal({ item: it })} />)}</div>
          </div>
        );
      }) : <div className="none">No items matched</div>}
      {modal ? <MenuModal item={modal.item} onClose={() => setModal(null)} /> : null}
      {actions.modal}
    </div>
  );
}
