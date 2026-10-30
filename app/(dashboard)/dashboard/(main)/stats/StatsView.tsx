"use client";

/* Oceana Analytics: overview pills, order-type donut, top items, sales by day,
   hourly heatmap, cancelled orders, channels, riders and the shift-close report. */
import { useEffect, useState } from "react";
import type { DashboardOrder } from "@/lib/orders/queries";
import { useOrderManager } from "../../OrderManagerProvider";
import { useOc } from "../../DashShell";
import { channelOf, dayKeyIST, inRange, ist, rs, useIsMobile } from "../../oc-utils";
import { RangeChips } from "../stock/StockView";
import { fetchRiders } from "../riders/actions";

type RiderRow = { id: string; name: string };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cancelReason = (o: DashboardOrder) => { const r = String(o.cancel_reason || ""); return (r.includes("|") ? r.split("|").slice(1).join("|") : r) || "No reason provided"; };
const itemsOf = (o: DashboardOrder) => (Array.isArray(o.items_json) ? o.items_json : []);

function Empty({ icon, text }: { icon: string; text: string }) {
  return <div className="aempty"><div className="aei">{icon}</div><div>{text}</div></div>;
}

function Pie({ live }: { live: DashboardOrder[] }) {
  const defs: Array<[string, string, string]> = [["dine-in", "Dine-in", "#2F6FE0"], ["delivery", "Delivery", "#17C3B2"], ["takeaway", "Takeaway", "#FFA43D"]];
  const data = defs.map(([k, l, c]) => ({ l, c, n: live.filter((o) => channelOf(o) === k).length }));
  const tot = data.reduce((a, d) => a + d.n, 0);
  if (!tot) return <Empty icon="🍽️" text="No orders in this range" />;
  let a0 = -Math.PI / 2;
  const paths = data.filter((d) => d.n).map((d) => {
    const ang = (d.n / tot) * Math.PI * 2, a1 = a0 + ang, big = ang > Math.PI ? 1 : 0, ro = 100, ri = 62;
    const p = (r: number, a: number) => `${(110 + r * Math.cos(a)).toFixed(1)},${(110 + r * Math.sin(a)).toFixed(1)}`;
    const el = d.n === tot
      ? <circle key={d.l} cx="110" cy="110" r={(ro + ri) / 2} fill="none" stroke={d.c} strokeWidth={ro - ri} />
      : <path key={d.l} d={`M${p(ro, a0)} A${ro},${ro} 0 ${big},1 ${p(ro, a1)} L${p(ri, a1)} A${ri},${ri} 0 ${big},0 ${p(ri, a0)} Z`} fill={d.c} />;
    a0 = a1;
    return el;
  });
  return (
    <div className="pie-wrap">
      <svg viewBox="0 0 220 220" width="170" height="170">{paths}
        <text x="110" y="104" textAnchor="middle" fontSize="24" fontWeight="800" fill="#10151C">{tot}</text>
        <text x="110" y="124" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#6B7684">ORDERS</text>
      </svg>
      <div className="legend">{data.map((d) => <div key={d.l}><i style={{ background: d.c }} />{d.l}<b>{d.n}</b></div>)}</div>
    </div>
  );
}

