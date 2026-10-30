"use client";

/* Oceana's acceptance popup: full-screen, can't be dismissed, prep-time chips,
   slide to accept or pick a reason and slide to decline. Also used to
   acknowledge a new round added to an open order. */
import { useEffect, useRef, useState } from "react";
import { useOrderManager } from "./OrderManagerProvider";
import { useOc } from "./DashShell";
import { Slide } from "./OcKit";
import { ist, lineItemsOf, rs } from "./oc-utils";

const REASONS = ["Item unavailable", "Kitchen full", "Outside delivery area", "Closing soon"];

export default function NewOrderAlert() {
  const { queuedNewOrders, acknowledgeOrder, updateOrderStatus } = useOrderManager();
  const { toast } = useOc();
  const [prep, setPrep] = useState(20);
  const [pane, setPane] = useState<"accept" | "decline">("accept");
  const [reason, setReason] = useState("");
  const o = queuedNewOrders[0];
  const notified = useRef(new Set<string>());
  const { orders } = useOrderManager();
  const unpaidSeen = useRef<Set<string> | null>(null);

  // A rider tapping "Unpaid" on WhatsApp shows up here as a toast (the Orders board keeps the banner).
  useEffect(() => {
    const unpaid = orders.filter((x) => x.order_type === "delivery" && x.status === "delivered" && x.payment_status === "unpaid");
    if (unpaidSeen.current === null) { unpaidSeen.current = new Set(unpaid.map((x) => x.id)); return; }
    unpaid.forEach((x) => {
      if (unpaidSeen.current!.has(x.id)) return;
      unpaidSeen.current!.add(x.id);
      toast(`⚠ ${x.order_number}: ${x.rider_name || "rider"} marked it unpaid (${rs(x.total)})`);
    });
  }, [orders, toast]);

  // Native notification as well as the in-page alarm (works before anyone taps the page).
  useEffect(() => {
    queuedNewOrders.forEach((q) => {
      if (notified.current.has(q.id)) return;
      notified.current.add(q.id);
      try {
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        const n = new Notification("🔔 New " + (q.order_type || "order") + " order", {
          body: (q.customer_name || "Guest") + " · " + rs(q.total) + (q.items ? " · " + q.items : ""),
          tag: "rasoi-" + q.order_number,
          requireInteraction: true,
        });
        n.onclick = () => { window.focus(); n.close(); };
      } catch { /* notifications unsupported */ }
    });
  }, [queuedNewOrders]);

  if (!o) return null;
  const isUpdate = o.status !== "new" && Array.isArray(o.items_json) && o.items_json.some((i) => (i as { is_new_addition?: boolean }).is_new_addition);
  // On a new round only the added lines matter; earlier rounds are already cooking.
  const allLines = lineItemsOf(o);
  const lines = isUpdate ? allLines.filter((l) => l.isNew) : allLines;
  const reset = () => { setPrep(20); setPane("accept"); setReason(""); };

  const accept = async () => {
    try {
      if (isUpdate) {
        const cleared = (o.items_json as Array<Record<string, unknown>>).map((i) => ({ ...i, is_new_addition: false, old_quantity: i.quantity }));
        const { updateOrderInDb } = await import("@/lib/orders/actions");
        await updateOrderInDb(o.id, { items_json: cleared });
        acknowledgeOrder(o.id, true);
        toast(o.order_number + " update acknowledged");
      } else {
        await updateOrderStatus(o, "preparing", undefined, undefined, { prepTime: prep });
        acknowledgeOrder(o.id);
        toast(o.order_number + " accepted · ready in " + prep + " min");
      }
      reset();
    } catch {
      toast("Could not accept " + o.order_number);
      return false;
    }
  };
  const decline = async () => {
    if (!reason) { toast("Pick a reason first"); return false; }
    try {
      await updateOrderStatus(o, "cancelled", reason);
      acknowledgeOrder(o.id);
      toast(o.order_number + " declined · " + reason);
      reset();
    } catch {
      toast("Could not decline " + o.order_number);
      return false;
    }
  };

  return (
    <div id="alert">
      <div className="acard">
        <div className="ahead">
          <b>🔔 {isUpdate ? "New round" : "New " + (o.order_type || "order") + " order"}</b>
          {queuedNewOrders.length > 1 ? <span className="queue">+{queuedNewOrders.length - 1} waiting</span> : null}
        </div>
        <div className="abody">
          <div className="aline"><span>{o.order_number}</span><span>{ist(o.created_at)}</span></div>
          <div className="aline"><span>{o.customer_name || "Guest"}</span><b>{o.customer_phone || ""}</b></div>
          {o.table_number ? <div className="aline"><span>Table</span><b>{o.table_number}</b></div> : null}
          {o.address ? <div className="aline"><span>📍</span><b style={{ textAlign: "right" }}>{o.address}{o.landmark ? ", " + o.landmark : ""}</b></div> : null}
          <div className="aitems">
            {lines.length ? lines.map((l, i) => (
              <div key={i}>
                <div className={`ai${l.isNew && !isUpdate ? " newr" : ""}`}>
                  <span><b>{l.quantity ? l.quantity + " ×" : ""}</b> {l.name}{l.isNew && !isUpdate ? <span className="newtag">ROUND {l.round}</span> : null}</span>
                  <span>{l.lineTotal ? rs(l.lineTotal) : ""}</span>
                </div>
                {l.notes ? <div className="linote">📝 {l.notes}</div> : null}
              </div>
            )) : "—"}
          </div>
          <div className="aline"><span>Payment</span><b>{o.order_type === "delivery" ? "Cash on delivery" : "Cash at counter"}</b></div>
          <div className="aline" style={{ alignItems: "flex-end" }}><span>Total</span><span className="atot">{rs(o.total)}</span></div>

          {isUpdate ? (
            <Slide key={"u" + o.id} big pulse label="Slide right to ACKNOWLEDGE →" color="#3AB757" onDone={accept} />
          ) : pane === "accept" ? (
            <>
              <div className="aq">Ready in</div>
              <div className="prep">
                {[10, 15, 20, 30, 45].map((m) => <button key={m} aria-pressed={m === prep} onClick={() => setPrep(m)}>{m} min</button>)}
              </div>
              <Slide key={"a" + o.id} big pulse label="Slide right to ACCEPT →" color="#3AB757" onDone={accept} />
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setPane("decline")}>Decline this order</button>
            </>
          ) : (
            <>
              <div className="aq">Why are you declining?</div>
              <div className="reason">
                {REASONS.map((r) => <button key={r} aria-pressed={r === reason} onClick={() => setReason(r)}>{r}</button>)}
              </div>
              <Slide key={"d" + o.id} big label={reason ? "Slide right to DECLINE →" : "Pick a reason first"} color="#6B7684" onDone={decline} />
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setPane("accept")}>← Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
