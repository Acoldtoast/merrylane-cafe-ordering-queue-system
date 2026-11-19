"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function StaffPasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setMessage("New passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/staff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update your password.");
      if (data.sign_in_again) router.replace("/login?next=/staff");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card staff-profile-card" aria-labelledby="staff-profile-password-title">
      <span className="eyebrow">Account settings</span>
      <h2 id="staff-profile-password-title">Change password</h2>
      <p className="staff-profile-form-intro">Your current password is required to set a new one.</p>
      <form onSubmit={savePassword} className="feedback-form">
        <label className="field">
          <span className="label">Current password</span>
          <input className="input" type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label className="field">
          <span className="label">New password</span>
          <input className="input" type="password" required minLength={6} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="field">
          <span className="label">Confirm new password</span>
          <input className="input" type="password" required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </label>
        <p>Changing your password signs you out; sign in again with your new password.</p>
        {message && <p role="alert">{message}</p>}
        <button className="btn btn-primary" disabled={busy} type="submit">{busy ? "Saving…" : "Update password"}</button>
      </form>
    </section>
  );
}
