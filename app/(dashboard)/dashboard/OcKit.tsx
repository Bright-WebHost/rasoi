"use client";

import { useEffect, useRef, useState } from "react";
import { useRiders } from "./oc-data";

/** Oceana's slide-to-confirm bar. `onDone` returning false snaps it back. */
export function Slide({ label, color, big, pulse, disabled, onDone }: {
  label: string; color: string; big?: boolean; pulse?: boolean; disabled?: boolean;
  onDone: () => boolean | void | Promise<boolean | void>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [override, setText] = useState<string | null>(null);
  const text = override ?? label;
  const drag = useRef<{ x0: number; max: number } | null>(null);
  const knobW = big ? 66 : 50;
  const threshold = big ? 0.6 : 0.55;

  const down = (e: React.PointerEvent) => {
    if (disabled || !box.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x0: e.clientX, max: box.current.clientWidth - knobW - 6 };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const nx = Math.max(0, Math.min(d.max, e.clientX - d.x0));
    setX(nx);
    setText(nx > d.max * threshold ? "Release" : null);
  };
  const up = async () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const reset = () => { setX(0); setText(null); };
    if (x > d.max * threshold) {
      setText(big ? "Working…" : "Updating…");
      const ok = await onDone();
      if (ok === false) reset();
    } else reset();
  };

  return (
    <div ref={box} className={`slide${big ? " big" : ""}${pulse ? " pulsering" : ""}`}>
      <div className="fill" style={{ background: color, opacity: big ? 0.18 : 0.16, width: x ? x + knobW : 0 }} />
      <div className="lbl">{text}</div>
      <div className="knob" style={{ background: color, left: 3 + x }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>›</div>
    </div>
  );
}

export type Rider = { id: string; name: string; phone: string };

/** "Who is delivering?" — active riders only, with a skip option. */
export function RiderPicker({ orderNumber, onPick, onSkip }: {
  orderNumber: string; onPick: (r: Rider) => void; onSkip: () => void;
}) {
  const { list } = useRiders();
  const riders: Rider[] | null = list ? list.filter((r) => r.is_active !== false).map((r) => ({ id: r.id, name: r.name, phone: r.whatsapp_number || "" })) : null;
  return (
    <div className="modal">
      <div className="mcard">
        <h3>Who is delivering {orderNumber}?</h3>
        <div className="rlist">
          {riders === null ? <div className="none">Loading riders…</div>
            : riders.length ? riders.map((r) => <button key={r.id} onClick={() => onPick(r)}>{r.name} · {r.phone}</button>)
            : <div className="none">No riders added yet — add them in the Riders tab.</div>}
        </div>
        <button className="btn ghost" onClick={onSkip}>Skip for now</button>
      </div>
    </div>
  );
}

/** 4-digit passcode prompt (Oceana's undo gate). `onSubmit` returns an error to shake. */
export function PasscodeModal({ title, detail, onSubmit, onCancel }: {
  title: string; detail: string; onSubmit: (pin: string) => Promise<string | null>; onCancel: () => void;
}) {
  const [pin, setPin] = useState("");
  const [bad, setBad] = useState(false);
  const busy = useRef(false);
  const tryIt = async (value: string) => {
    if (busy.current) return;
    busy.current = true;
    const err = await onSubmit(value);
    busy.current = false;
    if (err) { setBad(true); setPin(""); setTimeout(() => setBad(false), 320); }
  };
  return (
    <div className="modal">
      <div className="mcard pinwrap">
        <h3>{title}</h3>
        <p>{detail}</p>
        <input className={`pinbox${bad ? " bad" : ""}`} inputMode="numeric" maxLength={4} placeholder="••••" autoComplete="off" autoFocus
          value={pin}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setPin(v); if (v.length === 4) void tryIt(v); }}
          onKeyDown={(e) => { if (e.key === "Enter") void tryIt(pin); }} />
        <div className="mrow"><button onClick={onCancel}>Cancel</button><button className="go" onClick={() => void tryIt(pin)}>Confirm</button></div>
      </div>
    </div>
  );
}
