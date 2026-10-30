"use client";

/* Oceana Stock Management: Dishes / Ingredients / Reports tabs, reorder and
   expiry banner, bulk restock, stock take, list view and CSV import/export. */
import { useEffect, useMemo, useState } from "react";
import { useOc } from "../../DashShell";
import { db, FALLBACK_IMG, useMenu, useStockData, type Ingredient, type MenuItem } from "../../oc-data";
import { maxMakeable, NotMigrated, StockRow, thresholdOf, useStockActions, type EntityType } from "../../StockKit";
import { RANGE_CHIPS, inRange, ist, pct, rs, type Range } from "../../oc-utils";
import { MenuCard, MenuModal } from "../menu/MenuView";
import { deleteIngredient, recordStockChange, saveIngredient } from "./actions";

type Tab = "dishes" | "ingredients" | "reports";
type Filter = "all" | "low" | "out";
type Movement = { entity_type: EntityType; entity_id: string; entity_name: string; reason: string; qty_change: number; unit: string; created_at: string };
type Candidate = { type: EntityType; x: MenuItem | Ingredient; name: string; qty: number; unit: string; suggested: number | null };
const UNITS = ["kg", "g", "l", "ml", "pcs"] as const;

const viewModeKey = "stockViewMode";

/** Dish profit margins from recipe cost, shared with P&L. */
export function dishMargins(menu: MenuItem[], recipes: { menu_item_id: string; ingredient_id: string; qty_per_item: number }[], ingredients: Ingredient[]) {
  const withRecipe = new Set(recipes.map((r) => r.menu_item_id));
  return menu.filter((m) => withRecipe.has(m.id)).map((m) => {
    let cost = 0;
    let missing: string | null = null;
    let missingId: string | null = null;
    const lines = recipes.filter((l) => l.menu_item_id === m.id).map((l) => {
      const ing = ingredients.find((i) => i.id === l.ingredient_id);
      const has = ing && ing.cost_per_unit != null;
      const lineCost = has ? Number(l.qty_per_item) * Number(ing!.cost_per_unit) : null;
      if (!has && missing == null) { missing = ing ? ing.name : "an ingredient not loaded"; missingId = ing ? ing.id : null; }
      if (lineCost != null) cost += lineCost;
      return { name: ing ? ing.name : "Unknown ingredient", qty: Number(l.qty_per_item), unit: ing ? ing.unit : "", costPerUnit: has ? Number(ing!.cost_per_unit) : null, lineCost };
    });
    const price = Number(m.price);
    const margin = missing == null ? price - cost : null;
    return { item: m, cost: missing == null ? cost : null, margin, marginPct: margin != null && price > 0 ? (margin / price) * 100 : null, missing: missing as string | null, missingId: missingId as string | null, lines };
  });
}

