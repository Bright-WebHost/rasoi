"use client";

/* Oceana Riders: add rider, totals strip, per-rider table (cards on phones),
   on-duty switch, cash handover with ledger, delete. */
import { useCallback, useEffect, useState } from "react";
import { useStaff } from "@/components/providers/StaffProvider";
import { useOc } from "../../DashShell";
import { RANGE_CHIPS, cleanNum, ist, rs, useIsMobile, type Range } from "../../oc-utils";
import {
  addRider, collectRiderCash, deleteRider, fetchRiderPaymentLedger, fetchRidersPageData, toggleRiderStatus,
  type RiderStats, type TimeFilter,
} from "./actions";

type Payment = { id: string; rider_id: string | null; amount: number; note: string | null; received_by: string | null; created_at: string };
const FILTER: Record<Range, TimeFilter> = { today: "today", yesterday: "yesterday", week: "this_week", month: "this_month", all: "all_time", custom: "all_time" };
const smallBtn: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", padding: "7px 11px", borderRadius: 9, fontWeight: 700, fontSize: 12 };

export default function RidersView() {
  const { range, setRange, toast } = useOc();
  const { hasPerm } = useStaff();
  const mobile = useIsMobile();
  const [riders, setRiders] = useState<RiderStats[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cashFor, setCashFor] = useState<RiderStats | null>(null);
  const manage = hasPerm("manage_riders");

  const load = useCallback(async () => {
    const [r, l] = await Promise.all([fetchRidersPageData(FILTER[range.range]), fetchRiderPaymentLedger()]);
    if (r.success && r.riders) setRiders(r.riders); else setRiders([]);
    if (l.success && l.payments) setPayments(l.payments as Payment[]);
  }, [range.range]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const n = name.trim(), p = cleanNum(phone);
    if (!n || !p) { toast("Name and number needed"); return; }
    const r = await addRider(n, p);
    if (!r.success) { toast(/duplicate|already/i.test(r.error || "") ? "That number is already a rider" : r.error || "Could not add"); return; }
    setName(""); setPhone("");
    toast(n + " added");
    void load();
  };
  const toggle = async (r: RiderStats) => {
    const res = await toggleRiderStatus(r.id, !r.is_active);
    if (!res.success) { toast("Could not update"); return; }
    toast(r.name + (!r.is_active ? " is back on" : " is off duty"));
    void load();
  };
  const remove = async (r: RiderStats) => {
    if (r.owes > 0) { toast(r.name + " still owes " + rs(r.owes) + " — settle before deleting"); return; }
    if (!confirm("Delete " + r.name + "? Past deliveries stay on record.")) return;
    const res = await deleteRider(r.id);
    if (!res.success) { toast("Could not delete — they may be linked to live orders"); return; }
    toast(r.name + " removed");
    void load();
  };

  const list = riders || [];
  const T = (k: keyof Pick<RiderStats, "done" | "cancelled" | "collected" | "pending" | "handedOver" | "owes">) => list.reduce((a, x) => a + Number(x[k] || 0), 0);

  return (
    <div>
      <div className="filterrow">
        <span className="flabel">Filter:</span>
        <div className="chips">{RANGE_CHIPS.map(([k, l]) => <button key={k} className="chip" aria-pressed={range.range === k} onClick={() => setRange({ ...range, range: k })}>{l}</button>)}</div>
      </div>
      {manage ? (
        <div className="tcard">
          <h3 style={{ margin: "0 0 10px", fontFamily: "var(--font-fraunces),Georgia,serif" }}>Add a rider</h3>
          <div className="pickbar">
            <input className="f grow" placeholder="Name" style={{ margin: 0 }} value={name} onChange={(e) => setName(e.target.value)} />
            <input className="f grow" placeholder="WhatsApp number" style={{ margin: 0 }} value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button className="btn sm" onClick={() => void add()}>Add</button>
          </div>
        </div>
      ) : null}
      <div className="riderhdr">
        <div className="rstat"><span>Deliveries done</span><b>{T("done")}</b></div>
        <div className="rstat"><span>Cancelled</span><b>{T("cancelled")}</b></div>
        <div className="rstat"><span>Cash collected</span><b>{rs(T("collected"))}</b></div>
        <div className="rstat"><span>Still to collect</span><b style={{ color: "var(--red)" }}>{rs(T("pending"))}</b></div>
        <div className="rstat"><span>Handed over</span><b>{rs(T("handedOver"))}</b></div>
        <div className="rstat"><span>Riders owe</span><b style={{ color: "var(--red)" }}>{rs(T("owes"))}</b></div>
      </div>
      {riders === null ? <div className="none">Loading riders…</div> : mobile ? (
        <div className="molist">
          {list.length ? list.map((r) => (
            <div key={r.id} className="mocard">
              <div className="morow"><b>{r.name}</b><span>{r.whatsapp_number}</span></div>
              <div className="moitems">
                Done <b>{r.done}</b>{r.cancelled ? <> · Cancelled <b style={{ color: "var(--red)" }}>{r.cancelled}</b></> : null}<br />
                Collected <b>{rs(r.collected)}</b>{r.pending ? <> · Pending <b style={{ color: "var(--red)" }}>{rs(r.pending)}</b></> : null}<br />
                Handed over <b>{rs(r.handedOver)}</b>{r.owes ? <> · Owes <b style={{ color: "var(--red)" }}>{rs(r.owes)}</b></> : null}
              </div>
              {manage ? (
                <div className="moacts">
                  <button className={`mobtn${r.is_active ? " go" : ""}`} onClick={() => void toggle(r)}>{r.is_active ? "🟢 On duty" : "⚪ Off duty"}</button>
                  <button className="mobtn" onClick={() => setCashFor(r)}>Collect cash</button>
                  <button className="mobtn bad" onClick={() => void remove(r)}>Delete</button>
                </div>
              ) : null}
            </div>
          )) : <div className="none">No riders yet</div>}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}><table>
          <thead><tr><th>Rider</th><th>Number</th><th>Done</th><th>Cancelled</th><th>Collected</th><th>Pending</th><th>Handed over</th><th>Owes</th><th>On duty</th><th></th></tr></thead>
          <tbody>{list.length ? list.map((r) => (
            <tr key={r.id}>
              <td><b>{r.name}</b></td><td>{r.whatsapp_number}</td>
              <td>{r.done}</td><td>{r.cancelled ? <b style={{ color: "var(--red)" }}>{r.cancelled}</b> : "0"}</td>
              <td><b>{rs(r.collected)}</b></td>
              <td>{r.pending ? <b style={{ color: "var(--red)" }}>{rs(r.pending)}</b> : "—"}</td>
              <td>{rs(r.handedOver)}</td>
              <td>{r.owes ? <b style={{ color: "var(--red)" }}>{rs(r.owes)}</b> : "—"}</td>
              <td><button className="sw" aria-pressed={r.is_active} disabled={!manage} onClick={() => void toggle(r)}><i /></button></td>
              <td>{manage ? <>
                <button style={{ ...smallBtn, marginRight: 5 }} onClick={() => setCashFor(r)}>Collect cash</button>
                <button className="danger" style={smallBtn} onClick={() => void remove(r)}>Delete</button>
              </> : null}</td>
            </tr>
          )) : <tr><td colSpan={10} className="none">No riders yet</td></tr>}</tbody>
        </table></div>
      )}
      {cashFor ? <CashModal rider={cashFor} payments={payments.filter((p) => p.rider_id === cashFor.id)} onClose={() => setCashFor(null)} onSaved={() => { setCashFor(null); void load(); }} /> : null}
    </div>
  );
}

