"use client";

/* Oceana Profit & Loss: Revenue → COGS (recipe cost) → Gross Profit →
   Expenses → Net Profit, compared with the previous period, plus expenses. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardOrder } from "@/lib/orders/queries";
import { useOrderManager } from "../../OrderManagerProvider";
import { useOc } from "../../DashShell";
import { db, isMissingTable, useMenu, useStockData } from "../../oc-data";
import { NotMigrated } from "../../StockKit";
import { ist, pct, rangeStart, rs, type RangeState } from "../../oc-utils";
import { dishMargins, RangeChips } from "../stock/StockView";
import { createExpense, deleteExpense } from "./actions";

type Expense = { id: string; expense_date: string; category: string; amount: number; note: string | null; recorded_by: string | null };
type Bounds = { start: number; end: number };

function bounds(r: RangeState): Bounds {
  const start = rangeStart(r).getTime();
  if (r.range === "yesterday") return { start, end: start + 86400000 };
  if (r.range === "custom" && r.to) return { start, end: new Date(r.to + "T00:00:00+05:30").getTime() + 86400000 };
  return { start, end: Date.now() };
}
function previous(r: RangeState): Bounds | null {
  if (r.range === "all" || r.range === "custom") return null;
  const b = bounds(r);
  if (r.range === "today") return { start: b.start - 86400000, end: b.start };
  if (r.range === "yesterday") return { start: b.start - 86400000, end: b.start };
  return { start: b.start - (b.end - b.start), end: b.start };
}
const COMPARE: Record<string, string> = { today: "yesterday", yesterday: "the day before", week: "last week", month: "last month" };

export default function PnlView() {
  const router = useRouter();
  const { orders } = useOrderManager();
  const { menu } = useMenu();
  const { ingredients, recipes, migrated, loaded } = useStockData();
  const { range, setRange, toast } = useOc();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [adding, setAdding] = useState(false);

  const loadExpenses = useCallback(async () => {
    const { data, error } = await db().from("expenses").select("*").order("expense_date", { ascending: false }).limit(1000);
    if (!error || !isMissingTable(error)) setExpenses((data || []) as Expense[]);
  }, []);
  useEffect(() => { void loadExpenses(); }, [loadExpenses]);

  if (loaded && !migrated) return <div><div className="mhead"><div><h2>Profit &amp; Loss</h2></div></div><NotMigrated /></div>;

  const margins = dishMargins(menu, recipes, ingredients);
  const costById: Record<string, number> = {};
  const costByName: Record<string, number> = {};
  margins.forEach((x) => { if (x.cost != null) { costById[x.item.id] = x.cost; costByName[x.item.item_name.trim().toLowerCase()] = x.cost; } });

  const summary = (b: Bounds) => {
    const ord = orders.filter((o: DashboardOrder) => { const t = new Date(o.created_at).getTime(); return t >= b.start && t < b.end && o.status !== "cancelled"; });
    const revenue = ord.reduce((s, o) => s + Number(o.total), 0);
    let cogs = 0, matchedQty = 0, excludedQty = 0, excludedLines = 0;
    ord.forEach((o) => (Array.isArray(o.items_json) ? o.items_json : []).forEach((li) => {
      const qty = Number(li.quantity) || 0;
      const cost = (li.menu_item_id && costById[li.menu_item_id] != null) ? costById[li.menu_item_id] : costByName[String(li.item_name || "").trim().toLowerCase()];
      if (cost != null) { cogs += cost * qty; matchedQty += qty; } else { excludedLines++; excludedQty += qty; }
    }));
    const exp = expenses.filter((e) => { const t = new Date(e.expense_date + "T12:00:00+05:30").getTime(); return t >= b.start && t < b.end; });
    const totalExpenses = exp.reduce((s, e) => s + Number(e.amount), 0);
    const grossProfit = revenue - cogs;
    return { revenue, cogs, matchedQty, excludedQty, excludedLines, totalExpenses, grossProfit, netProfit: grossProfit - totalExpenses, expenses: exp };
  };
  const cur = summary(bounds(range));
  const pb = previous(range);
  const prev = pb ? summary(pb) : null;
  const label = COMPARE[range.range] || "the previous period";

  const delta = (c: number, p: number | undefined, invert = false) => {
    if (p == null || (p === 0 && c === 0)) return null;
    if (p === 0) {
      const good = invert ? c <= 0 : c > 0;
      return <span className={`pnldelta ${good ? "pos" : "neg"}`}>{c > 0 ? "▲" : "▼"} {rs(Math.abs(c))} — no data for {label}</span>;
    }
    const diff = c - p;
    if (diff === 0) return <span className="pnldelta">No change vs {label}</span>;
    const good = invert ? diff < 0 : diff > 0;
    return <span className={`pnldelta ${good ? "pos" : "neg"}`}>{diff >= 0 ? "▲" : "▼"} {rs(Math.abs(diff))} vs {label}</span>;
  };

  const byCat: Record<string, number> = {};
  cur.expenses.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); });
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const catSuggest = [...new Set(["Rent & Utilities", "Salaries & wages", "Packaging & delivery", "Marketing & equipment", ...expenses.map((e) => e.category)])];

  const exportCsv = () => {
    const rows: Array<[string, number]> = [["Revenue", cur.revenue], ["COGS (ingredient cost)", -cur.cogs], ["Gross Profit", cur.grossProfit],
      ...catRows.map(([c, a]) => ["Expense: " + c, -a] as [string, number]), ["Total Expenses", -cur.totalExpenses], ["Net Profit", cur.netProfit]];
    const csv = [["Line", "Amount"], ...rows].map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "rasoi-pnl-" + range.range + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this expense entry?")) return;
    const r = await deleteExpense(id);
    if (!r.success) { toast("Could not delete"); return; }
    setExpenses((x) => x.filter((e) => e.id !== id));
    toast("Expense deleted");
  };

  const totalQty = cur.matchedQty + cur.excludedQty;
  const covPct = totalQty > 0 ? Math.round((cur.matchedQty / totalQty) * 100) : 0;
  const row = (labelText: React.ReactNode, value: number, prevValue: number | undefined, cls = "", invert = false, extra: React.ReactNode = null) => (
    <div className={`pnlrow ${cls}`}>
      <div className="pnlrow-label">{labelText}</div>
      <div className="pnlrow-right"><div className="pnlrow-val">{value < 0 && cls.includes("final") ? "−" : ""}{rs(cls.includes("final") ? Math.abs(value) : value)}{extra}</div>{delta(value, prevValue, invert)}</div>
    </div>
  );

  return (
    <div>
      <div className="mhead">
        <div><h2>Profit &amp; Loss</h2><p>Revenue minus ingredient cost minus operating expenses, for the period below.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn sm ghost" onClick={exportCsv}>⬇ Export CSV</button>
          <button className="btn sm" onClick={() => setAdding(true)}>+ Add Expense</button>
        </div>
      </div>
      <RangeChips range={range.range} from={range.from} to={range.to} onChange={setRange} />
      <div className="ov-card">
        <h4>Profit &amp; Loss Statement</h4>
        {cur.excludedLines ? (
          <div className="pnlwarn">⚠ <b>Costs are understated — recipe coverage is incomplete.</b> Only {covPct}% of items sold this period ({cur.matchedQty} of {totalQty}) have a recorded recipe cost. The other {cur.excludedQty} item{cur.excludedQty === 1 ? "" : "s"} contribute ₹0 to COGS below, so Gross Profit and Net Profit are both <b>higher than they really are</b> until more recipes are built.{" "}
            <a href="#" style={{ color: "inherit", fontWeight: 800 }} onClick={(e) => { e.preventDefault(); router.push("/dashboard/stock"); }}>Go build recipes →</a></div>
        ) : null}
        <div className="pnlstmt">
          {row("Revenue", cur.revenue, prev?.revenue)}
          {row(<>− Cost of Goods Sold{cur.excludedLines ? <span className="pnlflag">partial</span> : null}</>, cur.cogs, prev?.cogs, "sub", true)}
          {row("Gross Profit", cur.grossProfit, prev?.grossProfit, "total", false, <span className="pnlmargin">{cur.revenue > 0 ? pct((cur.grossProfit / cur.revenue) * 100) + " margin" : ""}</span>)}
          {row("− Operating Expenses", cur.totalExpenses, prev?.totalExpenses, "sub", true)}
          {row(cur.netProfit >= 0 ? "Net Profit" : "Net Loss", cur.netProfit, prev?.netProfit, `final ${cur.netProfit >= 0 ? "profit" : "loss"}`)}
        </div>
      </div>
      <div className="anacard" style={{ marginBottom: 14 }}>
        <h4>Expenses by category</h4>
        {catRows.length ? (
          <div style={{ overflowX: "auto" }}><table><thead><tr><th>Category</th><th>Amount</th><th>% of expenses</th></tr></thead>
            <tbody>{catRows.map(([c, a]) => <tr key={c}><td><b>{c}</b></td><td>{rs(a)}</td><td>{cur.totalExpenses > 0 ? ((a / cur.totalExpenses) * 100).toFixed(0) + "%" : "—"}</td></tr>)}</tbody></table></div>
        ) : <div className="none">No expenses logged in this period</div>}
      </div>
      <div className="anacard" style={{ marginBottom: 14 }}>
        <h4>Expense ledger</h4>
        {cur.expenses.length ? (
          <div className="ledger">{cur.expenses.map((e) => (
            <div key={e.id}><span>{ist(e.expense_date + "T12:00:00+05:30")} · {e.category}{e.note ? " · " + e.note : ""} · {e.recorded_by}</span>
              <b>{rs(e.amount)} <button className="icostbtn" title="Delete" onClick={() => void remove(e.id)}>🗑️</button></b></div>
          ))}</div>
        ) : <div className="none">No expenses logged in this period</div>}
      </div>
      {adding ? <AddExpense suggest={catSuggest} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void loadExpenses(); }} /> : null}
    </div>
  );
}

function AddExpense({ suggest, onClose, onSaved }: { suggest: string[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useOc();
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const [v, setV] = useState({ date: today, cat: "", amt: "", note: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const lbl = (t: string) => <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", display: "block", margin: "10px 0 4px" }}>{t}</label>;
  const save = async () => {
    const amt = Number(v.amt);
    if (!v.date || !v.cat.trim() || !amt || amt <= 0) { toast("Date, category and a valid amount are required"); return; }
    setBusy(true);
    const r = await createExpense({ expense_date: v.date, category: v.cat.trim(), amount: amt, note: v.note });
    setBusy(false);
    if (!r.success) { toast(r.error || "Could not save expense"); return; }
    toast("Expense added");
    onSaved();
  };
  return (
    <div className="modal"><div className="mcard">
      <h3>Add Expense</h3>
      {lbl("Date")}<input className="f2" type="date" value={v.date} onChange={set("date")} />
      {lbl("Category *")}<input className="f2" list="expcatlist" placeholder="e.g. Rent & Utilities" value={v.cat} onChange={set("cat")} />
      <datalist id="expcatlist">{suggest.map((c) => <option key={c} value={c} />)}</datalist>
      {lbl("Amount — ₹ *")}<input className="f2" inputMode="decimal" placeholder="How much was spent" value={v.amt} onChange={set("amt")} />
      {lbl("Note (optional)")}<input className="f2" placeholder="e.g. October electricity bill" value={v.note} onChange={set("note")} />
      <div style={{ fontSize: 11.5, color: "var(--muted)", margin: "-4px 0 10px" }}>Don&apos;t log ingredient restocks here — those are already tracked automatically through Stock → Restock.</div>
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" disabled={busy} onClick={() => void save()}>Save</button></div>
    </div></div>
  );
}
