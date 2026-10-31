"use client";

/* Oceana POS: sticky category rail, search, ⭐ Popular shelf, 8-per-category
   grid and the cart box. Also handles Rasoi's ?edit=<id>, ?append=<id>&table=
   and ?table= entry points from Orders and Tables. */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useOrderManager } from "../../OrderManagerProvider";
import { useOc } from "../../DashShell";
import { FALLBACK_IMG, useMenu, type MenuItem } from "../../oc-data";
import { cleanNum, rs } from "../../oc-utils";
import { printOrderBill } from "@/lib/print/bill";
import { createClient } from "@/lib/supabase/client";
import { createPosOrder, updatePosOrder } from "./actions";
import { useTables } from "../../oc-data";

const PER_CAT = 8;
type PType = "takeaway" | "delivery" | "dine-in";
type Line = { key: string; item: MenuItem; name: string; variant: string | null; price: number; qty: number };
type Form = { ph: string; nm: string; adr: string; pin: string; tbl: string };

export default function PosView() {
  const router = useRouter();
  const { menu } = useMenu(true);
  const { orders, autoPrint, refreshOrders } = useOrderManager();
  const { toast } = useOc();
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [type, setType] = useState<PType>("takeaway");
  const [cart, setCart] = useState<Line[]>([]);
  const [form, setForm] = useState<Form>({ ph: "", nm: "", adr: "", pin: "", tbl: "" });
  const [err, setErr] = useState<keyof Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [variantFor, setVariantFor] = useState<MenuItem | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<{ edit?: string; append?: string; lockedTable?: string }>({});
  const tables = (useTables().list || []).map((t) => t.table_number);

  // Entry points: ?edit=<order id>, ?append=<order id>&table=<n>, ?table=<n>
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const edit = p.get("edit") || undefined;
    const append = p.get("append") || undefined;
    const table = p.get("table") || undefined;
    if (!edit && !append && !table) return;
    setMode({ edit, append, lockedTable: table && !edit ? table : undefined });
    if (table && !edit) { setType("dine-in"); setForm((f) => ({ ...f, tbl: table })); }
    if (!edit && !append) return;
    createClient().from("orders").select("*").eq("id", (edit || append)!).single().then(({ data }) => {
      const o = data as Record<string, unknown> | null;
      if (!o) return;
      const dine = o.order_type === "dine-in" || Boolean(String(o.table_number || "").trim());
      setType(dine ? "dine-in" : (o.order_type as PType) === "delivery" ? "delivery" : "takeaway");
      setForm({ ph: String(o.customer_phone || ""), nm: String(o.customer_name || ""), adr: String(o.address || ""), pin: String(o.pincode || ""), tbl: String(o.table_number || "") });
      if (dine && o.table_number) setMode((m) => ({ ...m, lockedTable: String(o.table_number) }));
      if (edit && Array.isArray(o.items_json)) {
        setCart((o.items_json as Array<Record<string, unknown>>).map((i) => ({
          key: `${i.menu_item_id}-${i.variant_name || ""}`,
          item: { id: String(i.menu_item_id), item_number: 0, item_name: String(i.item_name), category: "", price: Number(i.unit_price), available: true, description: null, image_url: null, variants: null },
          name: String(i.item_name), variant: (i.variant_name as string) || null, price: Number(i.unit_price), qty: Number(i.quantity) || 1,
        })));
      }
    });
  }, []);

  const cats = useMemo(() => [...new Set(menu.map((m) => m.category))], [menu]);
  const count = cart.reduce((s, c) => s + c.qty, 0);
  const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const qtyOf = (id: string) => cart.filter((c) => c.item.id === id).reduce((s, c) => s + c.qty, 0);

  /* Most-sold dishes over the last 30 days (falls back to all loaded orders). */
  const popular = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    const rank = (recentOnly: boolean) => {
      const agg: Record<string, number> = {};
      orders.filter((o) => o.status !== "cancelled" && (!recentOnly || new Date(o.created_at).getTime() >= cutoff)).forEach((o) => {
        (Array.isArray(o.items_json) ? o.items_json : []).forEach((i) => {
          if (i.menu_item_id) agg[i.menu_item_id] = (agg[i.menu_item_id] || 0) + Number(i.quantity || 0);
        });
      });
      return Object.entries(agg).sort((a, b) => b[1] - a[1]);
    };
    let ranked = rank(true);
    if (ranked.length < 6) ranked = rank(false);
    return ranked.map(([id]) => menu.find((m) => m.id === id)).filter(Boolean).slice(0, 10) as MenuItem[];
  }, [orders, menu]);

  const add = (m: MenuItem, variant: string | null = null) => {
    if (!m.available) { toast(m.item_name + " is marked unavailable"); return; }
    const key = `${m.id}-${variant || ""}`;
    setCart((c) => {
      const ex = c.find((l) => l.key === key);
      if (ex) return c.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key, item: m, name: variant ? `${m.item_name} (${variant})` : m.item_name, variant, price: Number(m.price), qty: 1 }];
    });
  };
  const tap = (m: MenuItem) => {
    const opts = m.variants?.options || [];
    if (opts.length) {
      const init: Record<string, string> = {};
      opts.forEach((o) => { if (o.values[0]) init[o.label] = o.values[0]; });
      setPicks(init);
      setVariantFor(m);
    } else add(m);
  };
  const step = (key: string, d: number) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm({ ...form, [k]: e.target.value }); if (err === k) setErr(null); };
  const fieldError = (k: keyof Form, msg: string) => { setErr(k); toast(msg); };

  const submit = async () => {
    const phone = cleanNum(form.ph);
    if (!mode.append && phone.length < 10) return fieldError("ph", "Enter a valid WhatsApp number");
    if (type === "delivery" && !form.adr.trim()) return fieldError("adr", "Delivery needs an address");
    if (type === "dine-in" && !form.tbl.trim()) return fieldError("tbl", "Dine-in needs a table number");
    setBusy(true);
    const items = cart.map((c) => ({ menu_item_id: c.item.id, item_name: c.name, quantity: c.qty, unit_price: c.price, variant_name: c.variant }));
    try {
      if (mode.append) {
        const res = await fetch("/api/orders/append", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: mode.append, table_number: form.tbl.trim(), new_items: items }),
        });
        const j = await res.json();
        if (!j.success) throw new Error(j.error || "failed");
        const billNotice = typeof j.billSent === "boolean"
          ? j.billSent ? " · WhatsApp bill sent" : ` · WhatsApp bill not sent${j.billError ? `: ${j.billError}` : ""}`
          : "";
        toast("Round added to table " + form.tbl.trim() + billNotice);
        void refreshOrders();
        router.push("/dashboard/tables");
        return;
      }
      const payload = {
        customer_name: form.nm.trim() || "Walk-in",
        customer_phone: phone,
        order_type: type,
        table_number: type === "dine-in" ? form.tbl.trim() : "",
        address: type === "delivery" ? form.adr.trim() : "",
        landmark: "",
        pincode: type === "delivery" ? form.pin.trim() : "",
        total,
        items_summary: cart.map((c) => `${c.name} x ${c.qty}`).join(", "),
        items_json: items,
      };
      if (mode.edit) {
        const r = await updatePosOrder(mode.edit, payload);
        if (!r.success) throw new Error(r.error || "failed");
        const billNotice = typeof r.billSent === "boolean"
          ? r.billSent ? " · WhatsApp bill sent" : ` · WhatsApp bill not sent${r.billError ? `: ${r.billError}` : ""}`
          : "";
        toast("Order updated · " + rs(total) + billNotice);
      } else {
        const r = await createPosOrder(payload);
        if (!r.success) throw new Error(r.error || "failed");
        const billNotice = r.billSent
          ? " · WhatsApp bill sent"
          : ` · WhatsApp bill not sent${r.billError ? `: ${r.billError}` : ""}`;
        toast((r.order?.order_number || "Order") + " sent to the kitchen" + billNotice);
        if (autoPrint && r.order?.id) printOrderBill(r.order.id, { auto: true }).catch(() => {});
      }
      setCart([]); setForm({ ph: "", nm: "", adr: "", pin: "", tbl: "" }); setQ(""); setCat("All");
      void refreshOrders();
      router.push(mode.lockedTable ? "/dashboard/tables" : "/dashboard/orders");
    } catch (e) {
      toast("Could not create the order — " + (e instanceof Error ? e.message : "try again"));
    } finally {
      setBusy(false);
    }
  };

  const pcard = (m: MenuItem) => {
    const n = qtyOf(m.id);
    const thr = m.low_stock_threshold ?? 5;
    const warn = m.track_stock ? (Number(m.stock_qty) <= 0 ? "out" : Number(m.stock_qty) <= thr ? "low" : "") : "";
    return (
      <button key={m.id} className={`pitem ${m.available ? "" : "off"}`} onClick={() => tap(m)}>
        {n ? <span className="qb">{n}</span> : null}
        {warn ? <span className={`pstock ${warn}`}>{warn === "out" ? "Out" : m.stock_qty + " left"}</span> : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="pthumb" src={m.image_url || FALLBACK_IMG} alt="" loading="lazy"
          onError={(e) => { const i = e.currentTarget; i.onerror = null; i.src = FALLBACK_IMG; i.style.opacity = ".5"; }} />
        <span className="pbody"><em>#{m.item_number}</em><b>{m.item_name}</b><i>{rs(m.price)}</i></span>
      </button>
    );
  };

  const query = q.toLowerCase().trim();
  let body: React.ReactNode;
  if (query) {
    const hits = menu.filter((m) => m.item_name.toLowerCase().includes(query) || String(m.item_number) === query || m.category.toLowerCase().includes(query));
    body = hits.length ? (
      <div className="csec"><h4>{hits.length} result{hits.length > 1 ? "s" : ""}</h4><div className="pgrid">{hits.slice(0, 60).map(pcard)}</div></div>
    ) : <div className="none">Nothing matched that</div>;
  } else if (cat === "All") {
    body = (
      <>
        {popular.length ? (
          <div className="csec popular"><h4>⭐ Popular — fastest to tap for a walk-in</h4><div className="pgrid">{popular.map(pcard)}</div></div>
        ) : null}
        {cats.map((c) => {
          const rows = menu.filter((m) => m.category === c);
          return (
            <div key={c} className="csec">
              <h4>{c}{rows.length > PER_CAT ? <button onClick={() => { setCat(c); window.scrollTo({ top: 0, behavior: "smooth" }); }}>All {rows.length} →</button> : null}</h4>
              <div className="pgrid">{rows.slice(0, PER_CAT).map(pcard)}</div>
            </div>
          );
        })}
      </>
    );
  } else {
    const rows = menu.filter((m) => m.category === cat);
    body = (
      <div className="csec"><h4>{cat} · {rows.length} items<button onClick={() => setCat("All")}>← All categories</button></h4><div className="pgrid">{rows.map(pcard)}</div></div>
    );
  }

  const heading = mode.append ? `➕ Round · Table ${form.tbl}` : mode.edit ? "✏️ Editing order" : "🛒 Current order";
  const cta = mode.append ? "Add round" : mode.edit ? "Save changes" : type === "dine-in" ? "Send to kitchen" : "Place order";

  return (
    <div className="pos">
      <div className="catrail">
        <button aria-pressed={cat === "All"} onClick={() => { setCat("All"); setQ(""); }}><span className="cn">All dishes</span><span className="ct">{menu.length}</span></button>
        {cats.map((c) => (
          <button key={c} aria-pressed={cat === c} onClick={() => { setCat(c); setQ(""); }}>
            <span className="cn">{c}</span><span className="ct">{menu.filter((m) => m.category === c).length}</span>
          </button>
        ))}
      </div>

      <div className="panel">
        <div className="psearch">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input placeholder="Search dish or item number…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {body}
      </div>

      <div className={`cartbox ${open ? "open" : ""} ${cart.length ? "hasitems" : ""}`}>
        <div className="ch" onClick={(e) => { if ((e.target as HTMLElement).tagName !== "BUTTON" && window.innerWidth <= 1100) setOpen(!open); }}>
          <span>{heading}{cart.length ? ` · ${count} · ${rs(total)}` : ""}</span>
          {cart.length ? <button onClick={() => setCart([])}>Clear</button> : null}
        </div>
        {!mode.append && !mode.lockedTable ? (
          <div className="panel" style={{ border: 0, borderBottom: "1px solid var(--line)", borderRadius: 0, marginBottom: 0, padding: "14px 16px 16px" }}>
            <div className="seg3">
              {([["takeaway", "🏪", "Takeaway"], ["delivery", "🛵", "Delivery"], ["dine-in", "🍽️", "Dine-in"]] as const).map(([k, ic, l]) => (
                <button key={k} aria-pressed={type === k} onClick={() => setType(k)}><span>{ic}</span>{l}</button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="clines">
          {cart.length ? cart.map((c) => (
            <div key={c.key} className="cline">
              <div className="nm">{c.name}<small>{rs(c.price)} each</small></div>
              <div className="stp"><button onClick={() => step(c.key, -1)}>−</button><b>{c.qty}</b><button onClick={() => step(c.key, 1)}>+</button></div>
            </div>
          )) : <div className="cartempty">Tap a dish to start the order</div>}
        </div>
        <div className="cfoot">
          {!mode.append ? (
            <>
              <input className={`f2${err === "ph" ? " ferr" : ""}`} placeholder="WhatsApp number *" inputMode="numeric" value={form.ph} onChange={set("ph")} />
              <input className="f2" placeholder="Customer name" value={form.nm} onChange={set("nm")} />
            </>
          ) : null}
          {type === "delivery" && !mode.append ? (
            <>
              <input className={`f2${err === "adr" ? " ferr" : ""}`} placeholder="Delivery address *" value={form.adr} onChange={set("adr")} />
              <input className="f2" placeholder="Pincode" inputMode="numeric" value={form.pin} onChange={set("pin")} />
            </>
          ) : null}
          {type === "dine-in" && !mode.lockedTable ? (
            <>
              <input className={`f2${err === "tbl" ? " ferr" : ""}`} placeholder="Table number *" list="pos-tables" value={form.tbl} onChange={set("tbl")} />
              <datalist id="pos-tables">{tables.map((t) => <option key={t} value={t} />)}</datalist>
            </>
          ) : null}
          <div className="ctot"><span>Total</span><span>{rs(total)}</span></div>
          <button className="cta" disabled={!cart.length || busy} onClick={() => void submit()}>{busy ? "Sending…" : cta + " 🚀"}</button>
        </div>
      </div>

      {variantFor ? (
        <div className="modal">
          <div className="mcard">
            <h3>{variantFor.item_name}</h3>
            {(variantFor.variants?.options || []).map((o) => (
              <div key={o.label}>
                <div className="aq" style={{ marginTop: 4 }}>{o.label}</div>
                <div className="prep" style={{ marginBottom: 10 }}>
                  {o.values.map((v) => <button key={v} aria-pressed={picks[o.label] === v} onClick={() => setPicks({ ...picks, [o.label]: v })}>{v}</button>)}
                </div>
              </div>
            ))}
            <div className="mrow">
              <button onClick={() => setVariantFor(null)}>Cancel</button>
              <button className="go" onClick={() => {
                const name = (variantFor.variants?.options || []).map((o) => picks[o.label]).filter(Boolean).join(", ");
                add(variantFor, name || null);
                setVariantFor(null);
              }}>Add · {rs(variantFor.price)}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