function CashModal({ rider, payments, onClose, onSaved }: { rider: RiderStats; payments: Payment[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useOc();
  const [amt, setAmt] = useState(rider.owes ? String(rider.owes) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const a = Number(amt);
    if (!a || a <= 0) { toast("Enter the amount received"); return; }
    setBusy(true);
    const r = await collectRiderCash(rider.id, a, note);
    setBusy(false);
    if (!r.success) { toast(r.error || "Could not record that"); return; }
    toast(rs(r.collectedAmount ?? a) + " recorded from " + rider.name);
    onSaved();
  };
  return (
    <div className="modal"><div className="mcard">
      <h3>Cash from {rider.name}</h3>
      <input className="f2" inputMode="decimal" placeholder="Amount received *" autoFocus value={amt} onChange={(e) => setAmt(e.target.value)} />
      <input className="f2" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" disabled={busy} onClick={() => void save()}>Record</button></div>
      {payments.length ? (
        <div className="ledger">{payments.slice(0, 12).map((p) => (
          <div key={p.id}><span>{ist(p.created_at)}{p.note ? " · " + p.note : ""}{p.received_by ? " · " + p.received_by : ""}</span><b>{rs(p.amount)}</b></div>
        ))}</div>
      ) : null}
    </div></div>
  );
}
