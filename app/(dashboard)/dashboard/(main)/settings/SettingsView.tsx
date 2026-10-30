"use client";

/* Oceana Settings (admin only): profile, GST, hours, order types, delivery,
   pincodes, payment, printing & security, AI, stock alerts, staff and
   WhatsApp usage. Saved through Rasoi's validated settings actions. */
import { useCallback, useEffect, useState } from "react";
import type { StaffRole } from "@/lib/auth/permissions";
import { useOc } from "../../DashShell";
import { db, FALLBACK_IMG } from "../../oc-data";
import { uploadMenuImage } from "../menu/actions";
import {
  addPincode, addStaff, changeUndoPasscode, fetchSettingsPageData, removePincode, removeStaff, resetStaffPassword, saveSettings, updateStaff,
} from "./actions";

type Staff = { email: string; name: string; role: StaffRole; is_active: boolean };
type Pin = { pincode: string; area: string | null; active: boolean };
const KEYS = ["restaurant_name", "tagline", "address", "phone", "city", "logo_url", "gst_percent", "gstin", "open_time", "close_time", "hours", "orders_paused",
  "min_order", "delivery_fee", "free_delivery_above", "delivery_note", "payment_methods", "auto_print", "unknown_policy", "google_review_url",
  "low_stock_threshold", "expiry_warn_days", "margin_alert_pct"] as const;
type Form = Record<(typeof KEYS)[number], string>;
const WA_FREE_QUOTA = 1000, WA_RATE = 0.1357;
const monthStartIST = () => { const IST = 5.5 * 3600000, now = new Date(Date.now() + IST); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - IST).toISOString(); };
const L = ({ t }: { t: string }) => <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{t}</label>;
const H = ({ t }: { t: string }) => <h3 style={{ margin: "0 0 14px", fontFamily: "var(--font-fraunces),Georgia,serif" }}>{t}</h3>;
const smallBtn: React.CSSProperties = { border: "1px solid var(--line)", background: "#fff", padding: "6px 10px", borderRadius: 8, fontWeight: 700, fontSize: 11.5 };

