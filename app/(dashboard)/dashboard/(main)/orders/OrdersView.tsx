"use client";

/* Oceana Orders board: Dine-in rail + Preparing / READY / DONE columns,
   declined & cancelled drawer, and a card list on phone widths. */
import { useEffect, useState } from "react";
import { Globe, MessageCircle, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import type { DashboardOrder, OrderStatus } from "@/lib/orders/queries";
import { useOrderManager } from "../../OrderManagerProvider";
import { useStaff } from "@/components/providers/StaffProvider";
import { printOrderBill } from "@/lib/print/bill";
import { useOc } from "../../DashShell";
import { PasscodeModal, RiderPicker, Slide, type Rider } from "../../OcKit";
import { RANGE_CHIPS, ageOf, channelOf, fmtMins, inRange, ist, lineItemsOf, rs, useIsMobile } from "../../oc-utils";
import { collectCash, markUnpaidOrderPaid } from "./actions";

const READY: OrderStatus[] = ["ready_for_pickup", "out_for_delivery"];
// Rasoi closes a dine-in table (and sends the final bill) on "delivered", so a
// served round is "ready_for_pickup" instead.
const DINE_ACTIVE: OrderStatus[] = ["new", "preparing", "ready_for_pickup"];
type Col = { key: "preparing" | "READY" | "delivered"; label: string; cls: string; slide: string | null; next: string | null; color: string };
const COLS: Col[] = [
  { key: "preparing", label: "Preparing", cls: "preparing", slide: "Slide to ready / out", next: "READY", color: "#1A5FA8" },
  { key: "READY", label: "READY", cls: "ready", slide: "Slide to done", next: "delivered", color: "#5B3FBF" },
  { key: "delivered", label: "DONE", cls: "delivered", slide: null, next: null, color: "#1F8A4C" },
];
const DECLINE_REASONS = ["Item unavailable", "Kitchen full", "Outside delivery area", "Closing soon"];

type SourceKey = "whatsapp" | "online" | "pos" | "other";
const sourceKeyOf = (source: string | null | undefined): SourceKey | null => {
  const value = String(source || "").trim().toLowerCase();
  if (!value) return null;
  if (value.includes("whatsapp") || value === "wa") return "whatsapp";
  if (["pwa", "web", "website", "online", "guest"].includes(value)) return "online";
  if (value === "pos" || value.includes("point of sale")) return "pos";
  return "other";
};
const sourceClassOf = (source: string | null | undefined) => {
  const key = sourceKeyOf(source);
  return key ? `source-${key}` : "";
};

function SourceTag({ source }: { source: string | null | undefined }) {
  const key = sourceKeyOf(source);
  if (!key) return null;
  const label = key === "whatsapp" ? "WhatsApp" : key === "online" ? "Online" : key === "pos" ? "POS" : source;
  return (
    <span className={`tag src src-${key}`}>
      {key === "whatsapp" ? <MessageCircle aria-hidden="true" size={12} strokeWidth={2.5} /> : null}
      {key === "online" ? <Globe aria-hidden="true" size={12} strokeWidth={2.5} /> : null}
      {key === "pos" ? <Store aria-hidden="true" size={12} strokeWidth={2.5} /> : null}
      {label}
    </span>
  );
}

function OrderTypeTag({ channel, tableNumber }: { channel: ReturnType<typeof channelOf>; tableNumber?: string | number | null }) {
  const cls = channel === "delivery" ? "dl" : channel === "dine-in" ? "din" : "tk";
  const label = channel === "dine-in" ? "Dine-in" : channel === "delivery" ? "Delivery" : "Takeaway";
  return <span className={`tag ${cls}`}>{label}{tableNumber ? ` · T${tableNumber}` : ""}</span>;
}

const isDine = (o: DashboardOrder) => channelOf(o) === "dine-in";
/** Rider tapped "Unpaid": delivered, but the customer still owes the shop. */
const isUnpaid = (o: DashboardOrder) => o.order_type === "delivery" && o.status === "delivered" && o.payment_status === "unpaid";
const canEditOrder = (o: DashboardOrder) => o.source === "pos" && ["new", "preparing"].includes(o.status);
const cancelReasonText = (o: DashboardOrder) => {
  const raw = String(o.cancel_reason || "");
  return raw.includes("|") ? raw.split("|").slice(1).join("|") : raw;
};

function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

function AgeTag({ o }: { o: DashboardOrder }) {
  if (o.status === "cancelled") return null;
  if (o.status === "delivered") {
    const took = Math.max(0, Math.floor((new Date(o.updated_at || o.created_at).getTime() - new Date(o.created_at).getTime()) / 60000));
    return <span className="runclock done">✓ {fmtMins(took)}</span>;
  }
  const m = ageOf(o);
  return <span className={`age ${m >= 30 ? "bad" : m >= 15 ? "warn" : ""}`}>⏱ {fmtMins(m)}</span>;
}

function Lines({ o }: { o: DashboardOrder }) {
  return (
    <>
      {lineItemsOf(o).map((l, i) => (
        <div key={i}>
          <div className={`li${l.isNew ? " newr" : ""}`}>
            <span>{l.quantity ? `${l.name} ×${l.quantity}` : l.name}{l.isNew ? <span className="newtag">ROUND {l.round}</span> : null}</span>
            <span>{l.lineTotal ? rs(l.lineTotal) : ""}</span>
          </div>
          {l.notes ? <div className="linote">📝 {l.notes}</div> : null}
        </div>
      ))}
    </>
  );
}

export default function OrdersView() {
  const router = useRouter();
  const { orders, updateOrderStatus, refreshOrders, acknowledgeOrder } = useOrderManager();
  const { hasPerm } = useStaff();
  const { range, setRange, toast } = useOc();
  const mobile = useIsMobile();
  const [drawer, setDrawer] = useState(false);
  const [riderFor, setRiderFor] = useState<{ order: DashboardOrder; advance: boolean } | null>(null);
  const [restoreFor, setRestoreFor] = useState<DashboardOrder | null>(null);
  const [declineFor, setDeclineFor] = useState<DashboardOrder | null>(null);
  const [mtab, setMtab] = useState<"" | "new" | "preparing" | "ready" | "delivered">("");
  useTick(20000);

  const setStatus = async (o: DashboardOrder, next: OrderStatus, reason?: string, rider?: Rider) => {
    try {
      await updateOrderStatus(o, next, reason, rider);
      toast(o.order_number + " → " + next.replace(/_/g, " "));
      return true;
    } catch {
      toast("Could not update " + o.order_number);
      return false;
    }
  };
  const slideNext = (o: DashboardOrder, col: Col) => {
    if (col.next === "READY") {
      if (o.order_type === "delivery") { setRiderFor({ order: o, advance: true }); return; }
      return setStatus(o, "ready_for_pickup");
    }
    return setStatus(o, col.next as OrderStatus);
  };
  const pickRider = async (r: Rider | null) => {
    const job = riderFor;
    setRiderFor(null);
    if (!job) return;
    const o = job.order;
    if (job.advance) { await setStatus(o, "out_for_delivery", undefined, r || undefined); return; }
    if (!r) return;
    try {
      await updateOrderStatus(o, o.status, undefined, r);
      toast("Assigned to " + r.name);
    } catch { toast("Could not assign a rider"); }
  };
  const cash = async (o: DashboardOrder) => {
    const res = await collectCash(o.id, Number(o.total), Number(o.total), o.rider_id || undefined);
    if (!res.success) { toast("Could not record cash"); return; }
    toast(rs(o.total) + " recorded for " + o.order_number);
    void refreshOrders();
  };
  const markPaid = async (o: DashboardOrder) => {
    const res = await markUnpaidOrderPaid(o.id);
    if (!res.success) { toast("Could not mark paid"); return; }
    toast(o.order_number + " marked paid");
    void refreshOrders();
  };
  const restore = async (pin: string) => {
    const o = restoreFor;
    if (!o) return null;
    const prev = String(o.cancel_reason || "").split("|")[0] as OrderStatus;
    const target: OrderStatus = ["new", "preparing", "ready_for_pickup", "out_for_delivery"].includes(prev) ? prev : "new";
    try {
      await updateOrderStatus(o, target, "Undo Cancel", undefined, { pin });
      setRestoreFor(null);
      toast(o.order_number + " restored");
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Incorrect passcode";
    }
  };
  const accept = async (o: DashboardOrder) => {
    try {
      await updateOrderStatus(o, "preparing", undefined, undefined, { prepTime: 20 });
      acknowledgeOrder(o.id);
      toast(o.order_number + " accepted · ready in 20 min");
    } catch { toast("Could not accept " + o.order_number); }
  };
  const decline = async (o: DashboardOrder, reason: string) => {
    setDeclineFor(null);
    try {
      await updateOrderStatus(o, "cancelled", reason);
      acknowledgeOrder(o.id);
      toast(o.order_number + " declined · " + reason);
    } catch { toast("Could not decline " + o.order_number); }
  };
  const edit = (o: DashboardOrder) => router.push(`/dashboard/pos?edit=${o.id}`);

  const rows = orders.filter((o) => inRange(o, range));
  const live = rows;
  const cancelled = live.filter((o) => o.status === "cancelled");
  const counted = live.filter((o) => o.status !== "cancelled");
  const rev = counted.reduce((s, o) => s + Number(o.total), 0);

  const mini = (o: DashboardOrder, col: Col | null) => (
    <div className="mini">
      {["ready_for_pickup", "out_for_delivery", "delivered"].includes(o.status) && o.order_type === "delivery" && !o.rider_id && hasPerm("assign_rider") ? (
        <button onClick={() => setRiderFor({ order: o, advance: false })}>Assign rider</button>
      ) : null}
      {["delivered", "ready_for_pickup"].includes(o.status) && hasPerm("collect_cash") ? (
        o.is_collected
          ? <button className="cashdone" disabled>✓ Cash {rs(o.collected_amount || o.total)}</button>
          : o.payment_status === "unpaid"
            ? <button className="cashbtn" onClick={() => void markPaid(o)}>💵 Mark paid {rs(o.total)}</button>
            : <button className="cashbtn" onClick={() => void cash(o)}>💵 Collect {rs(o.total)}</button>
      ) : null}
      {col?.key === "preparing" ? <button onClick={() => void setStatus(o, "ready_for_pickup")}>Ready for pickup</button> : null}
      {o.status !== "delivered" && o.status !== "cancelled" && hasPerm("cancel_order") ? (
        <button className="x" onClick={() => void setStatus(o, "cancelled", "staff_cancelled")}>Cancel</button>
      ) : null}
      {o.status === "cancelled" && hasPerm("reopen_cancelled") ? <button onClick={() => setRestoreFor(o)}>Restore</button> : null}
      {canEditOrder(o) ? <button onClick={() => edit(o)}>Edit</button> : null}
      <button onClick={() => void printOrderBill(o.id)}>Print</button>
    </div>
  );

  const card = (o: DashboardOrder, col: Col | null) => {
    const ch = channelOf(o);
    const amended = Number(o.amendment_count) > 0;
    return (
      <div key={o.id} className={`o ch-${ch} ${sourceClassOf(o.source)}`}>
        <div className="orow">
          <div>
            <div className="onum">{o.order_number}</div>
            <div className="osub">{o.customer_name || "Guest"} · {o.customer_phone}</div>
            <div className="osub">{ist(o.created_at)}</div>
          </div>
          <div className="oamt">{rs(o.total)}</div>
        </div>
        <div className="oitems"><Lines o={o} /></div>
        {o.address ? <div className="addr">📍 {o.address}{o.landmark ? ", " + o.landmark : ""}{o.pincode ? " — " + o.pincode : ""}</div> : null}
        <div className="tags">
          <span className={`tag ${ch === "delivery" ? "dl" : ch === "dine-in" ? "din" : "tk"}`}>{ch}{o.table_number ? " · T" + o.table_number : ""}</span>
          <SourceTag source={o.source} />
          {amended ? <span className="tag am">Amended ×{o.amendment_count}</span> : null}
          {isUnpaid(o) ? <span className="tag unpaid">⚠ Unpaid {rs(o.total)}</span> : null}
          <AgeTag o={o} />
        </div>
        {col?.slide ? <Slide label={col.slide} color={col.color} onDone={() => slideNext(o, col)} /> : null}
        {o.rider_name ? <div className="addr">🛵 {o.rider_name}</div> : null}
        {o.status === "cancelled" && cancelReasonText(o) ? <div className="money bad">✕ {cancelReasonText(o)}</div> : null}
        {READY.includes(o.status) && !o.is_collected ? (
          <div className="money due">💵 Collect {rs(o.total)} {ch === "delivery" ? "on delivery" : "at the counter"}</div>
        ) : null}
        {isUnpaid(o) ? <div className="money bad">⚠ Customer didn&apos;t pay the rider ({rs(o.total)})</div> : null}
        {o.is_collected && ch !== "dine-in" ? <div className="money">✓ {o.payment_status === "paid_later" ? "Paid to the shop" : rs(o.collected_amount || o.total) + " collected"}</div> : null}
        {mini(o, col)}
      </div>
    );
  };

  const dineCard = (o: DashboardOrder, done: boolean) => {
    const amended = Number(o.amendment_count) > 0;
    return (
      <div key={o.id} className={`o ch-dine-in ${sourceClassOf(o.source)}`}>
        <div className="orow">
          <div>
            <div className="onum">{o.order_number}</div>
            <div className="osub">Table {o.table_number || "?"}{o.customer_name ? " · " + o.customer_name : ""}</div>
            <div className="osub">{ist(o.created_at)}</div>
          </div>
          <div className="oamt">{rs(o.total)}</div>
        </div>
        <div className="oitems"><Lines o={o} /></div>
        <div className="tags">
          <span className="tag din">Table {o.table_number || "?"}</span>
          <SourceTag source={o.source} />
          {amended ? <span className="tag am">Amended ×{o.amendment_count}</span> : null}
          <AgeTag o={o} />
        </div>
        {done ? <div className="money">✓ Served</div> : <button className="donebtn" onClick={() => void setStatus(o, "ready_for_pickup")}>✓ Mark done</button>}
        <div className="mini">
          {canEditOrder(o) ? <button onClick={() => edit(o)}>Edit</button> : null}
          {!done && o.status !== "cancelled" && hasPerm("cancel_order") ? <button className="x" onClick={() => void setStatus(o, "cancelled", "staff_cancelled")}>Cancel</button> : null}
          <button onClick={() => void printOrderBill(o.id)}>Print</button>
        </div>
      </div>
    );
  };

  const unpaid = orders.filter(isUnpaid);
  const unpaidBar = unpaid.length ? (
    <div className="unpaidbar">
      <h4>⚠ {unpaid.length} delivered order{unpaid.length > 1 ? "s were" : " was"} not paid. Please follow up with the customer.</h4>
      {unpaid.map((o) => (
        <div key={o.id} className="ur">
          <b>{o.order_number}</b><span>{rs(o.total)}</span><span>{o.customer_name || "Customer"}</span>
          {o.customer_phone ? <a href={`tel:+${String(o.customer_phone).replace(/\D/g, "")}`}>📞 {o.customer_phone}</a> : null}
          {o.rider_name ? <span>rider: {o.rider_name}</span> : null}
          {hasPerm("collect_cash") ? <button className="cashbtn" style={{ padding: "5px 10px", borderRadius: 8, fontSize: 12 }} onClick={() => void markPaid(o)}>💵 Mark paid</button> : null}
        </div>
      ))}
    </div>
  ) : null;

  const modals = (
    <>
      {riderFor ? <RiderPicker orderNumber={riderFor.order.order_number} onPick={(r) => void pickRider(r)} onSkip={() => void pickRider(null)} /> : null}
      {restoreFor ? (
        <PasscodeModal title="Undo required"
          detail={`Moving ${restoreFor.order_number} from cancelled back to the board. Enter the passcode.`}
          onSubmit={restore} onCancel={() => setRestoreFor(null)} />
      ) : null}
      {declineFor ? (
        <div className="modal">
          <div className="mcard">
            <h3>Decline {declineFor.order_number}</h3>
            <div className="rlist">{DECLINE_REASONS.map((r) => <button key={r} onClick={() => void decline(declineFor, r)}>{r}</button>)}</div>
            <button className="btn ghost" onClick={() => setDeclineFor(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </>
  );

  if (mobile) {
    const active = live.filter((o) => o.status !== "cancelled");
    const groups = {
      new: active.filter((o) => o.status === "new"),
      preparing: active.filter((o) => o.status === "preparing"),
      ready: active.filter((o) => READY.includes(o.status)),
      delivered: active.filter((o) => o.status === "delivered"),
    };
    const tab = mtab || (groups.new.length ? "new" : "preparing");
    const list = groups[tab];
    const moActions = (o: DashboardOrder) => {
      if (o.status === "new") return (
        <>
          <button className="mobtn go" onClick={() => void accept(o)}>Accept</button>
          <button className="mobtn bad" onClick={() => setDeclineFor(o)}>Reject</button>
          <button className="mobtn" onClick={() => void printOrderBill(o.id)}>Print</button>
        </>
      );
      if (o.status === "preparing") return (
        <>
          {isDine(o)
            ? <button className="mobtn go" onClick={() => void setStatus(o, "ready_for_pickup")}>✓ Mark done</button>
            : <button className="mobtn go" onClick={() => o.order_type === "delivery" ? setRiderFor({ order: o, advance: true }) : void setStatus(o, "ready_for_pickup")}>Ready / dispatch</button>}
          {canEditOrder(o) ? <button className="mobtn" onClick={() => edit(o)}>Edit</button> : null}
        </>
      );
      if (READY.includes(o.status)) return (
        <>
          {!isDine(o) ? <button className="mobtn go" onClick={() => void setStatus(o, "delivered")}>Mark delivered</button> : null}
          {!o.is_collected && !isDine(o) && hasPerm("collect_cash") ? <button className="mobtn" onClick={() => void cash(o)}>💵 {rs(o.total)}</button> : null}
          <button className="mobtn" onClick={() => void printOrderBill(o.id)}>Print</button>
        </>
      );
      return <button className="mobtn" onClick={() => void printOrderBill(o.id)}>Print</button>;
    };
    return (
      <div>
        <div className="movrow">
          <div className="mostat rev"><span>Revenue</span><b>{rs(rev)}</b></div>
          <div className="mostat"><span>Orders</span><b>{active.length}</b></div>
        </div>
        {unpaidBar}
        <div className="mtabs">
          {([["new", "New"], ["preparing", "Preparing"], ["ready", "Ready / Out"], ["delivered", "Done"]] as const).map(([k, l]) => (
            <button key={k} className="mtab" aria-pressed={tab === k} onClick={() => setMtab(k)}>
              {l}{groups[k].length ? ` (${groups[k].length})` : ""}
            </button>
          ))}
        </div>
        <div className="molist">
          {list.length ? list.map((o) => (
            <div key={o.id} className={`mocard ${sourceClassOf(o.source)}`}>
              <div className="morow"><b>{o.order_number}</b><span>{ist(o.created_at)} · {fmtMins(ageOf(o))}</span></div>
              <div className="mosub">{isDine(o) ? "Table " + (o.table_number || "?") : o.customer_name || "Guest"}{o.customer_phone ? " · " + o.customer_phone : ""}</div>
              {o.address ? <div className="mosub">📍 {o.address}{o.landmark ? ", " + o.landmark : ""}</div> : null}
              <div className="motags"><OrderTypeTag channel={channelOf(o)} tableNumber={o.table_number} /><SourceTag source={o.source} /></div>
              <div className="moitems">{o.items}</div>
              {isUnpaid(o) ? <div className="money bad" style={{ marginBottom: 10 }}>⚠ Unpaid — customer didn&apos;t pay the rider</div> : null}
              <div className="moamt">{rs(o.total)}</div>
              <div className="moacts">{moActions(o)}</div>
            </div>
          )) : <div className="none">Nothing here</div>}
        </div>
        {modals}
      </div>
    );
  }

  const dine = live.filter((o) => isDine(o) && DINE_ACTIVE.includes(o.status));
  const dineDone = live.filter((o) => isDine(o) && o.status === "delivered");
  return (
    <div>
      <div className="filterrow">
        <span className="flabel">Filter:</span>
        <div className="chips">
          {RANGE_CHIPS.map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={range.range === k} onClick={() => setRange({ ...range, range: k })}>{l}</button>
          ))}
        </div>
      </div>
      <div className="stats">
        <div className="stat r"><span>Revenue</span><b>{rs(rev)}</b></div>
        <div className="stat b"><span>Total Orders</span><b>{counted.length}</b></div>
        <div className="stat o"><span>Awaiting Accept</span><b>{live.filter((o) => o.status === "new").length}</b></div>
        <div className="stat p"><span>In The Kitchen</span><b>{live.filter((o) => o.status === "preparing").length}</b></div>
        <div className="stat"><span>Cash To Collect</span><b>{rs(live.filter((o) => !o.is_collected && !isDine(o) && ["preparing", "ready_for_pickup", "out_for_delivery", "delivered"].includes(o.status)).reduce((a, o) => a + Number(o.total), 0))}</b></div>
      </div>
      {unpaidBar}
      <div className="board">
        <div className="col dinein">
          <div className="colbar"><span>🍽️ Dine-in</span><span className="cnt">{dine.length}</span></div>
          {dine.length ? dine.map((o) => dineCard(o, o.status === "ready_for_pickup")) : <div className="none">No active rounds</div>}
        </div>
        {COLS.map((c) => {
          const list = live.filter((o) => !isDine(o) && (c.key === "READY" ? READY.includes(o.status) : o.status === c.key));
          const showDine = c.key === "delivered" ? dineDone : [];
          const count = list.length + showDine.length;
          return (
            <div key={c.key} className={`col ${c.cls}`}>
              <div className="colbar"><span>{c.label}</span><span className="cnt">{count}</span></div>
              {count ? (
                <>
                  {showDine.map((o) => dineCard(o, true))}
                  {list.map((o) => card(o, c))}
                </>
              ) : <div className="none">Nothing here</div>}
            </div>
          );
        })}
      </div>
      <div className="drawer">
        <button onClick={() => setDrawer(!drawer)}>Declined &amp; cancelled <span>{cancelled.length} ▾</span></button>
        {drawer ? <div className="body">{cancelled.length ? cancelled.map((o) => card(o, null)) : <div className="none">None</div>}</div> : null}
      </div>
      {modals}
    </div>
  );
}
