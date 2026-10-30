"use client";

/* Oceana floor grid. Rasoi keeps one dine-in order per table with rounds in
   items_json, so a "tab" is that order and each round is a group of its lines. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardOrder } from "@/lib/orders/queries";
import { useOrderManager } from "../../OrderManagerProvider";
import { useOc } from "../../DashShell";
import { inRange, ist, lineItemsOf, rs } from "../../oc-utils";
import { printOrderBill } from "@/lib/print/bill";
import { useTables } from "../../oc-data";
import { addTable, clearTable, fetchTableHistory, mergeTables, moveTable, resendClosedTableBill } from "./actions";

type Table = { id: string; table_number: string };
type History = { id: string; order_number: string; total: number; status: string; created_at: string; whatsapp_bill_sent_at: string | null; whatsapp_bill_error: string | null };
type State = "free" | "busy" | "ready";
const OPEN = ["new", "preparing", "ready_for_pickup"];
const STATE_LABEL: Record<State, string> = { free: "Available", busy: "Occupied", ready: "Food ready" };
const RANK: Record<State, number> = { ready: 0, busy: 1, free: 2 };

const mins = (t: string) => Math.floor((Date.now() - new Date(t).getTime()) / 60000);

export default function TablesView() {
  const router = useRouter();
  const { orders, refreshOrders } = useOrderManager();
  const { range, toast } = useOc();
  const [closeFor, setCloseFor] = useState<{ t: Table; o: DashboardOrder } | null>(null);
  const [moveFor, setMoveFor] = useState<{ t: Table; o: DashboardOrder } | null>(null);
  const [mergeFor, setMergeFor] = useState<{ t: Table; o: DashboardOrder } | null>(null);
  const [hist, setHist] = useState<{ num: string; rows: History[] | null } | null>(null);
  const [wantPrint, setWantPrint] = useState(true);
  const [busy, setBusy] = useState(false);

  const { list, reload: loadTables } = useTables();
  const tables: Table[] = list || [];

  const tabOf = (num: string) => orders.find((o) => String(o.table_number || "").trim() === String(num).trim() && OPEN.includes(o.status));
  const stateOf = (o?: DashboardOrder): State => (!o ? "free" : o.status === "ready_for_pickup" ? "ready" : "busy");
  const open = tables.filter((t) => tabOf(t.table_number));
  const openVal = open.reduce((s, t) => s + Number(tabOf(t.table_number)?.total || 0), 0);
  const dine = orders.filter((o) => (o.order_type === "dine-in" || String(o.table_number || "").trim()) && inRange(o, range));
  const sorted = [...tables].sort((a, b) => RANK[stateOf(tabOf(a.table_number))] - RANK[stateOf(tabOf(b.table_number))]);
  const attention = tables.filter((t) => stateOf(tabOf(t.table_number)) === "ready");

  const newTable = async () => {
    const n = prompt("New table number");
    if (!n) return;
    const r = await addTable(String(n));
    if (!r.success) { toast(r.error || "Could not add"); return; }
    toast("Table " + n + " added");
    void loadTables();
  };
  const close = async () => {
    if (!closeFor) return;
    setBusy(true);
    const { t, o } = closeFor;
    const r = await clearTable(t.id);
    setBusy(false);
    setCloseFor(null);
    if (!r.success) { toast("Could not close table " + t.table_number); return; }
    toast("Table " + t.table_number + " closed · " + rs(o.total) + (r.whatsappBillSent === false ? " · bill not sent" : ""));
    if (wantPrint) setTimeout(() => void printOrderBill(o.id), 300);
    void refreshOrders();
  };
  const move = async (to: string) => {
    if (!moveFor) return;
    const r = await moveTable(moveFor.o.id, moveFor.t.table_number, to);
    setMoveFor(null);
    if (!r.success) { toast(r.error || "Could not move"); return; }
    toast("Moved to table " + to);
    void refreshOrders();
  };
  const merge = async (target: DashboardOrder) => {
    if (!mergeFor) return;
    const r = await mergeTables(mergeFor.o.id, target.id, mergeFor.t.table_number);
    setMergeFor(null);
    if (!r.success) { toast(r.error || "Could not merge"); return; }
    toast("Merged into table " + target.table_number);
    void refreshOrders();
  };
  const showHistory = async (num: string) => {
    setHist({ num, rows: null });
    const r = await fetchTableHistory(num);
    setHist({ num, rows: r.success ? ((r.history || []) as History[]) : [] });
  };
  const resend = async (id: string) => {
    const r = await resendClosedTableBill(id);
    toast(r.success ? "Bill sent on WhatsApp" : r.error || "Bill could not be sent");
    if (hist) void showHistory(hist.num);
  };
  const printQR = (num: string) => {
    const url = `${window.location.origin}/?table=${encodeURIComponent(num)}`;
    const img = "https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&data=" + encodeURIComponent(url);
    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) return;
    const n = String(num).replace(/[<>&"]/g, "");
    w.document.write(`<html><head><title>Table ${n} QR</title><style>
      body{font-family:system-ui,sans-serif;text-align:center;padding:26px}
      h1{font-size:40px;margin:0;color:#E23744}.s{letter-spacing:3px;color:#6B7684;font-size:12px}
      h2{font-size:34px;margin:14px 0}img{width:300px;height:300px}
      p{color:#6B7684;font-size:13px;margin:6px 0}</style></head><body>
      <h1>RASOI</h1><div class="s">DINE-IN · TAKEAWAY</div>
      <h2>TABLE ${n}</h2><img src="${img}" alt="QR">
      <p><b>Scan to see the menu &amp; order</b></p>
      <p>No app needed · Opens in your browser</p></body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 900);
  };

  return (
    <div>
      <div className="stats">
        <div className="stat p"><span>Tables Open</span><b>{open.length} / {tables.length}</b></div>
        <div className="stat o"><span>Food Ready</span><b>{attention.length}</b></div>
        <div className="stat b"><span>Dine-in {range.range}</span><b>{dine.length}</b></div>
        <div className="stat r"><span>Open Value</span><b>{rs(openVal)}</b></div>
      </div>
      {attention.length ? (
        <div className="attnbar">
          <span className="al"><span className="dot" />Needs attention</span>
          {attention.map((t) => (
            <button key={t.id} className="attnchip" onClick={() => {
              const card = document.getElementById("tbl-" + t.table_number);
              card?.scrollIntoView({ behavior: "smooth", block: "center" });
              card?.animate?.([{ boxShadow: "0 0 0 5px #E89B1C" }, { boxShadow: "0 0 0 0px rgba(232,155,28,0)" }], { duration: 900 });
            }}>Table {t.table_number} · Food ready</button>
          ))}
        </div>
      ) : null}
      <div className="floorbar">
        <button className="btn sm" onClick={() => void newTable()}>+ Add table</button>
        <span className="flabel">{tables.length} tables · tables needing you float to the top</span>
      </div>
      <div className="floor">
        {sorted.map((t) => {
          const o = tabOf(t.table_number);
          const st = stateOf(o);
          const lines = o ? lineItemsOf(o) : [];
          const rounds = [...new Set(lines.map((l) => l.round))].sort((a, b) => a - b);
          const lastRound = rounds[rounds.length - 1];
          const m = o ? mins(o.created_at) : 0;
          const clock = m >= 60 ? "bad" : m >= 40 ? "warn" : "";
          return (
            <div key={t.id} className={`tbl ${st}`} id={"tbl-" + t.table_number}>
              <div className="th">
                <div className="tn">{t.table_number}</div>
                <div><div style={{ fontWeight: 800, fontSize: 14 }}>Table {t.table_number}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 700 }}>{o ? o.order_number : "Ready for guests"}</div></div>
                <span className="tstate">{STATE_LABEL[st]}</span>
              </div>
              <div className="tb">
                {o ? (
                  <>
                    <div className="guest"><span>{o.customer_name || "Guest"}{o.customer_phone ? " · " + o.customer_phone : ""}</span>
                      <span className={`runclock ${clock}`}>⏱ {m}m</span></div>
                    {rounds.map((r) => {
                      const rl = lines.filter((l) => l.round === r);
                      return (
                        <div key={r} className="rnd">
                          <div className="rh"><span>Round {r}{r === lastRound ? " · " + String(o.status).replace(/_/g, " ") : " · served"}</span><span>{rs(rl.reduce((s, l) => s + l.lineTotal, 0))}</span></div>
                          {rl.map((l, i) => (
                            <div key={i}>
                              <div className="li"><span>{l.quantity ? `${l.name} ×${l.quantity}` : l.name}</span><span>{l.lineTotal ? rs(l.lineTotal) : ""}</span></div>
                              {l.notes ? <div className="linote">{l.notes}</div> : null}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                    {o.source === "pos" && ["new", "preparing"].includes(o.status) ? (
                      <div className="mini"><button onClick={() => router.push(`/dashboard/pos?edit=${o.id}`)}>Edit round</button></div>
                    ) : null}
                  </>
                ) : <div className="none" style={{ padding: "14px 0" }}>Free — no open tab</div>}
              </div>
              {o ? <div className="trun"><span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>RUNNING TOTAL</span><b>{rs(o.total)}</b></div> : null}
              <div className="tacts">
                {o ? (
                  <>
                    <button className="pay" onClick={() => { setWantPrint(true); setCloseFor({ t, o }); }}>💵 Close &amp; pay · {rs(o.total)}</button>
                    <button onClick={() => router.push(`/dashboard/pos?append=${o.id}&table=${encodeURIComponent(t.table_number)}`)}>+ Round</button>
                    <button onClick={() => setMoveFor({ t, o })}>Move</button>
                    <button onClick={() => setMergeFor({ t, o })}>Merge</button>
                  </>
                ) : <button className="go" onClick={() => router.push(`/dashboard/pos?table=${encodeURIComponent(t.table_number)}`)}>Start order</button>}
                <button onClick={() => printQR(t.table_number)}>QR</button>
                <button onClick={() => void showHistory(t.table_number)}>History</button>
              </div>
            </div>
          );
        })}
      </div>

      {closeFor ? (
        <div className="modal">
          <div className="mcard">
            <h3>Close table {closeFor.t.table_number}</h3>
            <div className="ctot"><span>Total</span><span>{rs(closeFor.o.total)}</span></div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 8px" }}>
              {closeFor.o.customer_phone ? `The bill image goes to ${closeFor.o.customer_phone} on WhatsApp.` : "No WhatsApp number on this tab — no bill will be sent."}
            </p>
            <label style={{ fontSize: 12.5, fontWeight: 700, display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input type="checkbox" checked={wantPrint} onChange={(e) => setWantPrint(e.target.checked)} /> Print the bill
            </label>
            <div className="mrow"><button onClick={() => setCloseFor(null)}>Cancel</button><button className="go" disabled={busy} onClick={() => void close()}>{busy ? "Closing…" : "Close table"}</button></div>
          </div>
        </div>
      ) : null}

      {moveFor ? (
        <div className="modal">
          <div className="mcard">
            <h3>Move table {moveFor.t.table_number} to</h3>
            <div className="rlist">
              {tables.filter((t) => !tabOf(t.table_number)).length
                ? tables.filter((t) => !tabOf(t.table_number)).map((t) => <button key={t.id} onClick={() => void move(t.table_number)}>Table {t.table_number}</button>)
                : <div className="none">No free table to move to</div>}
            </div>
            <button className="btn ghost" onClick={() => setMoveFor(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {mergeFor ? (
        <div className="modal">
          <div className="mcard">
            <h3>Merge table {mergeFor.t.table_number} into</h3>
            <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 12px" }}>All rounds move onto the table you pick, and table {mergeFor.t.table_number} is freed.</p>
            <div className="rlist">
              {open.filter((t) => t.id !== mergeFor.t.id).length
                ? open.filter((t) => t.id !== mergeFor.t.id).map((t) => {
                  const target = tabOf(t.table_number)!;
                  return <button key={t.id} onClick={() => void merge(target)}>Table {t.table_number} · {rs(target.total)}</button>;
                })
                : <div className="none">No other open table to merge with</div>}
            </div>
            <button className="btn ghost" onClick={() => setMergeFor(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {hist ? (
        <div className="modal">
          <div className="mcard">
            <h3>Table {hist.num} · recent tabs</h3>
            {hist.rows === null ? <div className="none">Loading…</div> : hist.rows.length ? (
              <div className="ledger">
                {hist.rows.map((r) => (
                  <div key={r.id}>
                    <span>{ist(r.created_at)} · {r.order_number}{r.status === "cancelled" ? " · cancelled" : ""}
                      {r.status === "delivered" && !r.whatsapp_bill_sent_at ? <> · <button style={{ color: "var(--red)", fontWeight: 700 }} onClick={() => void resend(r.id)}>Send bill</button></> : null}
                    </span>
                    <b>{rs(r.total)}</b>
                  </div>
                ))}
              </div>
            ) : <div className="none">No closed tabs yet</div>}
            <div className="mrow"><button onClick={() => setHist(null)}>Close</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