export default function SettingsView() {
  const { toast, staff: me, setSetting } = useOc();
  const [form, setForm] = useState<Form | null>(null);
  const [types, setTypes] = useState({ delivery: true, takeaway: true, dine: true });
  const [pins, setPins] = useState<Pin[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [defaultPin, setDefaultPin] = useState(false);
  const [newPin, setNewPin] = useState({ pin: "", area: "" });
  const [newStaff, setNewStaff] = useState({ name: "", email: "", role: "waiter" as StaffRole, password: "" });
  const [undo, setUndo] = useState("");
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState({ svc: 0, util: 0 });

  const load = useCallback(async () => {
    const d = await fetchSettingsPageData();
    const s = d.settings as Record<string, string>;
    setForm(Object.fromEntries(KEYS.map((k) => [k, s[k] ?? ""])) as Form);
    const ot = String(s.order_types || "Delivery, Takeaway, Dine-in");
    setTypes({ delivery: /delivery/i.test(ot), takeaway: /takeaway/i.test(ot), dine: /dine/i.test(ot) });
    setPins(d.pincodes as Pin[]);
    setStaff(d.staff as Staff[]);
    setDefaultPin(Boolean(d.defaultPasscode));
  }, []);
  useEffect(() => {
    void load();
    const sb = db(), start = monthStartIST();
    Promise.all([
      sb.from("messages").select("*", { count: "exact", head: true }).eq("direction", "outbound").not("content", "ilike", "[order confirmed template]%").gte("created_at", start),
      sb.from("messages").select("*", { count: "exact", head: true }).eq("direction", "outbound").ilike("content", "[order confirmed template]%").gte("created_at", start),
    ]).then(([a, b]) => setUsage({ svc: a.count || 0, util: b.count || 0 }));
  }, [load]);

  if (!form) return <div className="none">Loading settings…</div>;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const check = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.checked ? "true" : "false" });

  const save = async () => {
    setSaving(true);
    const order_types = [types.delivery && "Delivery", types.takeaway && "Takeaway", types.dine && "Dine-in"].filter(Boolean).join(", ");
    const r = await saveSettings({ ...form, order_types });
    if (r.success && undo.trim()) {
      const p = await changeUndoPasscode(undo.trim());
      if (!p.success) { setSaving(false); toast(p.error); return; }
      setUndo(""); setDefaultPin(false);
    }
    setSaving(false);
    if (!r.success) { toast("Could not save settings — " + r.error); return; }
    Object.entries({ ...form, order_types }).forEach(([k, v]) => setSetting(k, v));
    toast("Settings saved");
  };
  const uploadLogo = async (f?: File) => {
    if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    const r = await uploadMenuImage(fd);
    if (!r.success) { toast("Logo upload failed — " + r.error); return; }
    setForm({ ...form, logo_url: r.url });
    toast("Logo uploaded — click Save settings to apply");
  };
  const pinAdd = async () => {
    if (!/^\d{6}$/.test(newPin.pin.trim())) { toast("Enter a valid 6-digit pincode"); return; }
    const r = await addPincode(newPin.pin.trim(), newPin.area.trim());
    if (!r.success) { toast(r.error); return; }
    toast(newPin.pin + " added"); setNewPin({ pin: "", area: "" }); void load();
  };
  const staffAdd = async () => {
    const r = await addStaff({ ...newStaff, email: newStaff.email.trim().toLowerCase(), name: newStaff.name.trim() });
    if (!r.success) { toast(r.error); return; }
    toast(newStaff.name + " added"); setNewStaff({ name: "", email: "", role: "waiter", password: "" }); void load();
  };
  const staffUpdate = async (email: string, changes: { role?: StaffRole; is_active?: boolean }) => {
    const r = await updateStaff(email, changes);
    toast(r.success ? "Staff updated" : r.error); void load();
  };

  const waOver = Math.max(0, usage.svc - WA_FREE_QUOTA);
  const overCost = Math.round(waOver * WA_RATE * 100) / 100, utilCost = Math.round(usage.util * WA_RATE * 100) / 100;
  const waClr = usage.svc >= WA_FREE_QUOTA ? "#C0392B" : usage.svc >= WA_FREE_QUOTA * 0.8 ? "#C9821A" : "#1F8A4C";

  return (
    <div>
      <div className="panel">
        <H t="Restaurant profile" />
        <div className="mimgpick">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={form.logo_url || FALLBACK_IMG} alt="" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = FALLBACK_IMG; }} />
          <input type="file" accept="image/*" onChange={(e) => void uploadLogo(e.target.files?.[0])} />
        </div>
        <L t="Restaurant name" /><input className="f" value={form.restaurant_name} onChange={set("restaurant_name")} />
        <L t="Tagline" /><input className="f" value={form.tagline} onChange={set("tagline")} />
        <L t="Address" /><input className="f" value={form.address} onChange={set("address")} />
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><L t="Phone" /><input className="f" value={form.phone} onChange={set("phone")} /></div>
          <div style={{ flex: 1 }}><L t="City" /><input className="f" value={form.city} onChange={set("city")} /></div>
        </div>
      </div>

      <div className="panel">
        <H t="Tax (GST)" />
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><L t="GST %" /><input className="f" inputMode="decimal" value={form.gst_percent} onChange={set("gst_percent")} /></div>
          <div style={{ flex: 2 }}><L t="GSTIN (registration number)" /><input className="f" placeholder="29ABCDE1234F1Z5" value={form.gstin} onChange={set("gstin")} /></div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -4 }}>Menu prices already include GST — this is used to show the CGST/SGST split on printed bills, not to change order totals.</div>
      </div>

      <div className="panel">
        <H t="Hours" />
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}><L t="Opens" /><input className="f" type="time" value={form.open_time} onChange={set("open_time")} /></div>
          <div style={{ flex: 1 }}><L t="Closes" /><input className="f" type="time" value={form.close_time} onChange={set("close_time")} /></div>
        </div>
        <L t="Hours shown to customers & the AI" /><input className="f" value={form.hours} onChange={set("hours")} />
        <label className="avrow"><input type="checkbox" className="cbox" checked={form.orders_paused === "true"} onChange={check("orders_paused")} /> ⏸ Pause all new orders</label>
      </div>

      <div className="panel">
        <H t="Order types accepted" />
        <label className="avrow"><input type="checkbox" className="cbox" checked={types.delivery} onChange={(e) => setTypes({ ...types, delivery: e.target.checked })} /> Delivery</label>
        <label className="avrow"><input type="checkbox" className="cbox" checked={types.takeaway} onChange={(e) => setTypes({ ...types, takeaway: e.target.checked })} /> Takeaway</label>
        <label className="avrow"><input type="checkbox" className="cbox" checked={types.dine} onChange={(e) => setTypes({ ...types, dine: e.target.checked })} /> Dine-in</label>
      </div>

      <div className="panel">
        <H t="Order & delivery" />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 150 }}><L t="Minimum delivery order (₹)" /><input className="f" inputMode="numeric" value={form.min_order} onChange={set("min_order")} /></div>
          <div style={{ flex: 1, minWidth: 150 }}><L t="Delivery fee (₹)" /><input className="f" inputMode="numeric" value={form.delivery_fee} onChange={set("delivery_fee")} /></div>
          <div style={{ flex: 1, minWidth: 150 }}><L t="Free delivery above (₹)" /><input className="f" inputMode="numeric" value={form.free_delivery_above} onChange={set("free_delivery_above")} /></div>
        </div>
        <L t="Delivery note shown to customers" /><input className="f" value={form.delivery_note} onChange={set("delivery_note")} />
      </div>

      <div className="panel">
        <H t="Delivery pincodes" />
        <div className="pickbar">
          <input className="f grow" placeholder="Pincode" inputMode="numeric" maxLength={6} style={{ margin: 0 }} value={newPin.pin} onChange={(e) => setNewPin({ ...newPin, pin: e.target.value })} />
          <input className="f grow" placeholder="Area (optional)" style={{ margin: 0 }} value={newPin.area} onChange={(e) => setNewPin({ ...newPin, area: e.target.value })} />
          <button className="btn sm" onClick={() => void pinAdd()}>Add</button>
        </div>
        <div className="rlist">{pins.length ? pins.map((p) => (
          <div key={p.pincode} className="histrow"><span>{p.pincode}{p.area ? " · " + p.area : ""}</span>
            <button className="danger" style={smallBtn} onClick={async () => { const r = await removePincode(p.pincode); toast(r.success ? "Pincode removed" : r.error); void load(); }}>Remove</button></div>
        )) : <div className="none">No delivery pincodes added</div>}</div>
      </div>

      <div className="panel">
        <H t="Payment methods" />
        <input className="f" placeholder="e.g. Cash on delivery. UPI coming soon." value={form.payment_methods} onChange={set("payment_methods")} />
      </div>

      <div className="panel">
        <H t="Printing & security" />
        <label className="avrow"><input type="checkbox" className="cbox" checked={form.auto_print === "true"} onChange={check("auto_print")} /> Auto-print on accept</label>
        <L t={"Undo passcode" + (defaultPin ? " — still the default, please change it" : "")} />
        <input className="f" inputMode="numeric" maxLength={4} placeholder="New 4-digit passcode" style={{ maxWidth: 200 }} value={undo} onChange={(e) => setUndo(e.target.value.replace(/\D/g, ""))} />
      </div>

      <div className="panel">
        <H t="AI & WhatsApp" />
        <L t="If the AI doesn't know something, it should..." /><textarea className="f" rows={2} value={form.unknown_policy} onChange={set("unknown_policy")} />
        <L t="Google review link" /><input className="f" value={form.google_review_url} onChange={set("google_review_url")} />
      </div>

      <div className="panel">
        <H t="Stock alerts" />
        <L t="Default low-stock threshold" /><input className="f" inputMode="numeric" value={form.low_stock_threshold} onChange={set("low_stock_threshold")} />
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -4 }}>Used for any tracked item that doesn&apos;t have its own alert threshold set in Menu Management.</div>
        <div style={{ marginTop: 10 }}><L t="Warn when an ingredient expires within (days)" /></div><input className="f" inputMode="numeric" value={form.expiry_warn_days} onChange={set("expiry_warn_days")} />
        <div style={{ marginTop: 10 }}><L t="Margin alert threshold (%)" /></div><input className="f" inputMode="numeric" value={form.margin_alert_pct} onChange={set("margin_alert_pct")} />
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: -4 }}>Flag any recipe-costed dish whose profit margin falls below this percentage.</div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <button className="btn" style={{ maxWidth: 260 }} disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save settings"}</button>
      </div>

      <div className="panel">
        <H t="Staff & roles" />
        <div className="pickbar">
          <input className="f grow" placeholder="Name" style={{ margin: 0 }} value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} />
          <input className="f grow" placeholder="Login email" style={{ margin: 0 }} value={newStaff.email} onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })} />
          <input className="f grow" type="password" placeholder="Password (min 8)" style={{ margin: 0 }} value={newStaff.password} onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })} />
          <select className="f" style={{ margin: 0, maxWidth: 140 }} value={newStaff.role} onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value as StaffRole })}>
            <option value="waiter">Waiter</option><option value="counter">Counter</option><option value="kitchen">Kitchen</option><option value="admin">Admin</option>
          </select>
          <button className="btn sm" onClick={() => void staffAdd()}>Add</button>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "-4px 0 10px" }}>Adding staff here creates their login and role straight away.</div>
        <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>On duty</th><th></th></tr></thead><tbody>
          {staff.length ? staff.map((s) => (
            <tr key={s.email}>
              <td><b>{s.name || "—"}</b></td><td>{s.email}</td>
              <td><select className="f2" style={{ margin: 0, padding: "6px 8px" }} value={s.role} disabled={s.email === me.email.toLowerCase()} onChange={(e) => void staffUpdate(s.email, { role: e.target.value as StaffRole })}>
                <option value="waiter">Waiter</option><option value="counter">Counter</option><option value="kitchen">Kitchen</option><option value="admin">Admin</option></select></td>
              <td><button className="sw" aria-pressed={s.is_active} disabled={s.email === me.email.toLowerCase()} onClick={() => void staffUpdate(s.email, { is_active: !s.is_active })}><i /></button></td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button style={{ ...smallBtn, marginRight: 5 }} onClick={async () => {
                  const pw = prompt("New password for " + s.email + " (min 8 characters)");
                  if (!pw) return;
                  const r = await resetStaffPassword(s.email, pw); toast(r.success ? "Password reset" : r.error);
                }}>Reset password</button>
                {s.email !== me.email.toLowerCase() ? <button className="danger" style={smallBtn} onClick={async () => {
                  if (!confirm("Remove this staff member?")) return;
                  const r = await removeStaff(s.email); toast(r.success ? "Staff member removed" : r.error); void load();
                }}>Remove</button> : null}
              </td>
            </tr>
          )) : <tr><td colSpan={5} className="none">No staff added yet</td></tr>}
        </tbody></table>
      </div>

      <div className="panel">
        <h3 style={{ margin: "0 0 4px", fontFamily: "var(--font-fraunces),Georgia,serif" }}>WhatsApp messaging usage</h3>
        <div style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 14px" }}>Admin only. Each WhatsApp number gets 1,000 free-form (service) messages free per calendar month, then they&apos;re billed at the Utility rate. Invoice sends via the approved template are always billed.</div>
        <div className="stats" style={{ marginBottom: 10 }}>
          <div className="stat"><span>Service messages this month</span><b style={{ color: waClr }}>{usage.svc}/{WA_FREE_QUOTA}</b></div>
          <div className="stat"><span>Invoice template sends</span><b>{usage.util}</b></div>
          <div className="stat r"><span>Est. WhatsApp cost this month</span><b>₹{(overCost + utilCost).toFixed(2)}</b></div>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {waOver ? `${waOver} service messages over the free ${WA_FREE_QUOTA}, at ₹0.1357 each = ₹${overCost.toFixed(2)}. ` : `Still inside the free ${WA_FREE_QUOTA} service messages this month. `}
          {usage.util ? `${usage.util} invoice-template send${usage.util === 1 ? "" : "s"} at ₹0.1357 each = ₹${utilCost.toFixed(2)}. ` : ""}
          Estimated from messages logged in this dashboard — Meta&apos;s own WhatsApp Manager invoice is the source of truth for actual billing.</div>
      </div>
    </div>
  );
}
