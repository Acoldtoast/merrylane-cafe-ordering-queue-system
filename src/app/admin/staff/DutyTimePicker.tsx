"use client";

import { useState } from "react";

export function DutyTimePicker({ id, value, onChange, validate }: { id: string; value: string; onChange: (value: string) => void; validate?: (value: string) => string | null }) {
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState(1);
  const [minute, setMinute] = useState(0);
  const [period, setPeriod] = useState("AM");
  const [error, setError] = useState("");
  function show() {
    setError("");
    if (value) {
      const [h, m] = value.split(":").map(Number);
      setHour(h % 12 || 12);
      setMinute(m);
      setPeriod(h >= 12 ? "PM" : "AM");
    } else {
      setHour(1); setMinute(0); setPeriod("AM");
    }
    setOpen(true);
  }
  const display = value ? `${String((Number(value.slice(0, 2)) % 12) || 12).padStart(2, "0")}:${value.slice(3, 5)} ${Number(value.slice(0, 2)) >= 12 ? "PM" : "AM"}` : "Not set";
  return (
    <div className="duty-time-picker">
      <button id={id} type="button" className="input duty-time-trigger" aria-expanded={open} onClick={() => open ? setOpen(false) : show()}>{display}</button>
      {open && <div className="duty-time-menu">
        <div className="duty-time-selects">
          <label>Hour<select aria-label="Hour" value={hour} onChange={(e) => setHour(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, "0")}</option>)}</select></label>
          <label>Minute<select aria-label="Minute" value={minute} onChange={(e) => setMinute(Number(e.target.value))}>{Array.from({ length: 60 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}</option>)}</select></label>
          <label>Period<select aria-label="AM or PM" value={period} onChange={(e) => setPeriod(e.target.value)}><option>AM</option><option>PM</option></select></label>
        </div>
        <div className="duty-time-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange(""); setOpen(false); }}>Clear</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { const h = hour % 12 + (period === "PM" ? 12 : 0); const next = `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`; const problem = validate?.(next); if (problem) { setError(problem); return; } onChange(next); setOpen(false); }}>Set time</button>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>}
    </div>
  );
}
