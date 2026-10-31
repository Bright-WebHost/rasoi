"use client";

/* Oceana-style dashboard shell: sidebar, sticky header and shared helpers.
   It stays mounted across every dashboard route, so switching views never
   re-fetches the frame — the same "single page" feel as the Oceana dashboard. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { StaffUser } from "@/lib/auth/staff";
import { canAccessPage, type PageRoute, type StaffRole } from "@/lib/auth/permissions";
import { StaffProvider } from "@/components/providers/StaffProvider";
import { OrderManagerProvider, useOrderManager } from "./OrderManagerProvider";
import NewOrderAlert from "./NewOrderAlert";
import ReadyRiderPrompt from "./ReadyRiderPrompt";
import type { RangeState } from "./oc-utils";

const NAV: Array<[PageRoute, string]> = [
  ["/dashboard/pos", "🛒 POS"],
  ["/dashboard/orders", "🧾 Orders"],
  ["/dashboard/tables", "🍽️ Tables"],
  ["/dashboard/kitchen", "👨‍🍳 Kitchen"],
  ["/dashboard/chat", "💬 Live Chat"],
  ["/dashboard/menu", "📋 Menu"],
  ["/dashboard/stock", "📦 Stock"],
  ["/dashboard/pnl", "💰 P&L"],
  ["/dashboard/riders", "🛵 Riders"],
  ["/dashboard/stats", "📊 Analytics"],
  ["/dashboard/contacts", "👥 Contacts"],
  ["/dashboard/blast", "📣 Blast"],
  ["/dashboard/settings", "⚙️ Settings"],
];

type OcContext = {
  staff: StaffUser;
  settings: Record<string, string>;
  setSetting: (key: string, value: string) => void;
  toast: (message: string) => void;
  /** Date filter shared by Orders, Riders, Analytics, Stock and P&L, like Oceana's RANGE. */
  range: RangeState;
  setRange: (r: RangeState) => void;
};

const SHELL_CACHE = "rasoi_shell";
const Oc = createContext<OcContext | null>(null);

export function useOc() {
  const ctx = useContext(Oc);
  if (!ctx) throw new Error("useOc must be used inside the dashboard shell");
  return ctx;
}

export default function DashShell({ fontClass, children }: { fontClass: string; children: React.ReactNode }) {
  const router = useRouter();
  const sb = useRef(createClient());
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [range, setRange] = useState<RangeState>({ range: "today", from: "", to: "" });
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);

  useEffect(() => {
    let alive = true;
    // Draw the frame straight away from the last verified session, then re-check it.
    try {
      const cached = JSON.parse(sessionStorage.getItem(SHELL_CACHE) || "null") as { staff: StaffUser; settings: Record<string, string> } | null;
      if (cached?.staff) { setSettings(cached.settings || {}); setStaff(cached.staff); }
    } catch { /* ignore a corrupt cache */ }
    (async () => {
      const [{ data: userData }, staffRes, settingsRes] = await Promise.all([
        sb.current.auth.getUser(),
        sb.current.rpc("staff_check"),
        sb.current.from("settings").select("key,value"),
      ]);
      if (!alive) return;
      const check = staffRes.data as { staff?: boolean; email?: string; role?: StaffRole } | null;
      if (!userData.user || !check?.staff || !check.role) {
        sessionStorage.removeItem(SHELL_CACHE);
        await sb.current.auth.signOut();
        router.replace("/dashboard/login?error=unauthorized");
        return;
      }
      const map: Record<string, string> = {};
      (settingsRes.data || []).forEach((r: { key: string; value: string | null }) => { map[r.key] = r.value ?? ""; });
      const verified = { id: userData.user.id, email: check.email || userData.user.email || "", role: check.role };
      sessionStorage.setItem(SHELL_CACHE, JSON.stringify({ staff: verified, settings: map }));
      setSettings(map);
      setStaff((cur) => (cur && cur.id === verified.id && cur.role === verified.role && cur.email === verified.email ? cur : verified));
    })();
    return () => { alive = false; };
  }, [router]);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);
  const setSetting = useCallback((key: string, value: string) => setSettings((s) => ({ ...s, [key]: value })), []);

  const ctx = useMemo(
    () => (staff ? { staff, settings, setSetting, toast, range, setRange } : null),
    [staff, settings, setSetting, toast, range],
  );

  if (!ctx) {
    return (
      <div className={`oc ${fontClass}`}>
        <div className="shell">
          <aside><Brand /></aside>
          <main><div className="head"><h1>&nbsp;</h1></div></main>
        </div>
      </div>
    );
  }

  return (
    <Oc.Provider value={ctx}>
      <StaffProvider staff={ctx.staff}>
        <OrderManagerProvider autoPrint={settings.auto_print === "true"}>
          <Frame fontClass={fontClass} toasts={toasts}>{children}</Frame>
        </OrderManagerProvider>
      </StaffProvider>
    </Oc.Provider>
  );
}

