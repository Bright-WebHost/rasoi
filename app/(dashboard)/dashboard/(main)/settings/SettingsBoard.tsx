"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { redirectIfSessionExpired } from "@/lib/auth/session-expired";
import type { StaffRole } from "@/lib/auth/permissions";
import {
  formatTime12h,
  isOpenAt,
  parseOrderTypes,
  parseSettings,
  serializeOrderTypes,
  type OrderTypesEnabled,
  type RawSettings,
} from "@/lib/settings";
import type { DeliveryPincode } from "@/lib/settings/server";
import {
  addPincode,
  addStaff,
  changeUndoPasscode,
  removePincode,
  removeStaff,
  resetStaffPassword,
  saveSettings,
  updateStaff,
} from "./actions";

export interface StaffMemberRow {
  email: string;
  name: string;
  role: StaffRole;
  is_active: boolean;
}

type Result = { success: true } | { success: false; error: string };

const ROLE_OPTIONS: Array<{ value: StaffRole; label: string; hint: string }> = [
  { value: "admin", label: "Admin", hint: "Everything, including settings" },
  { value: "counter", label: "Counter", hint: "Orders, POS, tables, riders" },
  { value: "waiter", label: "Waiter", hint: "POS and tables" },
  { value: "kitchen", label: "Kitchen", hint: "Kitchen screen only" },
];

const inputClass =
  "w-full rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] px-4 py-3 text-sm font-semibold text-[#0A1017] outline-none focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white transition-all placeholder:text-[#A1B2C6] placeholder:font-medium";
const labelClass = "text-[12px] font-extrabold uppercase tracking-widest text-[#8799AF]";
const primaryButton =
  "rounded-xl bg-[#E23744] px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_12px_rgba(226,55,68,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(226,55,68,0.35)] disabled:opacity-50 disabled:hover:translate-y-0";
const secondaryButton =
  "rounded-xl border border-[#EAF0F6] bg-white px-4 py-2.5 text-sm font-bold text-[#0A1017] transition hover:bg-[#F3F6F9] disabled:opacity-50";
