"use client";

import { useEffect, useState, type FormEvent } from "react";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { StaffIdentityRecord, type StaffIdentity } from "./StaffIdentityRecord";
import { StaffPasswordForm } from "./StaffPasswordForm";

type Profile = {
  name: string;
  username: string;
  email: string | null;
  role: string;
  is_active?: number | boolean;
  created_at?: string | null;
  contact_number?: string | null;
  address?: string | null;
  duty_hours?: string | null;
  identity: StaffIdentity | null;
};

function formatCreatedAt(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function StaffProfileClient() {
  const [user, setUser] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [address, setAddress] = useState("");
  const [detailsCurrentPassword, setDetailsCurrentPassword] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState("");
  const [loadingMessage, setLoadingMessage] = useState("");
  const [detailsBusy, setDetailsBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetchPortalApi("/api/staff/profile").then(async (response) => {
      const data = await response.json() as { user: Omit<Profile, "identity">; identity: StaffIdentity | null; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load profile.");
      if (active) {
        setUser({ ...data.user, identity: data.identity });
        setEmail(data.user.email || "");
        setContactNumber(data.user.contact_number || "");
        setAddress(data.user.address || "");
      }
    }).catch((error: unknown) => {
      if (active) setLoadingMessage(error instanceof Error ? error.message : "Could not load your profile.");
    });
    return () => { active = false; };
  }, []);

  function cancelDetailsEdit() {
    if (!user) return;
    setEmail(user.email || "");
    setContactNumber(user.contact_number || "");
    setAddress(user.address || "");
    setDetailsCurrentPassword("");
    setDetailsMessage("");
    setEditingDetails(false);
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDetailsBusy(true);
    setDetailsMessage("");
    try {
      const response = await fetch("/api/staff/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          contact_number: contactNumber,
          address,
          current_password: detailsCurrentPassword,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save account details.");
      setUser((value) => value ? { ...value, ...data.user } : value);
      setEmail(data.user.email || "");
      setContactNumber(data.user.contact_number || "");
      setAddress(data.user.address || "");
      setDetailsCurrentPassword("");
      setEditingDetails(false);
      window.dispatchEvent(new CustomEvent("portal-profile-updated", { detail: { email: data.user.email } }));
      setDetailsMessage("Account details saved.");
    } catch (error) {
      setDetailsMessage(error instanceof Error ? error.message : "Could not save account details.");
    } finally {
      setDetailsBusy(false);
    }
  }

  if (!user) return <p role="status">{loadingMessage || "Loading your profile…"}</p>;
  const isActive = Boolean(user.is_active);
  return (
    <div className="staff-profile-layout">
      <section className="card staff-profile-card" aria-labelledby="staff-profile-details-title">
        <div className="staff-profile-heading">
          <div>
            <span className="eyebrow">Staff account</span>
            <h2 id="staff-profile-details-title">My profile</h2>
            <p>{user.name}</p>
          </div>
          <div className="account-profile-badges">
            <span className="badge badge-cream">{user.role}</span>
            <span className={`badge ${isActive ? "badge-green" : "badge-red"}`}>
              {isActive ? "Active" : "Inactive"}
            </span>
            <button
              className="btn btn-outline"
              type="button"
              disabled={detailsBusy}
              onClick={editingDetails ? cancelDetailsEdit : () => {
                setDetailsMessage("");
                setEditingDetails(true);
              }}
            >
              {editingDetails ? "Cancel" : "Edit details"}
            </button>
          </div>
        </div>

        {editingDetails ? (
          <form id="staff-profile-edit-form" className="staff-profile-edit-form" onSubmit={saveDetails}>

            <div className="staff-profile-edit-grid">
              <label>
                <span>Recovery email</span>
                <input className="input" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label>
                <span>Contact number</span>
                <input className="input" type="tel" maxLength={30} value={contactNumber} onChange={(event) => setContactNumber(event.target.value)} />
              </label>
              <label className="staff-profile-address-field">
                <span>Address</span>
                <textarea className="input" rows={3} maxLength={500} value={address} onChange={(event) => setAddress(event.target.value)} />
              </label>
            </div>
            <label className="field">
              <span className="label">Current password to confirm changes</span>
              <input className="input" type="password" required autoComplete="current-password" value={detailsCurrentPassword} onChange={(event) => setDetailsCurrentPassword(event.target.value)} />
            </label>
            {detailsMessage && <p role="alert">{detailsMessage}</p>}
            <button className="btn btn-primary" type="submit" disabled={detailsBusy}>
              {detailsBusy ? "Saving…" : "Save account details"}
            </button>
          </form>
        ) : (
          <>
            <div className="account-profile-details staff-profile-details">
              <div><span>Username</span><strong>{user.username}</strong></div>
              <div><span>Recovery email</span><strong>{user.email || "Not provided"}</strong></div>
              <div><span>Contact number</span><strong>{user.contact_number || "Not provided"}</strong></div>
              <div><span>Address</span><strong>{user.address || "Not provided"}</strong></div>
              <div><span>Scheduled duty hours</span><strong>{user.duty_hours || "Not set"}</strong></div>
              <div><span>Account created</span><strong>{formatCreatedAt(user.created_at)}</strong></div>
            </div>
            {detailsMessage && <p role="status">{detailsMessage}</p>}
          </>
        )}

        <StaffIdentityRecord identity={user.identity} />
      </section>

      <StaffPasswordForm />
    </div>
  );
}
