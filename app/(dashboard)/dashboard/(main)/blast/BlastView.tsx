"use client";

/* Oceana Blast: eligible/selected/sent-this-month stats with the 1,000/month
   cap, audience, approved YCloud template, header media, send. */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useOc } from "../../DashShell";
import { db } from "../../oc-data";
import { PICK_KEY, readPick } from "../contacts/ContactsView";
import { getYCloudTemplates, sendBlast, uploadYCloudMedia } from "./actions";

type Template = { name: string; language?: string; components?: Array<{ type: string; format?: string; buttons?: Array<{ type: string; url?: string }> }> };
const MONTHLY_CAP = 1000;
const monthStartIST = () => {
  const IST = 5.5 * 3600000, now = new Date(Date.now() + IST);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - IST).toISOString();
};

export default function BlastView() {
  const router = useRouter();
  const { toast } = useOc();
  const [eligible, setEligible] = useState(0);
  const [sent, setSent] = useState(0);
  const [pick, setPick] = useState<string[]>([]);
  const [filter, setFilter] = useState("all");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tpl, setTpl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<React.ReactNode>(null);

  useEffect(() => {
    setPick([...readPick()]);
    const sb = db();
    Promise.all([
      sb.from("customers").select("*", { count: "exact", head: true }).eq("opted_out", false),
      sb.from("blast_log").select("*", { count: "exact", head: true }).eq("status", "sent").gte("created_at", monthStartIST()),
    ]).then(([c, s]) => { setEligible(c.count || 0); setSent(s.count || 0); });
    getYCloudTemplates().then((r) => {
      const list = (r.success && r.templates ? r.templates : []) as Template[];
      setTemplates(list);
      if (list[0]) setTpl(list[0].name);
      if (!r.success) toast("Could not load templates — " + (r.error || "check YCloud"));
    });
  }, [toast]);

  const template = templates?.find((t) => t.name === tpl);
  const header = template?.components?.find((c) => c.type === "HEADER");
  const needsMedia = ["IMAGE", "VIDEO", "DOCUMENT"].includes(header?.format || "");
  const remaining = Math.max(0, MONTHLY_CAP - sent);
  const capPct = Math.min(100, Math.round((sent / MONTHLY_CAP) * 100));
  const capClr = sent >= MONTHLY_CAP ? "#C0392B" : sent >= MONTHLY_CAP * 0.8 ? "#C9821A" : "#1F8A4C";
  const wouldSend = pick.length || eligible;
  const lbl = (t: string) => <label style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{t}</label>;
  const clearPick = () => { sessionStorage.removeItem(PICK_KEY); setPick([]); };

  const send = async () => {
    if (!template) return;
    if (wouldSend > remaining) {
      setRes(<div className="err" style={{ background: "#FDECEA", borderColor: "#F3C2BE", color: "#B23B2E" }}>This would send to about {wouldSend} people, but only {remaining} sends are left this month (cap {MONTHLY_CAP}). Narrow your selection, or wait for next month.</div>);
      return;
    }
    if (needsMedia && !file) { setRes(<div className="err">This template needs a {String(header?.format).toLowerCase()} header. Upload one first.</div>); return; }
    setBusy(true); setRes(null);
    try {
      const components: unknown[] = [];
      if (needsMedia && file) {
        const fd = new FormData();
        fd.append("file", file);
        const up = await uploadYCloudMedia(fd);
        if (!up.success || !up.media_id) throw new Error("Image upload failed: " + (up.error || "unknown"));
        components.push({ type: "header", parameters: [{ type: "image", image: { id: up.media_id } }] });
      }
      const buttons = template.components?.find((c) => c.type === "BUTTONS");
      const idx = buttons?.buttons?.findIndex((b) => b.type === "URL" && b.url?.includes("{{1}}")) ?? -1;
      if (idx !== -1) {
        const param = process.env.NEXT_PUBLIC_BLAST_BUTTON_URL_PARAM?.trim();
        if (!param) throw new Error("Configure the approved Rasoi campaign link before sending this template.");
        components.push({ type: "button", sub_type: "url", index: idx, parameters: [{ type: "text", text: param }] });
      }
      const r = await sendBlast(pick.length ? "all" : filter, tpl, components, pick);
      if (!r.success || !r.data) throw new Error(r.error || "Blast did not complete. Check the workflow is active in n8n.");
      const d = r.data as { sent?: number; attempted?: number; error?: string; monthly_cap?: boolean };
      const sentCount = Number(d.sent || 0);
      const attemptedCount = Number(d.attempted ?? (pick.length || eligible));
      setRes(<>
        <div className={`stat ${sentCount ? "" : "r"}`}><span>Sent of {attemptedCount}</span><b>{sentCount}</b></div>
        {d.error ? <div className="err" style={{ marginTop: 10 }}><b>{d.monthly_cap ? "Cap reached:" : "Meta says:"}</b> {d.error}</div> : null}
      </>);
      setSent((s) => s + sentCount);
      toast(d.error
        ? `Blast finished: ${sentCount} of ${attemptedCount} sent. See the details below.`
        : `Blast sent to ${sentCount} ${sentCount === 1 ? "contact" : "contacts"}.`);
    } catch (e) {
      setRes(<div className="err">{e instanceof Error ? e.message : "Blast did not complete."}</div>);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="stats" style={{ marginBottom: 14 }}>
        <div className="stat"><span>Eligible Contacts</span><b>{eligible}</b></div>
        <div className="stat r"><span>Selected</span><b>{pick.length}</b></div>
        <div className="stat"><span>Sent this month</span><b style={{ color: capClr }}>{sent}/{MONTHLY_CAP}</b></div>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: "#eee", overflow: "hidden", margin: "-6px 0 14px" }}><div style={{ height: "100%", width: capPct + "%", background: capClr }} /></div>
      {sent >= MONTHLY_CAP ? <div className="err" style={{ background: "#FDECEA", borderColor: "#F3C2BE", color: "#B23B2E", marginBottom: 12 }}>⛔ Monthly blast cap reached ({MONTHLY_CAP}/{MONTHLY_CAP}). Sends resume on the 1st of next month.</div>
        : remaining <= 100 ? <div className="err" style={{ background: "#FFF8E5", borderColor: "#F3DFA8", color: "#7A5A00", marginBottom: 12 }}>⚠ Only {remaining} blast sends left this month (cap {MONTHLY_CAP}/month).</div> : null}
      {pick.length ? (
        <div className="selinfo" style={{ display: "block", marginBottom: 12 }}>Sending to the {pick.length} contacts you picked. <button style={{ textDecoration: "underline" }} onClick={clearPick}>Clear selection</button></div>
      ) : (
        <div className="selinfo" style={{ display: "block", marginBottom: 12, background: "#FFF8E5", borderColor: "#F3DFA8", color: "#7A5A00" }}>
          No contacts selected — this will go to the whole group below. <button style={{ textDecoration: "underline" }} onClick={() => router.push("/dashboard/contacts")}>Pick contacts instead</button></div>
      )}
      {lbl("Who" + (pick.length ? " (ignored while a selection is active)" : ""))}
      <select className="f" disabled={pick.length > 0} value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="all">Everyone</option><option value="active_30">Ordered in the last 30 days</option><option value="repeat">Repeat customers only</option>
      </select>
      {lbl("Approved template")}
      <select className="f" value={tpl} onChange={(e) => { setTpl(e.target.value); setFile(null); setPreview(""); }}>
        {templates === null ? <option>Loading templates…</option> : templates.length ? templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>) : <option value="">No approved templates found</option>}
      </select>
      {needsMedia ? (
        <>
          {lbl("Header " + String(header?.format).toLowerCase())}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <label className="btn" style={{ padding: "10px 16px", whiteSpace: "nowrap", width: "auto", cursor: "pointer" }}>
              {file ? "Change file" : "Upload " + String(header?.format).toLowerCase()}
              <input type="file" style={{ display: "none" }} accept={header?.format === "DOCUMENT" ? ".pdf" : header?.format === "VIDEO" ? "video/*" : "image/png,image/jpeg,image/webp"}
                onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; setFile(f); setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : ""); }} />
            </label>
            {file ? <span style={{ alignSelf: "center", fontSize: 12.5, color: "var(--muted)" }}>{file.name}</span> : null}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="" style={{ maxWidth: 160, maxHeight: 90, borderRadius: 8, border: "1px solid #eee", objectFit: "cover", display: "block", marginBottom: 12 }} /> : null}
        </>
      ) : null}
      <div className="err" style={{ background: "#FFF8E5", borderColor: "#F3DFA8", color: "#7A5A00" }}>
        The template must already be approved in Meta, and the blast workflow must be active in n8n. Sends about one per second — leave this tab open.</div>
      <button className="btn" disabled={busy || sent >= MONTHLY_CAP || !template} onClick={() => void send()}>{busy ? "Sending…" : "Send blast"}</button>
      <div style={{ marginTop: 12 }}>{res}</div>
    </div>
  );
}
