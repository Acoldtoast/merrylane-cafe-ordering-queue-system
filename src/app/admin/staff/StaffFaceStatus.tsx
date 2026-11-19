"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";

type Status = {
  enabled: boolean;
  required: boolean;
  enrolled: boolean;
  verified_at: string | null;
  expires_at: string | null;
};

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

export function StaffFaceStatus({ userId }: { userId: number }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirmOpen && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [confirmOpen]);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/admin/staff/${userId}/face-check`, { cache: "no-store", signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load face-check status.");
      setStatus(data as Status);
      setError("");
    } catch (err) {
      if (!signal?.aborted) setError(err instanceof Error ? err.message : "Could not load face-check status.");
    }
  }, [userId]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => { void load(controller.signal); }, 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [load]);

  async function reset() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/staff/${userId}/face-check`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Could not reset face check.");
      await load();
      setNotice("Face check reset. The staff member must sign in again and verify when face checking is enabled.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset face check.");
    } finally { setBusy(false); }
  }

  const label = !status ? "Loading…" : !status.enabled ? "Disabled" : !status.enrolled ? "Face not registered" : status.required ? status.verified_at ? "Expired" : "Not yet verified" : "Verified";
  return <section className="staff-face-status" aria-labelledby={`face-status-${userId}`}>
    <h3 id={`face-status-${userId}`}>Duty face check</h3>
    <p>Status · <strong>{label}</strong></p>
    {status?.verified_at && <p className="tiny">Last verified: {formatTime(status.verified_at)}{status.enabled && status.expires_at ? ` · Expires: ${formatTime(status.expires_at)}` : ""}</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmOpen(true)} disabled={busy || !status?.verified_at}>
      {busy ? "Resetting…" : "Reset face check"}
    </button>
    {confirmOpen && <dialog ref={dialog} className="staff-face-reset-dialog" role="alertdialog" aria-labelledby="face-reset-title" aria-describedby="face-reset-description" onClose={() => setConfirmOpen(false)}>
      <div className="staff-face-reset-heading">
        <span className="staff-face-reset-icon"><Icon name="alert" size={21} /></span>
        <div><span className="eyebrow">Confirmation</span><h3 id="face-reset-title">Reset face check?</h3></div>
      </div>
      <p id="face-reset-description">This signs the staff member out and requires them to sign in and verify again when face checking is enabled. Their registered face will not be removed.</p>
      <div className="staff-face-reset-actions">
        <button type="button" className="btn btn-outline" autoFocus onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => { dialog.current?.close(); void reset(); }}>Reset face check</button>
      </div>
    </dialog>}
  </section>;
}