export default function StockView() {
  const { menu } = useMenu();
  const { ingredients, recipes, migrated, loaded, reload } = useStockData();
  const { settings, toast, range, setRange } = useOc();
  const actions = useStockActions();
  const [tab, setTab] = useState<Tab>("dishes");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [viewMode, setViewMode] = useState<"cards" | "list">(() => (typeof window !== "undefined" && localStorage.getItem(viewModeKey) === "list" ? "list" : "cards"));
  const [menuModal, setMenuModal] = useState<{ item: MenuItem | null; autoRecipe?: boolean; autoTrack?: boolean } | null>(null);
  const [ingModal, setIngModal] = useState<Ingredient | null | "new">(null);
  const [overlay, setOverlay] = useState<React.ReactNode>(null);

  const thr = (x: { low_stock_threshold?: number | null }) => thresholdOf(x, settings);
  const recipeIds = useMemo(() => new Set(recipes.map((r) => r.menu_item_id)), [recipes]);
  const toggleView = () => { const next = viewMode === "cards" ? "list" : "cards"; localStorage.setItem(viewModeKey, next); setViewMode(next); };
  const switchTab = (t: Tab) => { setTab(t); setQ(""); setFilter("all"); };

  if (loaded && !migrated) return <div><div className="mhead"><div><h2>Stock Management</h2></div></div><NotMigrated /></div>;

  const candidatesOf = (type: EntityType, list: Array<MenuItem | Ingredient>): Candidate[] => list
    .filter((x) => x.track_stock && Number(x.stock_qty) <= thr(x))
    .map((x) => ({
      type, x,
      name: type === "menu_item" ? (x as MenuItem).item_name : (x as Ingredient).name,
      qty: Number(x.stock_qty), unit: type === "menu_item" ? "pcs" : (x as Ingredient).unit,
      suggested: x.par_level != null ? Math.max(0, Number(x.par_level) - Number(x.stock_qty)) : null,
    }));
  const expiring = () => {
    const cutoff = Date.now() + Number(settings.expiry_warn_days || 7) * 86400000;
    return ingredients.filter((i) => i.track_stock && i.nearest_expiry && new Date(i.nearest_expiry + "T00:00:00").getTime() <= cutoff);
  };

  const tabBar = (
    <div className="catbar">
      <button aria-pressed={tab === "dishes"} onClick={() => switchTab("dishes")}>🍽️ Dishes</button>
      <button aria-pressed={tab === "ingredients"} onClick={() => switchTab("ingredients")}>🥕 Ingredients</button>
      <button aria-pressed={tab === "reports"} onClick={() => switchTab("reports")}>📊 Reports</button>
    </div>
  );
  const stockTakeBtn = <button className="btn sm ghost" onClick={() => setOverlay(<StockTake menu={menu} ingredients={ingredients} onClose={() => setOverlay(null)} />)}>📋 Start Stock Take</button>;

  const banner = (candidates: Candidate[], exp: Ingredient[]) => (!candidates.length && !exp.length ? null : (
    <div className="reorder-banner">
      {candidates.length ? (
        <div className="rb-section">
          <h4>⚠ Needs restocking ({candidates.length})</h4>
          {candidates.map((c) => (
            <div key={c.x.id} className="rb-row">
              <span>{c.name} — {c.qty} {c.unit} {c.suggested != null ? <i>(suggest +{c.suggested} {c.unit})</i> : <i>(set a par level for a suggestion)</i>}</span>
              <button className="btn sm" onClick={() => void actions.restock(c.type, c.x)}>Restock</button>
            </div>
          ))}
          <button className="btn sm go" onClick={() => setOverlay(<BulkRestock candidates={candidates} onClose={() => setOverlay(null)} />)}>Restock All ({candidates.length})</button>
        </div>
      ) : null}
      {exp.length ? (
        <div className="rb-section">
          <h4>⏰ Expiring soon</h4>
          {exp.map((i) => <div key={i.id} className="rb-row"><span>{i.name} — expires {ist(i.nearest_expiry + "T00:00:00")}</span></div>)}
        </div>
      ) : null}
    </div>
  ));
  const filterBar = (all: number, low: number, out: number) => (
    <div className="catbar" style={{ marginBottom: 10 }}>
      <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All ({all})</button>
      <button aria-pressed={filter === "low"} onClick={() => setFilter("low")}>Low ({low})</button>
      <button aria-pressed={filter === "out"} onClick={() => setFilter("out")}>Out ({out})</button>
    </div>
  );
  const isLow = (x: MenuItem | Ingredient) => Number(x.stock_qty) > 0 && Number(x.stock_qty) <= thr(x);
  const isOut = (x: MenuItem | Ingredient) => Number(x.stock_qty) <= 0;
  const byFilter = <T extends MenuItem | Ingredient>(rows: T[]) => filter === "low" ? rows.filter(isLow) : filter === "out" ? rows.filter(isOut) : rows;
  const modals = (
    <>
      {menuModal ? <MenuModal item={menuModal.item} autoRecipe={menuModal.autoRecipe} autoTrack={menuModal.autoTrack} onClose={() => setMenuModal(null)} /> : null}
      {ingModal ? <IngredientModal item={ingModal === "new" ? null : ingModal} onClose={() => setIngModal(null)} /> : null}
      {actions.modal}
      {overlay}
    </>
  );

  /* ---------------- Dishes ---------------- */
  if (tab === "dishes") {
    const query = q.trim().toLowerCase();
    const match = (m: MenuItem) => !query || m.item_name.toLowerCase().includes(query) || m.category.toLowerCase().includes(query);
    const tracked = menu.filter((m) => m.track_stock);
    const recipeTracked = menu.filter((m) => recipeIds.has(m.id) && !m.track_stock);
    const untracked = menu.filter((m) => !m.track_stock && !recipeIds.has(m.id));
    const rows = byFilter(tracked.filter(match));
    const recipeRows = recipeTracked.filter(match);
    const outRecipe = recipeTracked.filter((m) => (maxMakeable(m.id, recipes, ingredients) ?? 0) <= 0);
    const grid = (list: MenuItem[]) => [...new Set(list.map((m) => m.category))].map((c) => {
      const items = list.filter((m) => m.category === c);
      return <div key={c} className="mcat"><h4>{c} <span className="mcatcount">{items.length}</span></h4>
        <div className="mgrid">{items.map((m) => <MenuCard key={m.id} m={m} actions={actions} onEdit={(it) => setMenuModal({ item: it })} />)}</div></div>;
    });
    const dishList = (list: MenuItem[], recipe: boolean) => (
      <div style={{ overflowX: "auto" }}><table>
        <thead><tr><th>Dish</th><th>Category</th><th>{recipe ? "Availability" : "Stock"}</th><th>Last updated</th><th></th></tr></thead>
        <tbody>{list.map((m) => {
          if (recipe) {
            const max = maxMakeable(m.id, recipes, ingredients) ?? 0;
            return <tr key={m.id}><td><b>{m.item_name}</b></td><td>{m.category}</td>
              <td style={max <= 0 ? { color: "var(--red2)", fontWeight: 800 } : undefined}>{max <= 0 ? "Can't make any" : `Can make ${max} more`}</td><td>—</td>
              <td><button className="btn sm ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setMenuModal({ item: m })}>✏️ Edit Recipe</button></td></tr>;
          }
          const warn = isOut(m) ? "out" : isLow(m) ? "low" : "";
          return <tr key={m.id}><td><b>{m.item_name}</b></td><td>{m.category}</td>
            <td style={warn ? { color: warn === "out" ? "var(--red2)" : "#B8860B", fontWeight: 800 } : undefined}>{m.stock_qty} pcs</td>
            <td>{m.stock_updated_at ? ist(m.stock_updated_at) : "—"}</td>
            <td><div className="mi-stockacts">
              <button onClick={() => void actions.restock("menu_item", m)}>📥 Restock</button>
              <button onClick={() => actions.waste("menu_item", m)}>🗑️ Waste</button>
              <button onClick={() => void actions.history("menu_item", m, menu)}>📜 History</button>
              <button onClick={() => setMenuModal({ item: m })}>✏️ Edit</button>
            </div></td></tr>;
        })}</tbody></table></div>
    );
    return (
      <div>
        <div className="mhead">
          <div><h2>Stock Management</h2><p>Track quantities for items that can run out, and see what needs restocking.</p></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn sm ghost" onClick={toggleView}>{viewMode === "cards" ? "☰ List view" : "▦ Card view"}</button>
            {stockTakeBtn}
          </div>
        </div>
        {tabBar}
        <div className="stats">
          <div className="stat b"><span>Tracked Items</span><b>{tracked.length + recipeTracked.length}</b></div>
          <div className="stat o"><span>Low Stock</span><b>{tracked.filter(isLow).length}</b></div>
          <div className="stat r"><span>Out of Stock</span><b>{tracked.filter(isOut).length + outRecipe.length}</b></div>
        </div>
        {banner(candidatesOf("menu_item", tracked), [])}
        <input className="srch" placeholder="Search dishes…" value={q} onChange={(e) => setQ(e.target.value)} />
        {tracked.length ? (
          <div className="mcat" style={{ marginTop: 14 }}>
            <h4>TRACKED BY SIMPLE COUNT <span className="mcatcount">{tracked.length}</span></h4>
            {filterBar(tracked.length, tracked.filter(isLow).length, tracked.filter(isOut).length)}
            {viewMode === "list" ? dishList(rows, false) : rows.length ? grid(rows) : <div className="none">No tracked items matched</div>}
          </div>
        ) : null}
        {recipeTracked.length ? (
          <div className="mcat" style={{ marginTop: tracked.length ? 30 : 14 }}>
            <h4>TRACKED BY RECIPE <span className="mcatcount">{recipeTracked.length}</span></h4>
            <p className="asub" style={{ margin: "-4px 0 10px", fontSize: 12, color: "var(--muted)" }}>Stock for these comes from their recipe&apos;s ingredients, not a count on the dish itself — availability below is how many you can still make with what&apos;s currently in stock.</p>
            {viewMode === "list" ? dishList(recipeRows, true) : recipeRows.length ? grid(recipeRows) : <div className="none">No recipe-tracked dishes matched</div>}
          </div>
        ) : null}
        {untracked.length ? (
          <div className="mcat" style={{ marginTop: tracked.length || recipeTracked.length ? 30 : 14 }}>
            <h4>NOT TRACKED <span className="mcatcount">{untracked.length}</span></h4>
            <div className="rlist">{untracked.map((m) => (
              <div key={m.id} className="histrow"><span>{m.item_name}</span>
                <button className="btn sm ghost" onClick={() => setMenuModal({ item: m, autoTrack: true })}>Track stock</button></div>
            ))}</div>
          </div>
        ) : null}
        {modals}
      </div>
    );
  }

  /* ---------------- Ingredients ---------------- */
  if (tab === "ingredients") {
    const query = q.trim().toLowerCase();
    const tracked = ingredients.filter((i) => i.track_stock);
    const rows = byFilter(query ? ingredients.filter((i) => i.name.toLowerCase().includes(query) || (i.category || "").toLowerCase().includes(query)) : ingredients);
    const cats = [...new Set(rows.map((i) => i.category || "Uncategorized"))];
    return (
      <div>
        <div className="mhead">
          <div><h2>Stock Management</h2><p>Track quantities for raw ingredients that can run out.</p></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn sm ghost" onClick={toggleView}>{viewMode === "cards" ? "☰ List view" : "▦ Card view"}</button>
            <button className="btn sm ghost" onClick={() => exportIngredientsCsv(ingredients)}>⬇ Export CSV</button>
            <button className="btn sm ghost" onClick={() => setOverlay(<ImportCsv ingredients={ingredients} onClose={() => setOverlay(null)} />)}>⬆ Import CSV</button>
            {stockTakeBtn}
            <button className="btn sm" style={{ padding: "11px 18px" }} onClick={() => setIngModal("new")}>+ Add Ingredient</button>
          </div>
        </div>
        {tabBar}
        <div className="stats">
          <div className="stat b"><span>Ingredients</span><b>{ingredients.length}</b></div>
          <div className="stat o"><span>Low Stock</span><b>{tracked.filter(isLow).length}</b></div>
          <div className="stat r"><span>Out of Stock</span><b>{tracked.filter(isOut).length}</b></div>
        </div>
        {banner(candidatesOf("ingredient", ingredients), expiring())}
        {ingredients.length ? (
          <>
            <input className="srch" placeholder={`Search ${ingredients.length} ingredients…`} value={q} onChange={(e) => setQ(e.target.value)} />
            {filterBar(ingredients.length, tracked.filter(isLow).length, tracked.filter(isOut).length)}
            {viewMode === "list" ? <IngredientList rows={rows} actions={actions} menu={menu} onEdit={setIngModal} /> : cats.length ? cats.map((c) => {
              const items = rows.filter((i) => (i.category || "Uncategorized") === c);
              return <div key={c} className="mcat"><h4>{c} <span className="mcatcount">{items.length}</span></h4>
                <div className="mgrid">{items.map((i) => (
                  <div key={i.id} className="micard">
                    <div className="mi-imgwrap">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={i.image_url || FALLBACK_IMG} alt="" loading="lazy" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_IMG; }} />
                    </div>
                    <div className="mi-body2">
                      <b>{i.name}</b>
                      {i.category ? <p>{i.category}</p> : null}
                      <p className="icostline">{i.cost_per_unit != null ? rs(i.cost_per_unit) + " / " + i.unit : "No cost set"} <button className="icostbtn" title="Update cost" onClick={() => setOverlay(<QuickCost item={i} onClose={() => setOverlay(null)} />)}>✏️</button></p>
                    </div>
                    {i.track_stock ? <StockRow type="ingredient" x={i} actions={actions} menu={menu} /> : null}
                    <div className="mi-foot" style={{ justifyContent: "flex-end" }}>
                      <div className="mi-stockacts">
                        <button onClick={() => setIngModal(i)}>✏️ Edit</button>
                        <button style={{ color: "var(--red2)", borderColor: "#F5C2C6" }} onClick={() => void removeIngredient(i, toast, reload)}>🗑️ Delete</button>
                      </div>
                    </div>
                  </div>
                ))}</div></div>;
            }) : <div className="none">No ingredients matched</div>}
          </>
        ) : <div className="none">No ingredients added yet — tap &quot;+ Add Ingredient&quot; to start tracking raw materials.</div>}
        {modals}
      </div>
    );
  }

  /* ---------------- Reports ---------------- */
  return (
    <div>
      <div className="mhead"><div><h2>Stock Management</h2><p>Valuation, consumption, and dish profitability.</p></div></div>
      {tabBar}
      <RangeChips range={range.range} from={range.from} to={range.to} onChange={setRange} />
      <Reports menu={menu} ingredients={ingredients} recipes={recipes} onRestock={(i) => void actions.restock("ingredient", i)}
        onBuild={(m) => setMenuModal({ item: m, autoRecipe: true })} />
      {modals}
    </div>
  );
}