const dangerLink = "rounded-lg border border-[#F5C2C6] bg-white px-3 py-1.5 text-[12px] font-bold text-[#C0392B] transition hover:bg-[#FDE8E8] disabled:opacity-50";

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export default function SettingsBoard({
  initialSettings,
  pincodes,
  staff,
  currentEmail,
  isDefaultPasscode,
}: {
  initialSettings: RawSettings;
  pincodes: DeliveryPincode[];
  staff: StaffMemberRow[];
  currentEmail: string;
  isDefaultPasscode: boolean;
}) {
  const [form, setForm] = useState<RawSettings>(initialSettings);
  const [baseline, setBaseline] = useState<RawSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirtyKeys = useMemo(
    () => (Object.keys(form) as Array<keyof RawSettings>).filter((k) => k !== "orders_paused" && form[k] !== baseline[k]),
    [form, baseline]
  );
  const orderTypes = parseOrderTypes(form.order_types);
  const liveSettings = parseSettings(baseline);
  const openNow = isOpenAt(liveSettings);

  const showToast = (text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), 3200);
  };

  /** Runs a server action in a transition so the page re-renders with fresh data. */
  const run = (action: () => Promise<Result>, okText: string, onOk?: () => void) =>
    new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const result = await action().catch(async () => {
          // A failed action is usually the proxy bouncing an expired login to /dashboard/login.
          if (await redirectIfSessionExpired()) return { success: false as const, error: "Your session expired. Please sign in again." };
          return { success: false as const, error: "Network error — please try again." };
        });
        if (result.success) {
          onOk?.();
          showToast(okText);
        } else {
          showToast(result.error, "error");
        }
        resolve(result.success);
      });
    });

  const set = (key: keyof RawSettings) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const setOrderType = (key: keyof OrderTypesEnabled, on: boolean) =>
    setForm((f) => ({ ...f, order_types: serializeOrderTypes({ ...parseOrderTypes(f.order_types), [key]: on }) }));

  const handleSave = async () => {
    if (dirtyKeys.length === 0) return;
    setSaving(true);
    const patch = Object.fromEntries(dirtyKeys.map((k) => [k, form[k]])) as Partial<RawSettings>;
    await run(() => saveSettings(patch), "Settings saved", () => setBaseline((b) => ({ ...b, ...patch })));
    setSaving(false);
  };

  const togglePause = (paused: boolean) => {
    const value = paused ? "true" : "false";
    setForm((f) => ({ ...f, orders_paused: value }));
    void run(
      () => saveSettings({ orders_paused: value }),
      paused ? "Orders paused — customers can't place new orders" : "Orders resumed",
      () => setBaseline((b) => ({ ...b, orders_paused: value }))
    ).then((ok) => {
      if (!ok) setForm((f) => ({ ...f, orders_paused: baseline.orders_paused }));
    });
  };

  const handleLogoUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return showToast("Please choose an image file.", "error");
    if (file.size > 2 * 1024 * 1024) return showToast("Logo must be under 2 MB.", "error");

    setLogoUploading(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `branding/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("menu_images").upload(path, file, { cacheControl: "3600", upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("menu_images").getPublicUrl(path);
      set("logo_url")(data.publicUrl);
      showToast("Logo uploaded — click Save settings to apply");
    } catch (err) {
      showToast(`Logo upload failed: ${err instanceof Error ? err.message : "try again"}`, "error");
    } finally {
      setLogoUploading(false);
    }
  };

  const fillHoursText = () => {
    if (!form.open_time || !form.close_time) return set("hours")("Open 24 hours, every day");
    set("hours")(`${formatTime12h(form.open_time)} to ${formatTime12h(form.close_time)}, every day`);
  };

  const paused = form.orders_paused === "true";

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-6 p-1 pb-32 sm:p-2">
      <div className="flex flex-col gap-4 rounded-[20px] border border-[#EAF0F6] bg-white/50 p-6 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-[-0.6px] text-[#0A1017]">Settings</h1>
          <p className="mt-1 text-sm font-semibold text-[#8799AF]">Restaurant details, ordering rules, printing and staff.</p>
        </div>
        <StatusPill open={openNow} paused={liveSettings.ordersPaused} hours={liveSettings} />
      </div>

      {/* Pause orders */}
      <div className={`flex flex-col gap-4 rounded-[20px] border p-5 sm:flex-row sm:items-center sm:justify-between ${paused ? "border-[#F5C2C6] bg-[#FDE8E8]" : "border-[#EAF0F6] bg-white"}`}>
        <div>
          <h2 className="text-[16px] font-extrabold text-[#0A1017]">{paused ? "⏸️ Orders are paused" : "Pause orders"}</h2>
          <p className="mt-1 text-sm font-medium text-[#6B7A90]">
            {paused
              ? "Customers on the website and WhatsApp see that you're not taking orders. POS still works."
              : "Busy kitchen or closed for the day? Stop new website and WhatsApp orders instantly, without changing your hours."}
          </p>
        </div>
        <Toggle checked={paused} onChange={togglePause} disabled={isPending} label="Pause orders" tone="danger" />
      </div>

      <Section title="Restaurant profile" description="Shown on the customer app, bills and receipts.">
        <div className="flex items-center gap-4">
          {form.logo_url ? (
            <img src={form.logo_url} alt="Logo" className="h-20 w-20 rounded-2xl border border-[#EAF0F6] object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-dashed border-[#C9D4E0] bg-[#F8FAFB] text-[10px] font-bold text-[#8799AF]">No logo</div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${secondaryButton} cursor-pointer ${logoUploading ? "pointer-events-none opacity-50" : ""}`}>
              {logoUploading ? "Uploading…" : form.logo_url ? "Change logo" : "Upload logo"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { void handleLogoUpload(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {form.logo_url && (
              <button type="button" onClick={() => set("logo_url")("")} className="text-sm font-bold text-[#C0392B] hover:underline">Remove</button>
            )}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Restaurant name"><input className={inputClass} value={form.restaurant_name} onChange={(e) => set("restaurant_name")(e.target.value)} maxLength={80} /></Field>
          <Field label="Tagline"><input className={inputClass} value={form.tagline} onChange={(e) => set("tagline")(e.target.value)} maxLength={120} /></Field>
          <Field label="Address" className="sm:col-span-2"><input className={inputClass} value={form.address} onChange={(e) => set("address")(e.target.value)} maxLength={300} /></Field>
          <Field label="Phone"><input className={inputClass} value={form.phone} onChange={(e) => set("phone")(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" maxLength={30} /></Field>
          <Field label="City"><input className={inputClass} value={form.city} onChange={(e) => set("city")(e.target.value)} maxLength={60} /></Field>
        </div>
      </Section>

      <Section title="Tax (GST)" description="Menu prices already include GST. This only shows the CGST/SGST split and your GSTIN on printed bills. Order totals don't change.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="GST %"><input className={inputClass} value={form.gst_percent} onChange={(e) => set("gst_percent")(e.target.value)} inputMode="decimal" /></Field>
          <Field label="GSTIN (registration number)" className="sm:col-span-2">
            <input className={`${inputClass} uppercase`} value={form.gstin} onChange={(e) => set("gstin")(e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" maxLength={15} />
          </Field>
        </div>
      </Section>

      <Section title="Hours" description="Outside these hours the website and WhatsApp stop taking new orders. Closing after midnight works too (e.g. 6:00 PM to 2:00 AM). Leave both blank to accept orders 24 hours.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Opens"><input type="time" className={inputClass} value={form.open_time} onChange={(e) => set("open_time")(e.target.value)} /></Field>
          <Field label="Closes"><input type="time" className={inputClass} value={form.close_time} onChange={(e) => set("close_time")(e.target.value)} /></Field>
          <Field
            label="Hours shown to customers & the AI"
            className="sm:col-span-2"
            action={<button type="button" onClick={fillHoursText} className="text-[11px] font-bold text-[#0D6EFD] hover:underline">Fill from times</button>}
          >
            <input className={inputClass} value={form.hours} onChange={(e) => set("hours")(e.target.value)} maxLength={120} />
          </Field>
        </div>
      </Section>

      <Section title="Order types accepted" description="Turned-off types are hidden from the customer app and refused on WhatsApp.">
        <div className="grid gap-3 sm:grid-cols-3">
          <CheckRow label="Delivery" checked={orderTypes.delivery} onChange={(v) => setOrderType("delivery", v)} />
          <CheckRow label="Takeaway" checked={orderTypes.takeaway} onChange={(v) => setOrderType("takeaway", v)} />
          <CheckRow label="Dine-in (table QR)" checked={orderTypes.dineIn} onChange={(v) => setOrderType("dineIn", v)} />
        </div>
      </Section>

      <Section title="Order & delivery" description="The delivery fee is added to delivery orders. Use 0 to turn a value off.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum delivery order (₹)"><input className={inputClass} value={form.min_order} onChange={(e) => set("min_order")(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" /></Field>
          <Field label="Delivery fee (₹)"><input className={inputClass} value={form.delivery_fee} onChange={(e) => set("delivery_fee")(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" /></Field>
          <Field label="Free delivery above (₹)"><input className={inputClass} value={form.free_delivery_above} onChange={(e) => set("free_delivery_above")(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="0 = never free" /></Field>
          <Field label="Delivery note shown to customers" className="sm:col-span-3">
            <input className={inputClass} value={form.delivery_note} onChange={(e) => set("delivery_note")(e.target.value)} placeholder="e.g. We deliver within about 5 km of Lalbagh" maxLength={200} />
          </Field>
        </div>
      </Section>

      <Section title="Payment methods" description="Told to customers by the WhatsApp AI.">
        <input className={inputClass} value={form.payment_methods} onChange={(e) => set("payment_methods")(e.target.value)} maxLength={200} />
      </Section>

      <Section title="Printing & security">
        <CheckRow
          label="Auto-print bill when an order is accepted or rung up at POS"
          hint="Opens the print dialog automatically. With a thermal printer and Chrome kiosk printing, it prints silently."
          checked={form.auto_print === "true"}
          onChange={(v) => set("auto_print")(v ? "true" : "false")}
        />
        <PasscodeEditor isDefault={isDefaultPasscode} disabled={isPending} onSave={(pin) => run(() => changeUndoPasscode(pin), "Undo passcode updated")} />
      </Section>

      <Section title="AI & WhatsApp">
        <Field label="If the AI doesn't know something, it should…">
          <textarea rows={3} className={inputClass} value={form.unknown_policy} onChange={(e) => set("unknown_policy")(e.target.value)} maxLength={600} />
        </Field>
        <Field label="Google review link">
          <input className={inputClass} value={form.google_review_url} onChange={(e) => set("google_review_url")(e.target.value)} placeholder="https://g.page/r/…" maxLength={500} />
        </Field>
      </Section>

      <PincodesSection pincodes={pincodes} disabled={isPending} run={run} />

      <StaffSection staff={staff} currentEmail={currentEmail} disabled={isPending} run={run} />

      {/* Sticky save bar */}
      <div className={`fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 transition-all duration-300 ${dirtyKeys.length ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"}`}>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#1C2633] bg-[#0A1017] px-4 py-3 text-white shadow-2xl">
          <span className="text-sm font-semibold">
            {dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setForm({ ...baseline })} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-[#A1B2C6] hover:text-white">
              Discard
            </button>
            <button type="button" onClick={handleSave} disabled={saving || logoUploading} className={primaryButton}>
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed right-4 top-4 z-50 max-w-[360px] rounded-xl border px-4 py-3 text-sm font-bold shadow-lg ${toast.tone === "ok" ? "border-[#C6ECD6] bg-[#E5F5EC] text-[#146C43]" : "border-[#F5C2C6] bg-[#FDE8E8] text-[#C0392B]"}`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ---------------- Building blocks ---------------- */

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[20px] border border-[#EAF0F6] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
      <div className="border-b border-[#EAF0F6] bg-[#F8FAFB] px-6 py-4">
        <h2 className="text-[15px] font-extrabold uppercase tracking-widest text-[#0A1017]">{title}</h2>
        {description && <p className="mt-1 text-[13px] font-medium leading-relaxed text-[#6B7A90]">{description}</p>}
      </div>
      <div className="flex flex-col gap-4 p-6">{children}</div>
    </section>
  );
}

function Field({ label, children, className = "", action }: { label: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <label className={labelClass}>{label}</label>
        {action}
      </div>
      {children}
    </div>
  );
}

function CheckRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] p-4">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#E23744]" />
      <span>
        <span className="block text-[14px] font-bold text-[#0A1017]">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] font-medium text-[#6B7A90]">{hint}</span>}
      </span>
    </label>
  );
}

function Toggle({ checked, onChange, disabled, label, tone = "ok" }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; tone?: "ok" | "danger" }) {
  const on = tone === "danger" ? "bg-[#E23744]" : "bg-[#22A06B]";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? on : "bg-[#C9D4E0]"}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-6" : "left-1"}`} />
    </button>
  );
}

function StatusPill({ open, paused, hours }: { open: boolean; paused: boolean; hours: { openTime: string; closeTime: string } }) {
  const text = paused ? "Paused" : open ? "Open now" : "Closed now";
  const sub = hours.openTime && hours.closeTime ? `${formatTime12h(hours.openTime)} – ${formatTime12h(hours.closeTime)}` : "24 hours";
  return (
    <div className={`flex items-center gap-2 self-start rounded-full border px-4 py-2 text-sm font-bold sm:self-auto ${open ? "border-[#C6ECD6] bg-[#E5F5EC] text-[#146C43]" : "border-[#F5C2C6] bg-[#FDE8E8] text-[#C0392B]"}`}>
      <span className={`h-2 w-2 rounded-full ${open ? "animate-pulse bg-[#22A06B]" : "bg-[#C0392B]"}`} />
      {text}
      <span className="font-semibold opacity-70">· {sub}</span>
    </div>
  );
}

function PasscodeEditor({ isDefault, disabled, onSave }: { isDefault: boolean; disabled: boolean; onSave: (pin: string) => Promise<boolean> }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const valid = /^\d{4}$/.test(pin) && pin === confirmPin;

  return (
    <div className="rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] p-4">
      <p className="text-[14px] font-bold text-[#0A1017]">Undo passcode</p>
      <p className="mt-0.5 text-[12px] font-medium text-[#6B7A90]">
        Required to restore a cancelled order. It&apos;s stored encrypted and never shown again.
      </p>
      {isDefault && (
        <p className="mt-2 rounded-lg border border-[#F3D28B] bg-[#FFF7E6] px-3 py-2 text-[12px] font-bold text-[#9A6700]">
          ⚠️ The default passcode 0000 is still in use. Set your own.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <input className={`${inputClass} w-[130px] text-center tracking-[0.4em]`} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="New" inputMode="numeric" type="password" autoComplete="new-password" />
        <input className={`${inputClass} w-[130px] text-center tracking-[0.4em]`} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Confirm" inputMode="numeric" type="password" autoComplete="new-password" />
        <button
          type="button"
          disabled={!valid || disabled}
          onClick={async () => {
            if (await onSave(pin)) {
              setPin("");
              setConfirmPin("");
            }
          }}
          className={secondaryButton}
        >
          Update passcode
        </button>
      </div>
      {pin.length === 4 && confirmPin.length === 4 && pin !== confirmPin && <p className="mt-2 text-[12px] font-bold text-[#C0392B]">Passcodes don&apos;t match.</p>}
    </div>
  );
}

type Runner = (action: () => Promise<Result>, okText: string, onOk?: () => void) => Promise<boolean>;

function PincodesSection({ pincodes, disabled, run }: { pincodes: DeliveryPincode[]; disabled: boolean; run: Runner }) {
  const [pin, setPin] = useState("");
  const [area, setArea] = useState("");

  const add = () => {
    if (!/^\d{6}$/.test(pin)) return;
    void run(() => addPincode(pin, area), `${pin} added`, () => {
      setPin("");
      setArea("");
    });
  };

  return (
    <Section
      title="Delivery pincodes"
      description={pincodes.length ? "Delivery orders are accepted only from these pincodes." : "No pincodes added — delivery is accepted from any pincode. Add pincodes to limit your delivery area."}
    >
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className={`${inputClass} sm:w-[160px]`} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="Pincode" inputMode="numeric" />
        <input className={`${inputClass} flex-1`} value={area} onChange={(e) => setArea(e.target.value)} placeholder="Area (optional)" maxLength={80} />
        <button type="submit" disabled={disabled || !/^\d{6}$/.test(pin)} className={primaryButton}>Add</button>
      </form>
      {pincodes.length > 0 && (
        <ul className="divide-y divide-[#EAF0F6] rounded-xl border border-[#EAF0F6]">
          {pincodes.map((p) => (
            <li key={p.pincode} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm font-semibold text-[#0A1017]">
                <span className="font-mono font-bold">{p.pincode}</span>
                {p.area && <span className="text-[#6B7A90]"> · {p.area}</span>}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void run(() => removePincode(p.pincode), `${p.pincode} removed`)}
                className={dangerLink}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function StaffSection({ staff, currentEmail, disabled, run }: { staff: StaffMemberRow[]; currentEmail: string; disabled: boolean; run: Runner }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("waiter");
  const [password, setPassword] = useState("");
  const [credentials, setCredentials] = useState<{ title: string; email: string; password: string } | null>(null);
  const [resetFor, setResetFor] = useState<StaffMemberRow | null>(null);

  const canAdd = name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && password.length >= 8;

  const add = () => {
    if (!canAdd) return;
    const created = { title: `${name.trim()} can now sign in`, email: email.trim().toLowerCase(), password };
    void run(() => addStaff({ name, email, role, password }), `${name.trim()} added`, () => {
      setCredentials(created);
      setName("");
      setEmail("");
      setPassword("");
      setRole("waiter");
    });
  };

  return (
    <Section title="Staff & roles" description="Adding a staff member creates their dashboard login. Taking someone off duty blocks their sign-in without deleting them.">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.2fr_150px_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={60} />
        <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Login email" type="email" autoComplete="off" />
        <select className={`${inputClass} cursor-pointer`} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <div className="flex gap-2">
          <input className={`${inputClass} min-w-0`} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+)" autoComplete="new-password" />
          <button type="button" onClick={() => setPassword(generatePassword())} className={`${secondaryButton} shrink-0 px-3`} title="Generate a password">🎲</button>
        </div>
        <button type="submit" disabled={disabled || !canAdd} className={primaryButton}>Add</button>
      </form>
      <p className="-mt-1 text-[12px] font-medium text-[#8799AF]">
        {ROLE_OPTIONS.map((r) => `${r.label}: ${r.hint}`).join(" · ")}
      </p>

      {credentials && (
        <CredentialsCard {...credentials} onClose={() => setCredentials(null)} />
      )}

      <div className="divide-y divide-[#EAF0F6] rounded-xl border border-[#EAF0F6]">
        {staff.map((s) => {
          const isSelf = s.email === currentEmail;
          return (
            <div key={s.email} className={`flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center ${s.is_active ? "" : "bg-[#F8FAFB]"}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-[#0A1017]">
                  {s.name || "—"} {isSelf && <span className="ml-1 rounded-md bg-[#EAF3FF] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#1A5FA8]">You</span>}
                  {!s.is_active && <span className="ml-1 rounded-md bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#667085]">Off duty</span>}
                </p>
                <p className="truncate text-[13px] font-medium text-[#6B7A90]">{s.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  aria-label={`Role for ${s.email}`}
                  className="rounded-lg border border-[#EAF0F6] bg-white px-3 py-1.5 text-[13px] font-bold text-[#0A1017] disabled:opacity-50"
                  value={s.role}
                  disabled={disabled || isSelf}
                  onChange={(e) => void run(() => updateStaff(s.email, { role: e.target.value as StaffRole }), "Role updated")}
                >
                  {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <span className="flex items-center gap-2 text-[12px] font-bold text-[#6B7A90]">
                  On duty
                  <Toggle
                    checked={s.is_active}
                    disabled={disabled || isSelf}
                    label={`On duty: ${s.email}`}
                    onChange={(v) => void run(() => updateStaff(s.email, { is_active: v }), v ? `${s.name || s.email} is on duty` : `${s.name || s.email} is off duty`)}
                  />
                </span>
                <button type="button" disabled={disabled} onClick={() => setResetFor(s)} className={secondaryButton.replace("px-4 py-2.5 text-sm", "px-3 py-1.5 text-[12px]")}>
                  Reset password
                </button>
                {!isSelf && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (window.confirm(`Remove ${s.name || s.email}? Their login will be deleted.`)) {
                        void run(() => removeStaff(s.email), `${s.name || s.email} removed`);
                      }
                    }}
                    className={dangerLink}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {resetFor && (
        <ResetPasswordModal
          member={resetFor}
          disabled={disabled}
          onClose={() => setResetFor(null)}
          onSubmit={(newPassword) =>
            run(() => resetStaffPassword(resetFor.email, newPassword), "Password updated", () => {
              setCredentials({ title: `New password for ${resetFor.name || resetFor.email}`, email: resetFor.email, password: newPassword });
              setResetFor(null);
            })
          }
        />
      )}
    </Section>
  );
}

function CredentialsCard({ title, email, password, onClose }: { title: string; email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Dashboard login\nEmail: ${email}\nPassword: ${password}`;
  return (
    <div className="rounded-xl border border-[#C6ECD6] bg-[#E5F5EC] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-[#146C43]">✅ {title}</p>
          <p className="mt-1 text-[13px] font-semibold text-[#146C43]">
            Email: <span className="font-mono">{email}</span> · Password: <span className="font-mono">{password}</span>
          </p>
          <p className="mt-1 text-[12px] font-medium text-[#146C43]/80">Share these now. The password won&apos;t be shown again.</p>
        </div>
        <button type="button" onClick={onClose} className="text-[#146C43] hover:opacity-70" aria-label="Dismiss">✕</button>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true));
        }}
        className="mt-3 rounded-lg border border-[#C6ECD6] bg-white px-3 py-1.5 text-[12px] font-bold text-[#146C43]"
      >
        {copied ? "Copied" : "Copy login details"}
      </button>
    </div>
  );
}

function ResetPasswordModal({ member, disabled, onClose, onSubmit }: { member: StaffMemberRow; disabled: boolean; onClose: () => void; onSubmit: (password: string) => Promise<boolean> }) {
  const [password, setPassword] = useState(generatePassword);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-[24px] bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold text-[#0A1017]">Reset password</h3>
        <p className="mt-1 text-sm font-medium text-[#6B7A90]">{member.name || member.email} · {member.email}</p>
        <div className="mt-4 flex gap-2">
          <input className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <button type="button" onClick={() => setPassword(generatePassword())} className={`${secondaryButton} shrink-0 px-3`} title="Generate">🎲</button>
        </div>
        {password.length > 0 && password.length < 8 && <p className="mt-2 text-[12px] font-bold text-[#C0392B]">At least 8 characters.</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="button" disabled={disabled || password.length < 8} onClick={() => void onSubmit(password)} className={primaryButton}>Set password</button>
        </div>
      </div>
    </div>
  );
}