function SalesByDay({ live }: { live: DashboardOrder[] }) {
  const byDay: Record<string, number> = {};
  live.forEach((o) => { const k = dayKeyIST(o); byDay[k] = (byDay[k] || 0) + Number(o.total); });
  const days = Object.keys(byDay).sort().slice(-10);
  if (!days.length) return <Empty icon="📈" text="No orders in this range" />;
  const max = Math.max(1, ...days.map((k) => byDay[k]));
  let trend = null;
  if (days.length >= 2) {
    const last = byDay[days[days.length - 1]], prev = byDay[days[days.length - 2]];
    if (prev) { const p = Math.round(((last - prev) / prev) * 100); trend = <div className={`trendbubble ${p >= 0 ? "up" : "down"}`}>{p >= 0 ? "▲" : "▼"} {Math.abs(p)}% vs prev day</div>; }
  }
  return (
    <>
      {trend}
      <div className="bars">{days.map((k) => {
        const lbl = new Date(k + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
        return <div key={k} className="bcol" title={`${lbl} · ${rs(byDay[k])}`}><div className="bfill" style={{ height: Math.max(3, Math.round((byDay[k] / max) * 100)) + "%" }} /><span className="blbl">{lbl}</span></div>;
      })}</div>
    </>
  );
}

function Heatmap({ live }: { live: DashboardOrder[] }) {
  if (!live.length) return <Empty icon="🔥" text="No orders in this range" />;
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  live.forEach((o) => { const d = new Date(new Date(o.created_at).getTime() + 19800000); heat[d.getUTCDay()][d.getUTCHours()]++; });
  const max = Math.max(1, ...heat.flat());
  const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return (
    <>
      <div className="heatwrap"><div className="heat">
        <div className="hd" />
        {Array.from({ length: 24 }, (_, h) => <div key={"h" + h} className="hh">{h}</div>)}
        {DAYS.map((dn, wd) => [
          <div key={dn} className="hd">{dn}</div>,
          ...heat[wd].map((n, h) => {
            const op = n ? Math.max(0.16, n / max) : 0;
            return <div key={dn + h} className="heatcell" title={`${dn} ${h}:00 · ${n} order${n === 1 ? "" : "s"}`}
              style={{ background: n ? `rgba(226,55,68,${op.toFixed(2)})` : "#F0F2F5", color: op > 0.45 ? "#fff" : "#9A2530" }}>{n || ""}</div>;
          }),
        ])}
      </div></div>
      <div className="heatlegend"><span>Fewer</span>
        {["#F0F2F5", "rgba(226,55,68,.25)", "rgba(226,55,68,.5)", "rgba(226,55,68,.75)", "rgba(226,55,68,1)"].map((c) => <i key={c} style={{ background: c }} />)}
        <span>More</span></div>
    </>
  );
}

function Channels({ live }: { live: DashboardOrder[] }) {
  if (!live.length) return <Empty icon="🌐" text="No orders in this range" />;
  const chan: Array<[string, string, string]> = [["pos", "Counter (POS)", "#2F6FE0"], ["pwa", "Menu link", "#17C3B2"], ["whatsapp", "WhatsApp chat", "#FFA43D"]];
  const rows = chan.map(([k, label, color]) => { const r = live.filter((o) => o.source === k); return { label, color, n: r.length, v: r.reduce((a, o) => a + Number(o.total), 0) }; });
  const other = live.filter((o) => !chan.some(([k]) => k === o.source));
  if (other.length) rows.push({ label: "Other", color: "#9AA3AD", n: other.length, v: other.reduce((a, o) => a + Number(o.total), 0) });
  const max = Math.max(1, ...rows.map((r) => r.v));
  return <>{rows.filter((r) => r.n).map((r) => (
    <div key={r.label} className="hbar-row"><span className="hbar-label">{r.label}</span>
      <div className="hbar-track"><div className="hbar-fill" style={{ width: Math.max(4, Math.round((r.v / max) * 100)) + "%", background: r.color }} /></div>
      <span className="hbar-val">{rs(r.v)} · {r.n}</span></div>
  ))}</>;
}

export default function StatsView() {
  const { orders } = useOrderManager();
  const { range, setRange, toast } = useOc();
  const mobile = useIsMobile();
  const [riders, setRiders] = useState<RiderRow[]>([]);
  const [shiftOpen, setShiftOpen] = useState(false);
  useEffect(() => { fetchRiders().then((r) => { if (r.success && r.riders) setRiders(r.riders as RiderRow[]); }); }, []);

  const rows = orders.filter((o) => inRange(o, range));
  const live = rows.filter((o) => o.status !== "cancelled");
  const cancelled = rows.filter((o) => o.status === "cancelled");
  const revenue = live.reduce((s, o) => s + Number(o.total), 0);
  const avg = live.length ? Math.round(revenue / live.length) : 0;
  const dayCount = new Set(live.map(dayKeyIST)).size;
  const agg: Record<string, number> = {};
  live.forEach((o) => itemsOf(o).forEach((i) => { agg[i.item_name] = (agg[i.item_name] || 0) + Number(i.quantity || 0); }));
  const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const riderRows = riders.map((r) => {
    const rr = rows.filter((o) => o.rider_id === r.id);
    const cash = rr.filter((o) => o.is_collected).reduce((s, o) => s + Number(o.collected_amount || o.total), 0);
    const pend = rr.filter((o) => !o.is_collected && o.status !== "cancelled").reduce((s, o) => s + Number(o.total), 0);
    return { r, n: rr.length, cash, pend };
  });

  const exportCsv = () => {
    const header = ["Order Number", "Type", "Source", "Status", "Total", "Created At (IST)"];
    const body = live.map((o) => [o.order_number, channelOf(o), o.source, o.status, o.total, ist(o.created_at)]);
    const csv = [header, ...body].map((r) => r.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "rasoi-orders-" + range.range + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const shiftClose = (dateStr: string) => {
    const day = orders.filter((o) => dayKeyIST(o) === dateStr);
    const dl = day.filter((o) => o.status !== "cancelled");
    const rev = dl.reduce((s, o) => s + Number(o.total), 0);
    const chans = (["dine-in", "delivery", "takeaway"] as const).map((k) => ({ l: k === "dine-in" ? "Dine-in" : k[0].toUpperCase() + k.slice(1), n: dl.filter((o) => channelOf(o) === k).length, v: dl.filter((o) => channelOf(o) === k).reduce((s, o) => s + Number(o.total), 0) }));
    const cash = dl.filter((o) => o.is_collected).reduce((s, o) => s + Number(o.collected_amount || o.total), 0);
    const pend = dl.filter((o) => !o.is_collected).reduce((s, o) => s + Number(o.total), 0);
    const a: Record<string, number> = {};
    dl.forEach((o) => itemsOf(o).forEach((i) => { a[i.item_name] = (a[i.item_name] || 0) + Number(i.quantity || 0); }));
    const tops = Object.entries(a).sort((x, y) => y[1] - x[1]).slice(0, 10);
    const lbl = new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", weekday: "long" });
    const w = window.open("", "_blank", "width=420,height=720");
    if (!w) return;
    w.document.write(`<html><head><title>Shift Close - ${esc(dateStr)}</title><style>
      @page{size:80mm auto;margin:0}
      body{font-family:monospace;padding:3mm 4mm;font-size:13px;width:72mm;max-width:72mm;margin:0 auto}
      h2{text-align:center;margin:0 0 2px}.c{text-align:center}hr{border:0;border-top:1px dashed #999;margin:10px 0}
      .r{display:flex;justify-content:space-between}.t{font-weight:bold;font-size:15px}
      table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:3px 0;text-align:left}td:last-child,th:last-child{text-align:right}</style></head><body>
      <h2>RASOI</h2><div class="c">Shift Close / End-of-Day Report</div><div class="c">${esc(lbl)}</div><hr>
      <div class="r t"><span>Revenue</span><span>${rs(rev)}</span></div>
      <div class="r"><span>Orders</span><span>${dl.length}</span></div>
      <div class="r"><span>Avg Order</span><span>${rs(dl.length ? Math.round(rev / dl.length) : 0)}</span></div>
      <div class="r"><span>Cancelled / Declined</span><span>${day.length - dl.length}</span></div>
      <hr><b>By Channel</b><table><tr><th>Channel</th><th>Orders</th><th>Revenue</th></tr>
      ${chans.map((c) => `<tr><td>${c.l}</td><td>${c.n}</td><td>${rs(c.v)}</td></tr>`).join("")}</table>
      <hr><b>Cash</b><div class="r"><span>Collected</span><span>${rs(cash)}</span></div><div class="r"><span>Pending</span><span>${rs(pend)}</span></div>
      <hr><b>Top items</b><table><tr><th>Item</th><th>Qty</th></tr>
      ${tops.length ? tops.map(([n, q]) => `<tr><td>${esc(n)}</td><td>${q}</td></tr>`).join("") : '<tr><td colspan="2">No structured items</td></tr>'}</table>
      <hr><div class="c">Generated ${esc(ist(new Date()))}</div></body></html>`);
    w.document.close(); w.focus(); w.print();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}><RangeChips range={range.range} from={range.from} to={range.to} onChange={setRange} /></div>
        <button className="btn sm ghost" onClick={() => setShiftOpen(true)}>📋 Shift Close Report</button>
      </div>
      <div className="ov-card">
        <h4>Overview</h4>
        <div className="ov-pills">
          <div className="ovpill teal"><b>{rs(revenue)}</b><span>Revenue</span></div>
          <div className="ovpill blue"><b>{live.length}</b><span>Orders</span></div>
          <div className="ovpill orange"><b>{rs(avg)}</b><span>Avg Order</span></div>
        </div>
      </div>
      <div className="agrid">
        <div className="anacard"><h4>Order Types</h4><Pie live={live} /></div>
        <div className="anacard"><h4>Most Ordered Items</h4>
          <table><thead><tr><th>Item</th><th>Times Ordered</th></tr></thead><tbody>
            {top.length ? top.map(([n, q]) => <tr key={n}><td><b>{n}</b></td><td><span className="countchip">{q}</span></td></tr>) : <tr><td colSpan={2} className="none">No structured items in this range</td></tr>}
          </tbody></table>
        </div>
        <div className="anacard"><h4>Sales by Day<span style={{ display: "flex", alignItems: "center", gap: 8 }}><span className="daypill">{dayCount} DAY{dayCount === 1 ? "" : "S"}</span><button className="expbtn" onClick={exportCsv}>Export</button></span></h4><SalesByDay live={live} /></div>
      </div>
      <div className="anacard" style={{ marginBottom: 14 }}>
        <h4>Hourly Order Heatmap</h4>
        <p className="asub">Number of orders placed by hour of day, this range</p>
        <Heatmap live={live} />
      </div>
      <div className="anacard" style={{ marginBottom: 14 }}>
        <h4>Cancelled Orders <span className="countpill">{cancelled.length} Cancelled</span></h4>
        {mobile ? (cancelled.length ? cancelled.slice(0, 30).map((o) => (
          <div key={o.id} className="arow"><div className="at"><b>{o.order_number}</b><span>{rs(o.total)}</span></div>
            <div className="as">{o.items || "—"}</div><div className="as">{cancelReason(o)} · {o.cancelled_by || "Staff"}</div></div>
        )) : <div className="none">No cancelled orders in this period</div>) : (
          <table><thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Reason</th><th>By</th></tr></thead><tbody>
            {cancelled.length ? cancelled.slice(0, 30).map((o) => (
              <tr key={o.id}><td><b>{o.order_number}</b></td><td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items || "—"}</td>
                <td>{rs(o.total)}</td><td>{cancelReason(o)}</td><td>{o.cancelled_by || "Staff"}</td></tr>
            )) : <tr><td colSpan={5} className="none">No cancelled orders in this period</td></tr>}
          </tbody></table>
        )}
      </div>
      <div className="anacard" style={{ marginBottom: 14 }}><h4>Where Orders Came From</h4><Channels live={live} /></div>
      <div className="anacard">
        <h4>Riders</h4>
        {mobile ? (riderRows.length ? riderRows.map(({ r, n, cash, pend }) => (
          <div key={r.id} className="arow"><div className="at"><b>{r.name}</b><span>{n} deliver{n === 1 ? "y" : "ies"}</span></div>
            <div className="as">Collected {rs(cash)}{pend ? <> · Pending <b style={{ color: "var(--red)" }}>{rs(pend)}</b></> : null}</div></div>
        )) : <div className="none">No riders added yet</div>) : (
          <table><thead><tr><th>Rider</th><th>Deliveries</th><th>Cash collected</th><th>Pending</th></tr></thead><tbody>
            {riderRows.length ? riderRows.map(({ r, n, cash, pend }) => (
              <tr key={r.id}><td><b>{r.name}</b></td><td>{n}</td><td>{rs(cash)}</td><td>{pend ? <b style={{ color: "var(--red)" }}>{rs(pend)}</b> : "—"}</td></tr>
            )) : <tr><td colSpan={4} className="none">No riders added yet</td></tr>}
          </tbody></table>
        )}
      </div>
      {shiftOpen ? <ShiftModal onClose={() => setShiftOpen(false)} onGo={(d) => { setShiftOpen(false); if (!d) { toast("Pick a date"); return; } shiftClose(d); }} /> : null}
    </div>
  );
}

function ShiftModal({ onClose, onGo }: { onClose: () => void; onGo: (d: string) => void }) {
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const [d, setD] = useState(today);
  return (
    <div className="modal"><div className="mcard">
      <h3>Shift Close / End-of-Day Report</h3>
      <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", display: "block", margin: "10px 0 4px" }}>Date</label>
      <input className="f2" type="date" max={today} value={d} onChange={(e) => setD(e.target.value)} />
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={() => onGo(d)}>Generate &amp; Print</button></div>
    </div></div>
  );
}