export function RangeChips({ range, from, to, onChange }: { range: Range; from: string; to: string; onChange: (r: { range: Range; from: string; to: string }) => void }) {
  const { toast } = useOc();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  return (
    <>
      <div className="filterrow">
        <span className="flabel">Filter:</span>
        <div className="chips">
          {[...RANGE_CHIPS, ["custom", "Custom Date"] as [Range, string]].map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={range === k} onClick={() => onChange({ range: k, from, to })}>{l}</button>
          ))}
        </div>
      </div>
      {range === "custom" ? (
        <div className="customrow">
          <input type="date" className="f2" value={f} onChange={(e) => setF(e.target.value)} />
          <span>to</span>
          <input type="date" className="f2" value={t} onChange={(e) => setT(e.target.value)} />
          <button className="btn sm" onClick={() => { if (!f || !t) { toast("Pick both dates"); return; } onChange({ range: "custom", from: f, to: t }); }}>Apply</button>
        </div>
      ) : null}
    </>
  );
}

function Reports({ menu, ingredients, recipes, onRestock, onBuild }: {
  menu: MenuItem[]; ingredients: Ingredient[]; recipes: { menu_item_id: string; ingredient_id: string; qty_per_item: number }[];
  onRestock: (i: Ingredient) => void; onBuild: (m: MenuItem) => void;
}) {
  const { range, settings } = useOc();
  const [moves, setMoves] = useState<Movement[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [covOpen, setCovOpen] = useState(false);
  useEffect(() => {
    db().from("stock_movements").select("entity_type,entity_id,entity_name,reason,qty_change,unit,created_at").order("created_at", { ascending: false }).limit(1000)
      .then(({ data }) => setMoves((data || []) as Movement[]));
  }, []);
  const tracked = ingredients.filter((i) => i.track_stock);
  const withCost = tracked.filter((i) => i.cost_per_unit != null);
  const valuation = withCost.reduce((s, i) => s + Number(i.stock_qty) * Number(i.cost_per_unit), 0);
  const missingCount = tracked.length - withCost.length;
  const margins = dishMargins(menu, recipes, ingredients);
  const marginThr = Number(settings.margin_alert_pct || 20);
  const cons: Record<string, { name: string; unit: string; by: Record<string, number> }> = {};
  (moves || []).filter((m) => inRange(m, range)).forEach((m) => {
    const k = m.entity_type + ":" + m.entity_id;
    cons[k] = cons[k] || { name: m.entity_name, unit: m.unit, by: {} };
    cons[k].by[m.reason] = (cons[k].by[m.reason] || 0) + Math.abs(Number(m.qty_change));
  });
  const consRows = Object.values(cons);
  const uncovered = menu.filter((m) => !recipes.some((r) => r.menu_item_id === m.id));
  const uncoveredCats = [...new Set(uncovered.map((m) => m.category || "Uncategorised"))].sort();
  const cell = (n?: number, unit?: string) => (n ? n.toFixed(2) + " " + unit : "—");
  return (
    <>
      <div className="anacard" style={{ marginBottom: 14 }}>
        <h4>Stock Valuation</h4>
        <p className="asub" style={{ marginTop: 0 }}>What all your ingredient stock is worth right now, at the last price you paid for each.</p>
        <div className="ov-pills"><div className="ovpill teal"><b>{rs(valuation)}</b><span>Total ingredient stock value</span></div></div>
        {missingCount ? <p className="asub" style={{ marginTop: 12 }}>Excludes {missingCount} ingredient{missingCount === 1 ? "" : "s"} with no recorded cost yet — restock with a cost entered, or set a cost from Stock → Ingredients, to include {missingCount === 1 ? "it" : "them"} here.</p> : null}
      </div>
      <div className="anacard" style={{ marginBottom: 14 }}>
        <h4>Consumption{range.range !== "all" ? " this period" : " (all time)"}</h4>
        <p className="asub" style={{ marginTop: 0 }}>How much of each item moved in the selected date range, split by why — sold to a customer, wasted, manually adjusted, or counted in a stock take.</p>
        {moves === null ? <div className="none">Loading…</div> : consRows.length ? (
          <div style={{ overflowX: "auto" }}><table><thead><tr><th>Item</th><th>Sale</th><th>Waste</th><th>Adjust</th><th>Stock take</th></tr></thead>
            <tbody>{consRows.map((r) => <tr key={r.name + r.unit}><td><b>{r.name}</b></td><td>{cell(r.by.sale, r.unit)}</td><td>{cell(r.by.waste, r.unit)}</td><td>{cell(r.by.manual_adjust, r.unit)}</td><td>{cell(r.by.stock_take, r.unit)}</td></tr>)}</tbody></table></div>
        ) : <div className="none">No stock movements in this period</div>}
      </div>
      <div className="anacard" style={{ marginBottom: 14 }}>
        <h4>Dish Profit Margins</h4>
        <p className="asub" style={{ marginTop: 0 }}>For every dish with a recipe built (Menu Management → edit a dish → &quot;Build a recipe&quot;), what it actually costs you in ingredients, and what you keep after that cost. Tap &quot;Details&quot; on any row to see exactly which ingredients make up that cost.</p>
        {margins.length ? (
          <div style={{ overflowX: "auto" }}><table><thead><tr><th>Dish</th><th>Price</th><th>Recipe cost</th><th>Margin</th><th>Margin %</th><th></th></tr></thead>
            <tbody>{margins.flatMap((x) => {
              const id = x.item.id;
              if (x.missing) {
                const ing = ingredients.find((i) => i.id === x.missingId);
                return [<tr key={id}><td><b>{x.item.item_name}</b></td><td>{rs(x.item.price)}</td>
                  <td colSpan={4} style={{ textAlign: "left" }}><span style={{ color: "var(--muted)" }}>Can&apos;t calculate yet — &quot;{x.missing}&quot; has no cost recorded</span>
                    {ing ? <> <button className="btn sm" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onRestock(ing)}>Add cost for {x.missing}</button></> : null}</td></tr>];
              }
              const low = x.marginPct != null && x.marginPct < marginThr;
              return [
                <tr key={id} style={low ? { background: "var(--tint)" } : undefined}>
                  <td><b>{x.item.item_name}</b></td><td>{rs(x.item.price)}</td><td>{rs(x.cost)}</td>
                  <td style={x.margin! < 0 ? { color: "var(--red2)", fontWeight: 800 } : undefined}>{x.margin! < 0 ? "Selling at a loss · " : ""}{rs(x.margin)}</td>
                  <td style={low ? { color: "#C0392B", fontWeight: 800 } : undefined}>{pct(x.marginPct!)}{low ? " ⚠" : ""}</td>
                  <td><button className="btn sm ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => setOpen({ ...open, [id]: !open[id] })}>{open[id] ? "▾ Hide" : "▸ Details"}</button></td>
                </tr>,
                open[id] ? <tr key={id + "-d"}><td colSpan={6} style={{ padding: 0 }}><div style={{ padding: "10px 14px", background: "#FAFBFC" }}>
                  <table><thead><tr><th>Ingredient</th><th>Qty per order</th><th>Cost/unit</th><th>Line cost</th></tr></thead>
                    <tbody>{x.lines.map((l, i) => <tr key={i}><td>{l.name}</td><td>{l.qty} {l.unit}</td><td>{l.costPerUnit != null ? rs(l.costPerUnit) : "Not set"}</td><td>{l.lineCost != null ? rs(l.lineCost) : "—"}</td></tr>)}</tbody></table>
                </div></td></tr> : null,
              ];
            })}</tbody></table></div>
        ) : <div className="none">No dishes have a recipe yet — build one from Menu Management (edit a dish → &quot;Build a recipe for this dish&quot;) to see margins here.</div>}
      </div>
      <div className="anacard" style={{ marginBottom: 14 }}>
        <h4>Recipe Coverage<span className="countpill">{margins.length} of {menu.length} dishes</span></h4>
        <p className="asub" style={{ marginTop: 0 }}>Every dish without a recipe is missing from Dish Profit Margins and P&amp;L cost of goods — this is what&apos;s left to build.</p>
        {uncovered.length ? (
          <>
            <button className="btn sm ghost" style={{ padding: "7px 12px", fontSize: 11.5 }} onClick={() => setCovOpen(!covOpen)}>
              {covOpen ? "▾ Hide " : "▸ Show "}{uncovered.length} dish{uncovered.length === 1 ? "" : "es"}{covOpen ? "" : " without a recipe"}
            </button>
            {covOpen ? <div style={{ marginTop: 12 }}>{uncoveredCats.map((c) => (
              <div key={c} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>{c}</div>
                {uncovered.filter((m) => (m.category || "Uncategorised") === c).map((m) => (
                  <div key={m.id} className="arow"><div className="at"><b>{m.item_name}</b><span>{rs(m.price)}</span></div>
                    <div className="as"><button className="btn sm" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => onBuild(m)}>🧾 Build a recipe</button></div></div>
                ))}
              </div>
            ))}</div> : null}
          </>
        ) : <div className="none">Every dish has a recipe — coverage is complete.</div>}
      </div>
    </>
  );
}

