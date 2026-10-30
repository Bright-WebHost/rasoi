"use client";

/* Oceana Live Chat: conversation list + thread, AI on/off switch per customer. */
import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../../oc-data";
import { useOc } from "../../DashShell";
import { ist } from "../../oc-utils";
import { sendAgentReply, toggleAiSession } from "./actions";

type Session = { phone: string; last_message: string | null; last_message_at: string | null; unread_count: number | null; ai_enabled: boolean | null; ai_disabled_by?: string | null };
type Msg = { id: string; phone: string; direction: "inbound" | "outbound"; content: string; sender: string; created_at: string };

export default function ChatView() {
  const sb = useRef(db());
  const { toast } = useOc();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [cur, setCur] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const curRef = useRef<string | null>(null);
  const msgsBox = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    const { data } = await sb.current.from("chat_sessions").select("*").order("last_message_at", { ascending: false, nullsFirst: false }).limit(80);
    setSessions((data || []) as Session[]);
  }, []);
  const loadMsgs = useCallback(async (p: string) => {
    const { data } = await sb.current.from("messages").select("*").eq("phone", p).order("created_at").limit(200);
    if (curRef.current === p) setMsgs((data || []) as Msg[]);
  }, []);

  useEffect(() => {
    void loadSessions();
    const ch = sb.current.channel("oc-chat")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => {
        const phone = (p.new as Msg | undefined)?.phone;
        if (phone && phone === curRef.current) void loadMsgs(phone);
        void loadSessions();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_sessions" }, () => void loadSessions())
      .subscribe();
    const client = sb.current;
    return () => { void client.removeChannel(ch); };
  }, [loadSessions, loadMsgs]);

  useEffect(() => { if (msgsBox.current) msgsBox.current.scrollTop = msgsBox.current.scrollHeight; }, [msgs]);

  const open = async (p: string) => {
    curRef.current = p;
    setCur(p);
    setMsgs([]);
    await loadMsgs(p);
    await sb.current.from("chat_sessions").update({ unread_count: 0 }).eq("phone", p);
    void loadSessions();
  };
  const toggleAI = async (p: string, on: boolean) => {
    const r = await toggleAiSession(p, on);
    toast(r && "success" in r && !r.success ? "Could not change AI" : on ? "AI back on" : "AI paused — you are replying");
    void loadSessions();
  };
  const send = async () => {
    const t = text.trim();
    if (!t || !cur) return;
    setText("");
    setSending(true);
    const r = await sendAgentReply(cur, t);
    setSending(false);
    if (!r || !r.success) { toast("Message not sent"); setText(t); return; }
    void loadMsgs(cur);
    void loadSessions();
  };

  const s = sessions.find((x) => x.phone === cur);
  return (
    <div className={`chat ${cur ? "open" : ""}`}>
      <div className="sessions">
        {sessions.length ? sessions.map((x) => (
          <div key={x.phone} className="s" aria-selected={x.phone === cur} onClick={() => void open(x.phone)}>
            {Number(x.unread_count) > 0 ? <span className="unread">{x.unread_count}</span> : null}
            <b>{x.phone}</b><small>{(x.last_message || "").slice(0, 42)}</small>
            {x.ai_enabled === false ? <span className="aioff">{x.ai_disabled_by === "customer_request" ? "Wants a person" : "AI off · " + (x.ai_disabled_by || "staff")}</span> : null}
          </div>
        )) : <div className="none">No conversations yet</div>}
      </div>
      <div className="thread">
        {cur ? (
          <>
            <div className="th">
              <div><button className="btn sm ghost" style={{ marginRight: 8 }} onClick={() => { curRef.current = null; setCur(null); }}>←</button><b>{cur}</b></div>
              <div className="tgl">AI <button className="sw" aria-pressed={s?.ai_enabled !== false} onClick={() => void toggleAI(cur, s?.ai_enabled === false)}><i /></button></div>
            </div>
            <div className="msgs" ref={msgsBox}>
              {msgs.length ? msgs.map((m) => (
                <div key={m.id} className={`m ${m.direction === "inbound" ? "in" : "out"}`}>
                  {m.content}<small>{m.sender} · {ist(m.created_at)}</small>
                </div>
              )) : <div className="none">No messages</div>}
            </div>
            <div className="compose">
              <input placeholder="Reply as staff…" autoComplete="off" value={text} disabled={sending}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
              <button className="btn sm" onClick={() => void send()}>Send</button>
            </div>
          </>
        ) : <div className="none">Pick a conversation</div>}
      </div>
    </div>
  );
}
