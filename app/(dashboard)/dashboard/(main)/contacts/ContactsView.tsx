"use client";

/* Oceana Contacts: import by CSV/paste, search, pick numbers, hand them to Blast. */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOc } from "../../DashShell";
import { db } from "../../oc-data";
import { importContacts } from "./actions";

type Customer = { phone: string; name: string | null; total_orders: number | null; last_order_date: string | null; opted_out: boolean | null };
export const PICK_KEY = "rasoi_blast_selection";
export const readPick = () => { try { return new Set<string>(JSON.parse(sessionStorage.getItem(PICK_KEY) || "[]")); } catch { return new Set<string>(); } };
const savePick = (s: Set<string>) => sessionStorage.setItem(PICK_KEY, JSON.stringify([...s]));
/** Same normalisation the server applies, so freshly imported numbers can be pre-selected. */
const normalise = (raw: string) => {
  const p = raw.replace(/\D/g, "");
  if (p.length === 11 && p[0] === "0") return "91" + p.slice(1);
  if (p.length === 10 && "6789".includes(p[0])) return "91" + p;
  if (p.length === 12 && p.startsWith("91")) return p;
  return p.length >= 10 ? p : "";
};

export default function ContactsView() {
  const router = useRouter();
  const { toast } = useOc();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : readPick()));
  const [paste, setPaste] = useState("");
  const [result, setResult] = useState<React.ReactNode>(null);
  const [drag, setDrag] = useState(false);

  const load = useCallback(async () => {
    const { data } = await db().from("customers").select("phone,name,total_orders,last_order_date,opted_out").order("last_order_date", { ascending: false, nullsFirst: false });
    setCustomers((data || []) as Customer[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const update = (s: Set<string>) => { setPick(s); savePick(s); };

  const doImport = async (text: string) => {
    const r = await importContacts(text);
    if (!r.success) { setResult(<div className="err">{r.error}</div>); return; }
    setResult(<div className="stat" style={{ padding: "12px 16px" }}><span>Imported</span><b>{r.count}</b></div>);
    setPaste("");
    const next = new Set(pick);
    String(text).split(/[\s,;]+/).map(normalise).filter(Boolean).forEach((p) => next.add(p));
    update(next);
    toast(r.count + " numbers added and selected");
    void load();
  };
  const readFile = (f?: File) => { if (!f) return; const rd = new FileReader(); rd.onload = () => void doImport(String(rd.result)); rd.readAsText(f); };

  const query = q.trim().toLowerCase();
  const rows = customers.filter((c) => !query || String(c.phone).includes(query) || String(c.name || "").toLowerCase().includes(query));
  const eligible = rows.filter((c) => !c.opted_out);
  return (
    <div>
      <div className="stats">
        <div className="stat"><span>Saved Contacts</span><b>{customers.length}</b></div>
        <div className="stat r"><span>Selected</span><b>{pick.size}</b></div>
        <div className="stat"><span>Opted Out</span><b>{customers.filter((c) => c.opted_out).length}</b></div>
      </div>
      <div className={`drop${drag ? " on" : ""}`}
        onDragEnter={(e) => { e.preventDefault(); setDrag(true); }} onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDrag(false); }}
        onDrop={(e) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files[0]); }}>
        <b style={{ color: "var(--ink)" }}>Add numbers</b><br />
        Drop a CSV here, or paste numbers below (one per line, or comma separated)
        <div style={{ marginTop: 12, display: "flex", gap: 9, justifyContent: "center", flexWrap: "wrap" }}>
          <label className="btn sm ghost" style={{ cursor: "pointer" }}>Choose CSV<input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={(e) => readFile(e.target.files?.[0])} /></label>
        </div>
      </div>
      <textarea className="f" rows={3} placeholder="9876543210, 9123456780 …" style={{ marginTop: 12 }} value={paste} onChange={(e) => setPaste(e.target.value)} />
      <button className="btn sm" onClick={() => void doImport(paste)}>Add to contacts</button>
      <div style={{ marginTop: 10 }}>{result}</div>

      <div className="pickbar" style={{ marginTop: 22 }}>
        <input className="f grow" placeholder="Search name or number" style={{ margin: 0 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn sm ghost" onClick={() => { const n = new Set(pick); eligible.forEach((c) => n.add(c.phone)); update(n); }}>Select all shown ({eligible.length})</button>
        <button className="btn sm ghost" onClick={() => update(new Set())}>Clear</button>
        {pick.size ? <span className="selinfo">{pick.size} selected</span> : null}
      </div>
      <table>
        <thead><tr><th style={{ width: 38 }}></th><th>Number</th><th>Name</th><th>Orders</th><th>Last order</th></tr></thead>
        <tbody>{rows.length ? rows.slice(0, 400).map((c) => (
          <tr key={c.phone}>
            <td><input type="checkbox" className="cbox" checked={pick.has(c.phone)} disabled={Boolean(c.opted_out)} onChange={(e) => {
              const n = new Set(pick); if (e.target.checked) n.add(c.phone); else n.delete(c.phone); update(n);
            }} /></td>
            <td>{c.phone}</td><td>{c.name || "—"}</td><td>{c.total_orders || 0}</td>
            <td>{c.last_order_date || "—"}{c.opted_out ? <> · <b style={{ color: "var(--red)" }}>opted out</b></> : null}</td>
          </tr>
        )) : <tr><td colSpan={5} className="none">No contacts yet</td></tr>}</tbody>
      </table>
      {rows.length > 400 ? <div className="none" style={{ marginTop: 10 }}>Showing first 400 — search to narrow.</div> : null}
      {pick.size ? <button className="btn" style={{ marginTop: 16 }} onClick={() => router.push("/dashboard/blast")}>Blast to {pick.size} selected →</button> : null}
    </div>
  );
}