function IngredientList({ rows, actions, menu, onEdit }: { rows: Ingredient[]; actions: ReturnType<typeof useStockActions>; menu: MenuItem[]; onEdit: (i: Ingredient) => void }) {
  const { settings, toast } = useOc();
  const { reload } = useStockData();
  const [sort, setSort] = useState<{ key: "name" | "category" | "qty" | "cost_per_unit"; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const val = (i: Ingredient) => sort.key === "qty" ? Number(i.stock_qty) : sort.key === "cost_per_unit" ? Number(i.cost_per_unit || 0) : String(i[sort.key] || "").toLowerCase();
  const sorted = [...rows].sort((a, b) => (val(a) < val(b) ? -sort.dir : val(a) > val(b) ? sort.dir : 0));
  const th = (k: typeof sort.key, label: string) => (
    <th style={{ cursor: "pointer" }} onClick={() => setSort(sort.key === k ? { key: k, dir: sort.dir === 1 ? -1 : 1 } : { key: k, dir: 1 })}>
      {label}{sort.key === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  return (
    <div style={{ overflowX: "auto" }}><table>
      <thead><tr>{th("name", "Name")}{th("category", "Category")}{th("qty", "Stock")}<th>Threshold</th><th>Par</th>{th("cost_per_unit", "Cost/Unit")}<th>Last updated</th><th></th></tr></thead>
      <tbody>{sorted.map((i) => {
        const warn = Number(i.stock_qty) <= 0 ? "out" : Number(i.stock_qty) <= thresholdOf(i, settings) ? "low" : "";
        return <tr key={i.id}>
          <td><b>{i.name}</b></td><td>{i.category || "—"}</td>
          <td style={warn ? { color: warn === "out" ? "var(--red2)" : "#B8860B", fontWeight: 800 } : undefined}>{i.stock_qty} {i.unit}</td>
          <td>{i.low_stock_threshold ?? "—"}</td><td>{i.par_level ?? "—"}</td>
          <td>{i.cost_per_unit != null ? rs(i.cost_per_unit) : "—"}</td>
          <td>{i.stock_updated_at ? ist(i.stock_updated_at) : "—"}</td>
          <td><div className="mi-stockacts">
            <button onClick={() => void actions.restock("ingredient", i)}>📥 Restock</button>
            <button onClick={() => actions.waste("ingredient", i)}>🗑️ Waste</button>
            <button onClick={() => void actions.history("ingredient", i, menu)}>📜 History</button>
            <button onClick={() => onEdit(i)}>✏️ Edit</button>
            <button style={{ color: "var(--red2)", borderColor: "#F5C2C6" }} onClick={() => void removeIngredient(i, toast, reload)}>🗑️ Delete</button>
          </div></td>
        </tr>;
      })}</tbody>
    </table></div>
  );
}

async function removeIngredient(item: Ingredient, toast: (m: string) => void, reload: () => Promise<unknown>) {
  if (!confirm("Delete " + item.name + "? This cannot be undone.")) return;
  const r = await deleteIngredient(item.id);
  if (!r.success && r.inUse) {
    if (!confirm(item.name + " is used in a recipe and can't be deleted. Archive it instead? (hides it from Stock, keeps the recipe intact)")) return;
    const a = await deleteIngredient(item.id, true);
    if (!a.success) { toast("Could not archive"); return; }
    toast(item.name + " archived");
  } else if (!r.success) { toast("Could not delete"); return; }
  else toast(item.name + " deleted");
  void reload();
}

function IngredientModal({ item, onClose }: { item: Ingredient | null; onClose: () => void }) {
  const { toast } = useOc();
  const { ingredients, reload } = useStockData();
  const cats = [...new Set(ingredients.map((i) => i.category).filter(Boolean))].sort() as string[];
  const n = (x: number | null | undefined) => (x != null ? String(x) : "");
  const [v, setV] = useState({ name: item?.name || "", cat: item?.category || "", unit: item?.unit || "kg", qty: item ? String(item.stock_qty) : "", thr: n(item?.low_stock_threshold), par: n(item?.par_level), cost: n(item?.cost_per_unit) });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const lbl = (t: string) => <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", display: "block", margin: "10px 0 4px" }}>{t}</label>;
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const save = async () => {
    const qty = Number(v.qty);
    if (!v.name.trim() || v.qty.trim() === "" || isNaN(qty)) { toast("Name and current stock are required"); return; }
    setSaving(true);
    const r = await saveIngredient({ id: item?.id, name: v.name, category: v.cat, unit: v.unit as (typeof UNITS)[number], low_stock_threshold: num(v.thr), par_level: num(v.par), cost_per_unit: num(v.cost), nearest_expiry: item?.nearest_expiry || null });
    if (!r.success || !("id" in r) || !r.id) { setSaving(false); toast(r.error || "Could not save — try again"); return; }
    const prev = item ? Number(item.stock_qty) : 0;
    if (qty !== prev) {
      const s = await recordStockChange({ entity_type: "ingredient", entity_id: r.id, stock_qty: qty, reason: "manual_adjust", qty_change: qty - prev, note: item ? "Count updated" : "Opening count" });
      if (!s.success) toast(s.error || "Saved, but the count could not be updated");
    }
    await reload();
    toast(v.name.trim() + " saved");
    onClose();
  };
  return (
    <div className="modal"><div className="mcard wide">
      <h3>{item ? "Edit ingredient — " + item.name : "Add ingredient"}</h3>
      {lbl("Ingredient name *")}<input className="f2" placeholder="e.g. Chicken, Onion, Rice" value={v.name} onChange={set("name")} />
      {lbl("Category (optional)")}<input className="f2" list="icatlist" placeholder="e.g. Meat, Vegetables" value={v.cat} onChange={set("cat")} />
      <datalist id="icatlist">{cats.map((c) => <option key={c} value={c} />)}</datalist>
      {lbl("Unit of measure")}<select className="f2" value={v.unit} onChange={set("unit")}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
      {lbl("Current stock *")}<input className="f2" inputMode="decimal" placeholder="How much do you have right now" value={v.qty} onChange={set("qty")} />
      {lbl("Low-stock alert at (optional)")}<input className="f2" inputMode="decimal" placeholder="Warn when stock drops to this amount" value={v.thr} onChange={set("thr")} />
      {lbl("Par level (optional)")}<input className="f2" inputMode="decimal" placeholder="Target amount to top up to" value={v.par} onChange={set("par")} />
      {lbl("Cost per unit — ₹ (optional)")}<input className="f2" inputMode="decimal" placeholder="What you pay per unit" value={v.cost} onChange={set("cost")} />
      <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-4px 0 10px" }}>Used for stock valuation and dish profit margins. Also updates automatically whenever you log a Restock with a cost entered.</div>
      <div className="mrow">
        <button onClick={onClose}>Cancel</button>
        {item ? <button className="x" style={{ flex: "none", padding: "0 16px" }} onClick={() => { onClose(); void removeIngredient(item, toast, reload); }}>Delete</button> : null}
        <button className="go" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div></div>
  );
}

function QuickCost({ item, onClose }: { item: Ingredient; onClose: () => void }) {
  const { toast } = useOc();
  const { reload } = useStockData();
  const [cost, setCost] = useState(item.cost_per_unit != null ? String(item.cost_per_unit) : "");
  return (
    <div className="modal"><div className="mcard">
      <h3>Update cost — {item.name}</h3>
      <input className="f2" inputMode="decimal" autoFocus placeholder={`Cost per ${item.unit} (₹)`} value={cost} onChange={(e) => setCost(e.target.value)} />
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={async () => {
        const r = await saveIngredient({ id: item.id, name: item.name, category: item.category || "", unit: item.unit as (typeof UNITS)[number], low_stock_threshold: item.low_stock_threshold, par_level: item.par_level, cost_per_unit: cost.trim() === "" ? null : Number(cost), nearest_expiry: item.nearest_expiry });
        if (!r.success) { toast("Could not update cost"); return; }
        await reload();
        toast(item.name + " cost updated");
        onClose();
      }}>Save</button></div>
    </div></div>
  );
}

function BulkRestock({ candidates, onClose }: { candidates: Candidate[]; onClose: () => void }) {
  const { toast } = useOc();
  const { reload: reloadMenu } = useMenu();
  const { reload } = useStockData();
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(candidates.map((c) => [c.x.id, c.suggested != null ? String(c.suggested) : ""])));
  const [cost, setCost] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    let count = 0;
    for (const c of candidates) {
      const n = Number(qty[c.x.id]);
      if (!n || n <= 0) continue;
      const cpu = (cost[c.x.id] || "").trim() === "" ? null : Number(cost[c.x.id]);
      const r = await recordStockChange({ entity_type: c.type, entity_id: c.x.id, stock_qty: c.qty + n, reason: "restock", qty_change: n, cost_per_unit: cpu, total_cost: cpu != null ? Math.round(cpu * n * 100) / 100 : null });
      if (r.success) count++;
    }
    await Promise.all([reload(), reloadMenu()]);
    toast("Restocked " + count + " item" + (count === 1 ? "" : "s"));
    onClose();
  };
  return (
    <div className="modal"><div className="mcard wide">
      <h3>Restock All ({candidates.length})</h3>
      <div style={{ maxHeight: "50vh", overflow: "auto" }}>{candidates.map((c) => (
        <div key={c.x.id} className="rb-bulkrow"><b>{c.name}</b>
          <input className="f2" inputMode="decimal" placeholder={`Qty (${c.unit})`} style={{ marginBottom: 6 }} value={qty[c.x.id] || ""} onChange={(e) => setQty({ ...qty, [c.x.id]: e.target.value })} />
          <input className="f2" inputMode="decimal" placeholder={`Cost per ${c.unit} (optional)`} style={{ marginBottom: 0 }} value={cost[c.x.id] || ""} onChange={(e) => setCost({ ...cost, [c.x.id]: e.target.value })} />
        </div>
      ))}</div>
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" disabled={busy} onClick={() => void go()}>{busy ? "Recording…" : "Confirm & Log All"}</button></div>
    </div></div>
  );
}

function StockTake({ menu, ingredients, onClose }: { menu: MenuItem[]; ingredients: Ingredient[]; onClose: () => void }) {
  const { toast } = useOc();
  const { reload: reloadMenu } = useMenu();
  const { reload } = useStockData();
  const items = [
    ...menu.filter((m) => m.track_stock).map((m) => ({ type: "menu_item" as EntityType, id: m.id, name: m.item_name, unit: "pcs", system: Number(m.stock_qty) })),
    ...ingredients.filter((i) => i.track_stock).map((i) => ({ type: "ingredient" as EntityType, id: i.id, name: i.name, unit: i.unit, system: Number(i.stock_qty) })),
  ];
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!items.length) return <div className="modal"><div className="mcard"><h3>Stock Take</h3><div className="none">No tracked items to count</div><div className="mrow"><button onClick={onClose}>Close</button></div></div></div>;
  const rows = items.filter((it) => (counts[it.id] || "").trim() !== "" && !isNaN(Number(counts[it.id]))).map((it) => {
    const counted = Number(counts[it.id]);
    return { it, counted, variance: Math.round((counted - it.system) * 1000) / 1000 };
  });
  const commit = async () => {
    setBusy(true);
    let n = 0;
    for (const r of rows) {
      const res = await recordStockChange({ entity_type: r.it.type, entity_id: r.it.id, stock_qty: r.counted, reason: "stock_take", qty_change: r.variance, note: r.variance === 0 ? "Physical count matched system" : "Physical count" });
      if (res.success) n++;
    }
    await Promise.all([reload(), reloadMenu()]);
    toast("Stock take committed — " + n + " item" + (n === 1 ? "" : "s") + " updated");
    onClose();
  };
  return (
    <div className="stocktake-overlay">
      {!review ? (
        <>
          <div className="st-head"><h2>📋 Stock Take — Count</h2><button className="btn sm ghost" onClick={onClose}>✕ Cancel</button></div>
          <p className="st-sub">Enter what you physically count for each item. Leave blank to skip it.</p>
          <div className="st-list">{items.map((it) => (
            <div key={it.id} className="st-row"><span className="st-name">{it.name}</span><span className="st-sys">System: {it.system} {it.unit}</span>
              <input className="f2 st-input" inputMode="decimal" placeholder="Counted" value={counts[it.id] || ""} onChange={(e) => setCounts({ ...counts, [it.id]: e.target.value })} /></div>
          ))}</div>
          <div className="st-foot"><button className="btn go" onClick={() => { if (!rows.length) { toast("Count at least one item"); return; } setReview(true); }}>Review →</button></div>
        </>
      ) : (
        <>
          <div className="st-head"><h2>📋 Stock Take — Review</h2><button className="btn sm ghost" onClick={() => setReview(false)}>← Back</button></div>
          <p className="st-sub">{rows.length} item{rows.length === 1 ? "" : "s"} counted. Review before committing — this writes to the stock ledger.</p>
          <div className="st-list">{rows.map((r) => (
            <div key={r.it.id} className="st-row"><span className="st-name">{r.it.name}</span><span className="st-sys">System {r.it.system} → Counted {r.counted} {r.it.unit}</span>
              <span className={`st-variance${r.variance !== 0 ? (r.variance > 0 ? " pos" : " neg") : ""}`}>{r.variance === 0 ? "No change" : (r.variance > 0 ? "+" : "") + r.variance}</span></div>
          ))}</div>
          <div className="st-foot"><button className="btn go" disabled={busy} onClick={() => void commit()}>{busy ? "Committing…" : `Commit ${rows.length} count${rows.length === 1 ? "" : "s"}`}</button></div>
        </>
      )}
    </div>
  );
}