function Brand() {
  return (
    <div className="brandwrap">
      <div className="tile">R</div>
      <div className="brand">Rasoi</div>
      <div className="kicker">ORDER HUB</div>
    </div>
  );
}

function Frame({ fontClass, toasts, children }: { fontClass: string; toasts: Array<{ id: number; text: string }>; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { staff, toast } = useOc();
  const { refreshOrders, lastUpdated, toggleSound, enableSound, soundEnabled } = useOrderManager();
  const [navOpen, setNavOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Phone/tablet: one deliberate tap per device arms sound + keeps the screen awake (Oceana's shift gate).
  const [gate, setGate] = useState(() => window.matchMedia("(max-width:860px)").matches && localStorage.getItem("rasoi_shift_ok") !== "1");
  const keepAwake = useCallback(async () => {
    try { await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<unknown> } }).wakeLock?.request("screen"); } catch { /* unsupported */ }
  }, []);
  useEffect(() => {
    void keepAwake();
    const onVis = () => { if (!document.hidden) void keepAwake(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [keepAwake]);
  const startShift = () => {
    localStorage.setItem("rasoi_shift_ok", "1");
    enableSound();
    try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); } catch { /* unsupported */ }
    void keepAwake();
    setGate(false);
  };

  const nav = NAV.filter(([href]) => canAccessPage(staff.role, href));
  // Client-side page guard (RLS is the real boundary): send staff to the first screen they may use.
  const page = (NAV.find(([href]) => pathname === href || pathname.startsWith(href + "/"))?.[0] ?? "/dashboard/orders") as PageRoute;
  const allowed = canAccessPage(staff.role, page);
  useEffect(() => {
    if (!allowed && nav[0]) router.replace(nav[0][0]);
  }, [allowed, nav, router]);
  const current = NAV.find(([href]) => pathname === href || pathname.startsWith(href + "/"));
  const title = current ? current[1] : "🧾 Orders";
  const updated = lastUpdated
    ? lastUpdated.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  const refresh = async () => {
    setRefreshing(true);
    await refreshOrders();
    setRefreshing(false);
    toast("Refreshed");
  };
  const signOut = async () => {
    sessionStorage.removeItem(SHELL_CACHE);
    await createClient().auth.signOut();
    router.replace("/dashboard/login");
  };
  const sound = () => {
    toggleSound();
    // Like Oceana: a one-time notification grant lets new orders ring before anyone taps the page.
    try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); } catch { /* unsupported */ }
  };
  const soundLabel = soundEnabled ? "🔔 Sound on" : "🔔 Enable sound";

  return (
    <div className={`oc ${fontClass} ${navOpen ? "navopen" : ""}`}>
      <div className="shell">
        <aside className="print:hidden">
          <button className="navdrawer-close" aria-label="Close menu" onClick={() => setNavOpen(false)}>✕</button>
          <Brand />
          <nav>
            {nav.map(([href, label]) => (
              <Link key={href} href={href} onClick={() => setNavOpen(false)} aria-current={current?.[0] === href ? "true" : "false"}>{label}</Link>
            ))}
          </nav>
          <div className="side-foot">
            <div className="roletag">{staff.email.split("@")[0]} · {staff.role}</div>
            <button onClick={refresh}>{refreshing ? "↻ Refreshing…" : "↻ Refresh Now"}</button>
            <button onClick={sound}>{soundLabel}</button>
            <button onClick={signOut}>Sign out</button>
          </div>
        </aside>
        <div className="navbackdrop" onClick={() => setNavOpen(false)} />
        <main>
          <div className="head print:hidden">
            <button id="mmenu" aria-label="Open menu" onClick={() => setNavOpen(true)}>☰</button>
            <h1>{title}</h1>
            <div className="pills">
              <span className="pilb ok">● Live</span>
              <span className="pilb">Updated {updated}</span>
              <span className="pilb warn">● Staff online</span>
            </div>
            <div className="mobonly">
              <button className="btn sm ghost" onClick={sound}>🔔</button>
              <button className="btn sm ghost" onClick={refresh}>↻</button>
              <button className="btn sm ghost" onClick={signOut}>⏻</button>
            </div>
          </div>
          {allowed ? children : null}
        </main>
      </div>
      {gate ? (
        <div id="shiftgate">
          <div>
            <div className="tile">R</div>
            <h1>Start your shift</h1>
            <p>This device will stay awake and ring on every new order for the rest of the shift. Tap once to begin.</p>
            <button className="btn" onClick={startShift}>🔔 Start shift — enable sound</button>
            <button className="btn ghost sgskip" onClick={() => setGate(false)}>Skip for now</button>
          </div>
        </div>
      ) : null}
      <NewOrderAlert />
      <ReadyRiderPrompt />
      {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
    </div>
  );
}
