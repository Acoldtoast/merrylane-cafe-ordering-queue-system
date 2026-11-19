"use client";

import { useState, type FormEvent } from "react";

export function StaffPasswordChange({ onChanged }: { onChanged: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/change-temporary-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: password }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Could not change your password.");
      setPassword("");
      setConfirmation("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change your password.");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="change-temporary-password-title">
    <h2 id="change-temporary-password-title">Choose your password.</h2>
    <p>Replace your temporary password before continuing.</p>
    <form className="auth-form-body" onSubmit={submit}>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="field"><label className="label" htmlFor="first-new-password">New password</label><input id="first-new-password" className="input" type="password" autoComplete="new-password" minLength={6} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      <div className="field"><label className="label" htmlFor="first-confirm-password">Confirm new password</label><input id="first-confirm-password" className="input" type="password" autoComplete="new-password" minLength={6} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
    </form>
    <p><button type="button" className="btn btn-ghost" onClick={() => { void fetch("/api/auth/login?area=staff", { method: "DELETE" }).finally(() => window.location.assign("/login")); }}>Sign out</button></p>
  </section>;
}