function exportIngredientsCsv(list: Ingredient[]) {
  const header = ["Name", "Category", "Unit", "Stock Qty", "Low Stock Threshold", "Par Level", "Cost Per Unit"];
  const body = list.map((i) => [i.name, i.category || "", i.unit, i.stock_qty, i.low_stock_threshold ?? "", i.par_level ?? "", i.cost_per_unit ?? ""]);
  const csv = [header, ...body].map((r) => r.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = "rasoi-ingredients.csv";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

type CsvRow = { name: string; category: string; unit: string; stock_qty: string; low: string; par: string; cost: string };
function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const idx = (k: string) => header.indexOf(k);
  return lines.slice(1).map((l) => {
    const c = split(l);
    return { name: (c[idx("name")] || "").trim(), category: (c[idx("category")] || "").trim(), unit: (c[idx("unit")] || "kg").trim(), stock_qty: c[idx("stock qty")] || "", low: c[idx("low stock threshold")] || "", par: c[idx("par level")] || "", cost: c[idx("cost per unit")] || "" };
  }).filter((r) => r.name);
}

function ImportCsv({ ingredients, onClose }: { ingredients: Ingredient[]; onClose: () => void }) {
  const { toast } = useOc();
  const { reload } = useStockData();
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [skip, setSkip] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const matchKind = (name: string) => {
    const lower = name.trim().toLowerCase();
    const exact = ingredients.find((i) => i.name.trim().toLowerCase() === lower);
    if (exact) return { kind: "update" as const, match: exact };
    const close = ingredients.find((i) => { const a = i.name.trim().toLowerCase(); return a.includes(lower) || lower.includes(a); });
    return close ? { kind: "dupe" as const, match: close } : { kind: "new" as const, match: null };
  };
  const num = (s: string) => (s === "" ? null : Number(s));
  const commit = async () => {
    if (!rows) return;
    setBusy(true);
    let created = 0, updated = 0;
    for (let i = 0; i < rows.length; i++) {
      if (skip[i]) continue;
      const row = rows[i];
      const m = matchKind(row.name);
      const unit = (UNITS as readonly string[]).includes(row.unit) ? (row.unit as (typeof UNITS)[number]) : "kg";
      const target = m.match;
      const r = await saveIngredient({
        id: target?.id, name: target ? target.name : row.name, category: row.category, unit,
        low_stock_threshold: num(row.low), par_level: num(row.par), cost_per_unit: num(row.cost) ?? target?.cost_per_unit ?? null, nearest_expiry: target?.nearest_expiry || null,
      });
      if (!r.success || !("id" in r) || !r.id) continue;
      const qty = num(row.stock_qty);
      const prev = target ? Number(target.stock_qty) : 0;
      if (qty != null && qty !== prev) await recordStockChange({ entity_type: "ingredient", entity_id: r.id, stock_qty: qty, reason: "manual_adjust", qty_change: qty - prev, note: "CSV import" });
      if (target) updated++; else created++;
    }
    await reload();
    toast("Imported: " + created + " new, " + updated + " updated");
    onClose();
  };
  return (
    <div className="modal"><div className="mcard wide">
      <h3>Import Ingredients CSV</h3>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: "-2px 0 10px" }}>Columns: Name, Category, Unit, Stock Qty, Low Stock Threshold, Par Level, Cost Per Unit. Plain comma-separated — fields with commas or quotes inside them aren&apos;t supported.</p>
      <input type="file" accept=".csv,.txt" onChange={(e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          const parsed = parseCsv(String(rd.result));
          setRows(parsed);
          setSkip(Object.fromEntries(parsed.map((r, i) => [i, matchKind(r.name).kind === "dupe"])));
        };
        rd.readAsText(f);
      }} />
      {rows ? (rows.length ? (
        <div style={{ maxHeight: "40vh", overflow: "auto", marginTop: 12 }}><table><thead><tr><th>Row</th><th>Status</th><th>Include?</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const m = matchKind(r.name);
            return <tr key={i}><td><b>{r.name}</b></td>
              <td>{m.kind === "update" ? `[Update: ${m.match!.name}]` : m.kind === "dupe" ? `[Possible duplicate — ${m.match!.name}?]` : "[New]"}</td>
              <td><input type="checkbox" checked={!skip[i]} onChange={(e) => setSkip({ ...skip, [i]: !e.target.checked })} /></td></tr>;
          })}</tbody></table></div>
      ) : <div className="none" style={{ marginTop: 12 }}>No rows found in this file</div>) : null}
      <div className="mrow"><button onClick={onClose}>Cancel</button>{rows?.length ? <button className="go" disabled={busy} onClick={() => void commit()}>{busy ? "Importing…" : "Confirm Import"}</button> : null}</div>
    </div></div>
  );
}

