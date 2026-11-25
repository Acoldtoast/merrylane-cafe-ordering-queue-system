"use client";

import { useEffect, useRef, useState } from "react";
import { StaffFaceCamera } from "./StaffFaceCamera";
import { StaffFacePhotoPreview } from "./StaffFacePhotoPreview";
import Image from "next/image";
import { checkStaffIdName, checkStaffIdNumber, staffIdentityReviewCheck } from "@/lib/staffIdChecks";
import { staffIdCheckLabel, type StaffIdCheckTone } from "@/lib/staffIdCheckLabels";
import { useStaffIdDuplicateCheck } from "@/lib/useStaffIdDuplicateCheck";
import { StaffIdentityUpdate } from "./StaffIdentityUpdate";
import { StaffIdentityUpdateSuccess } from "./StaffIdentityUpdateSuccess";

const poses = [["face_front", "Straight on"], ["face_left", "Turn left"], ["face_right", "Turn right"]] as const;

export function StaffExistingIdentity({ userId, name }: { userId: number; name: string }) {
  const idViewerRef = useRef<HTMLDialogElement>(null);
  const idViewerCloseRef = useRef<HTMLButtonElement>(null);
  const activeImageTriggerRef = useRef<HTMLButtonElement>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [identityStatus, setIdentityStatus] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [retake, setRetake] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<{ outcome?: string; detected_type?: string | null; name_evidence?: string; face_match?: string; error?: string } | null>(null);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [idType, setIdType] = useState("philsys");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<{ status: string; id_front: string; id_back: string | null; id_type: string | null; duplicate_checked?: boolean } | null>(null);
  const [details, setDetails] = useState({ name: "", number: "", birth_date: "" });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [detailsLocked, setDetailsLocked] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [idUpdateOpen, setIdUpdateOpen] = useState(false);
  const [draftReview, setDraftReview] = useState(false);
  const [identityTab, setIdentityTab] = useState<"face" | "id">("face");
  const duplicate = useStaffIdDuplicateCheck(idType, details.number, draftReview);
  const faceComplete = poses.every(([key]) => Boolean(files[key]));
  const idComplete = Boolean(files.id_front);

  function openIdViewer(trigger: HTMLButtonElement) {
    activeImageTriggerRef.current = trigger;
    const viewer = idViewerRef.current;
    if (!viewer) return;
    if (!viewer.open) viewer.showModal();
    idViewerCloseRef.current?.focus();
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/staff/${userId}/identity`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => { if (active) { setRegistered(data.registered); setIdentityStatus(typeof data.status === "string" ? data.status : null); } })
      .catch(() => { if (active) setMessage("Could not load identity status."); });
    return () => { active = false; };
  }, [userId]);

  async function save() {
    const keys = ["id_front", ...poses.map(([key]) => key), ...(files.id_back ? ["id_back"] : [])];
    if (keys.some((key) => !files[key] || files[key].size > 2 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(files[key].type))) {
      setMessage("Add an ID front and three face images (JPEG or PNG, up to 2 MB each).");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const entries = await Promise.all(keys.map(async (key) => {
        const value = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read an image."));
          reader.onerror = () => reject(new Error("Could not read an image."));
          reader.readAsDataURL(files[key]);
        });
        return [key, value];
      }));
      const response = await fetch(`/api/admin/staff/${userId}/identity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_type: idType, ...Object.fromEntries(entries), ...(draftReview ? { details } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save identity.");
      setFiles({}); setRegistered(true); setIdentityStatus(typeof data.status === "string" ? data.status : "awaiting_review"); setOpen(false); setDraftReview(false); setMessage("Images and details saved for review.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save identity."); }
    finally { setBusy(false); }
  }

  async function loadReview() {
    setReviewOpen(true); setMessage(""); setReview(null);
    setUpdateSuccess(false);
    try {
      const response = await fetch(`/api/admin/staff/${userId}/identity?review=1`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load ID.");
      setReview(data);
      setDetails(data.details ?? { name: "", number: "", birth_date: "" });
      setDetailsLocked(Boolean(data.details));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load ID."); }
  }

  async function saveDetails() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/staff/${userId}/identity`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(details) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save ID details.");
      setMessage("ID details saved. This does not approve or verify the ID.");
      setDetailsLocked(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save ID details."); }
    finally { setBusy(false); }
  }

  async function scanId() {
    if (!files.id_front || !files.face_front) {
      setScan({ error: "Add the front ID image and capture a front face photo first." });
      return;
    }
    setScanning(true); setScan(null);
    try {
      const form = new FormData();
      form.set("image", files.id_front);
      form.set("face", files.face_front);
      form.set("name", name);
      form.set("type", idType);
      const response = await fetch("/api/admin/staff/id-scan", { method: "POST", body: form });
      const data = await response.json();
      setScan(response.ok ? data : { error: data.error || "Could not scan the ID." });
      if (response.ok && data.outcome !== "mismatch" && data.face_match === "matched" && !(data.suggestions?.name && data.name_evidence !== "found")) {
        setDetails(data.suggestions ?? { name: "", number: "", birth_date: "" }); setDraftReview(true);
      }
    } catch { setScan({ error: "Could not scan the ID. Please try again." }); }
    finally { setScanning(false); }
  }

  return (
    <div className="staff-identity-group">
      <h4>Identity registration</h4>
      <p>{registered === null ? "Checking status…" : registered ? identityStatus === "verified" ? "Identity status · Verified" : "Images on file · awaiting review" : "ID and face photos not registered."}</p>
      {message && (updateSuccess
        ? <StaffIdentityUpdateSuccess
            title="ID update verified and saved"
            message="The new ID matched the registered face. The staff member must complete a fresh duty face check when face checking is enabled."
          />
        : <p role="status">{message}</p>)}
      {registered === false && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setMessage(""); setIdentityTab("face"); setOpen(true); }}>Register ID and face</button>}
      {registered === true && <button type="button" className="btn btn-outline btn-sm" onClick={() => void loadReview()}>Review ID details</button>}
      {open && draftReview && (
        <div className="modal-backdrop staff-face-popup-backdrop" style={{ zIndex: 1101 }}>
          <section className="modal staff-id-popup" role="dialog" aria-modal="true" aria-label={`Review scanned ID for ${name}`}>
            <div className="modal-head"><h2>ID review — {name}</h2><button type="button" disabled={busy} aria-label="Close review and return to profile" onClick={() => { setDraftReview(false); setOpen(false); setFiles({}); setScan(null); }}>×</button></div>
            <div className="modal-body staff-id-popup-body">
              <p>Awaiting review · {idType.replaceAll("_", " ")}</p>
              <div className="staff-create-grid">{([["id_front", "Front of ID"], ["id_back", "Back of ID"]] as const).map(([key, label]) => <div className="staff-identity-id-side" key={key}><strong>{label}</strong>{files[key] ? <StaffFacePhotoPreview file={files[key]} label={label} /> : <p>Not provided</p>}</div>)}</div>
              <div className="staff-identity-group">
                <h4>Review ID details</h4>
                <p>OCR suggestions may be incomplete or incorrect. Compare each field with the ID and correct it before saving.</p>
                <label className="field"><span className="label">Name on ID</span><input className="input" maxLength={120} value={details.name} onChange={(e) => setDetails((current) => ({ ...current, name: e.target.value }))} /></label>
                <label className="field"><span className="label">ID number</span><input className="input" maxLength={80} value={details.number} onChange={(e) => setDetails((current) => ({ ...current, number: e.target.value }))} /></label>
                <label className="field"><span className="label">Date of birth</span><input className="input" type="date" value={details.birth_date} onChange={(e) => setDetails((current) => ({ ...current, birth_date: e.target.value }))} /></label>
              </div>
              <div className="staff-identity-group">
                <h4>Scan checks</h4>
                <div className="staff-id-checks">
                  {[
                    ["ID type", scan?.outcome === "match" ? staffIdCheckLabel("pass") : scan?.outcome === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ["Name on ID", checkStaffIdName(details.name, name) === "pass" ? staffIdCheckLabel("pass") : checkStaffIdName(details.name, name) === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ["Face comparison", scan?.face_match === "matched" ? staffIdCheckLabel("pass") : scan?.face_match === "rejected" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ["Details reviewed", staffIdCheckLabel("unknown")],
                    ["Duplicate ID", duplicate === "checking" ? "Checking…" : staffIdCheckLabel(duplicate === "unique" ? "pass" : duplicate === "duplicate" ? "problem" : "unknown")],
                    ["ID number format", checkStaffIdNumber(details.number, idType) === "pass" ? staffIdCheckLabel("pass") : checkStaffIdNumber(details.number, idType) === "mismatch" ? staffIdCheckLabel("check") : staffIdCheckLabel("unknown")],
                  ].map(([label, status]) => <div className="staff-id-check" key={label}><strong>{label}</strong><span>{status}</span></div>)}
                </div>
                {duplicate === "duplicate" && <p className="field-error" role="alert">This ID number is already attached to another staff account.</p>}
                <p>These results do not prove authenticity or approve the ID.</p>
              </div>
              {message && <p role="alert">{message}</p>}
              <div className="staff-id-popup-actions"><button type="button" className="btn btn-outline" disabled={busy} onClick={() => setDraftReview(false)}>Back</button><button type="button" className="btn btn-primary" disabled={busy || !details.name.trim()} onClick={() => { if (window.confirm("Save the identity images and lock these ID details? They cannot be edited afterwards.")) void save(); }}>{busy ? "Saving…" : "Save ID details and images"}</button></div>
            </div>
          </section>
        </div>
      )}
      {reviewOpen && (
        <div className="modal-backdrop staff-face-popup-backdrop">
          <section className="modal staff-id-popup" role="dialog" aria-modal="true" aria-label={`Review ID for ${name}`}>
            <div className="modal-head"><h2>ID review — {name}</h2><button type="button" onClick={() => { setReviewOpen(false); setReview(null); setDetails({ name: "", number: "", birth_date: "" }); setMessage(""); }} aria-label="Close ID review">×</button></div>
            <div className="modal-body staff-id-popup-body">
              {!review && <p role="status">{message || "Loading ID…"}</p>}
              {review && <>
                <p>{review.status === "verified" ? "Verified" : detailsLocked ? "Saved for review" : review.status.replaceAll("_", " ")} · {review.id_type?.replaceAll("_", " ") || "ID type not recorded"}</p>
                <div className="staff-create-grid">
                  {([["Front of ID", review.id_front], ["Back of ID", review.id_back]] as const).map(([label, image]) => <div className="staff-identity-id-side" key={label}><strong>{label}</strong>{image ? <button type="button" className="staff-profile-id-view-trigger" aria-label={`View ${label.toLowerCase()}`} onClick={(event) => openIdViewer(event.currentTarget)}><Image src={image} alt={label} width={400} height={250} unoptimized style={{ width: "100%", height: "auto", objectFit: "contain" }} /></button> : <p>Not provided</p>}</div>)}
                </div>
                <div className="staff-identity-group">
                  <h4>Review ID details</h4>
                  <p>Check the document and enter or correct its details.</p>
                  <label className="field"><span className="label">Name on ID</span><input className="input" readOnly={detailsLocked} maxLength={120} value={details.name} onChange={(e) => setDetails((current) => ({ ...current, name: e.target.value }))} /></label>
                  <label className="field"><span className="label">ID number</span><input className="input" readOnly={detailsLocked} maxLength={80} value={details.number} onChange={(e) => setDetails((current) => ({ ...current, number: e.target.value }))} /></label>
                  <label className="field"><span className="label">Date of birth</span><input className="input" readOnly={detailsLocked} type="date" value={details.birth_date} onChange={(e) => setDetails((current) => ({ ...current, birth_date: e.target.value }))} /></label>
                  {detailsLocked ? <p>These details are saved and cannot be edited.</p> : <button type="button" className="btn btn-primary btn-sm" disabled={busy || !details.name.trim() || duplicate === "duplicate"} onClick={() => { if (window.confirm("Save these details permanently? They cannot be edited afterwards.")) void saveDetails(); }}>{busy ? "Saving…" : "Save ID details"}</button>}
                  {message && <p role="status">{message}</p>}
                </div>
                <div className="staff-identity-group">
                  <h4>ID checks</h4>
                  <p>Use these as a guide and compare the document before deciding.</p>
                  <div className="staff-id-checks">
                    {[
                        ["ID type", staffIdCheckLabel(staffIdentityReviewCheck(review.status))],
                      ["Details reviewed", detailsLocked ? staffIdCheckLabel("pass") : staffIdCheckLabel("unknown")],
                        ["Face comparison", staffIdCheckLabel(staffIdentityReviewCheck(review.status))],
                      ["Duplicate ID", review.duplicate_checked ? staffIdCheckLabel("pass") : staffIdCheckLabel("unknown")],
                      ["Name", !detailsLocked ? staffIdCheckLabel("unknown") : checkStaffIdName(details.name, name) === "pass" ? staffIdCheckLabel("pass") : checkStaffIdName(details.name, name) === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                      ["ID number format", !detailsLocked ? staffIdCheckLabel("unknown") : checkStaffIdNumber(details.number, review.id_type ?? "") === "pass" ? staffIdCheckLabel("pass") : checkStaffIdNumber(details.number, review.id_type ?? "") === "mismatch" ? staffIdCheckLabel("check") : staffIdCheckLabel("unknown")],
                    ].map(([label, status]) => <div className="staff-id-check" key={label}><strong>{label}</strong><span>{status}</span></div>)}
                  </div>
                  {detailsLocked ? (
                    <div className="staff-id-update-actions">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => { setReviewOpen(false); setIdUpdateOpen(true); }}>
                        Update ID
                      </button>
                    </div>
                  ) : <p>Save and review the current ID details before updating the ID.</p>}
                </div>
              </>}
            </div>
            {review && (
              <dialog
                ref={idViewerRef}
                className="staff-profile-id-viewer"
                aria-labelledby="admin-staff-id-viewer-title"
                onClick={(event) => {
                  if (event.target === event.currentTarget) event.currentTarget.close();
                }}
                onClose={() => activeImageTriggerRef.current?.focus()}
              >
                <div className="modal-head">
                  <h2 id="admin-staff-id-viewer-title">
                    ID — {details.name || name}
                  </h2>
                  <button
                    ref={idViewerCloseRef}
                    type="button"
                    aria-label="Close ID viewer"
                    onClick={() => idViewerRef.current?.close()}
                  >
                    ×
                  </button>
                </div>
                <div className="staff-profile-id-viewer-body">
                  <p>
                    {review.status === "verified" ? "Verified" : detailsLocked ? "Saved for review" : review.status.replaceAll("_", " ")} · {review.id_type?.replaceAll("_", " ") || "ID type not recorded"}
                  </p>
                  <div className="staff-profile-id-viewer-images">
                    <figure>
                      <figcaption>Front of ID</figcaption>
                      <Image src={review.id_front} alt="Front of staff ID" width={1280} height={800} unoptimized />
                    </figure>
                    <figure>
                      <figcaption>Back of ID</figcaption>
                      {review.id_back ? (
                        <Image src={review.id_back} alt="Back of staff ID" width={1280} height={800} unoptimized />
                      ) : <p className="staff-profile-id-missing">No back image was provided.</p>}
                    </figure>
                  </div>
                  <div className="account-profile-details staff-profile-details">
                    <div><span>Name on ID</span><strong>{details.name || "Not provided"}</strong></div>
                    <div><span>ID number</span><strong>{details.number || "Not provided"}</strong></div>
                    <div><span>Date of birth</span><strong>{details.birth_date || "Not provided"}</strong></div>
                  </div>
                </div>
              </dialog>
            )}
          </section>
        </div>
      )}
      {idUpdateOpen && <StaffIdentityUpdate
        userId={userId}
        name={name}
        onClose={() => setIdUpdateOpen(false)}
        onUpdated={() => {
          setIdUpdateOpen(false);
          setUpdateSuccess(true);
          setMessage("ID updated. The staff member must verify their face again.");
        }}
      />}
      {open && (
        <div className="modal-backdrop staff-face-popup-backdrop">
          <section className="modal staff-id-popup" role="dialog" aria-modal="true" aria-label={`Register identity for ${name}`}>
            <div className="modal-head"><h2>Register identity — {name}</h2><button type="button" disabled={busy} onClick={() => { setOpen(false); setCamera(false); }} aria-label="Close"><span aria-hidden="true">×</span></button></div>
            <div className="modal-body staff-id-popup-body">
              <p>Capture the ID and face photos, then scan the ID for review.</p>
              <div className="staff-identity-tabs" role="tablist" aria-label="Identity sections">
                <button type="button" role="tab" id="identity-tab-face" aria-selected={identityTab === "face"} aria-controls="identity-panel-face" onClick={() => setIdentityTab("face")}>Face photos</button>
                <button type="button" role="tab" id="identity-tab-id" aria-selected={identityTab === "id"} aria-controls="identity-panel-id" onClick={() => setIdentityTab("id")}>Staff ID</button>
              </div>
              <div role="tabpanel" id="identity-panel-id" aria-labelledby="identity-tab-id" hidden={identityTab !== "id"}>
              <label className="field"><span className="label">Kind of ID</span><select className="select" value={idType} disabled={scanning} onChange={(e) => { setIdType(e.target.value); setScan(null); }}><option value="philsys">PhilSys National ID</option><option value="drivers_license">Driver’s license</option><option value="passport">Passport</option><option value="postal">Postal ID</option><option value="voter">Voter’s ID</option><option value="philhealth">PhilHealth ID</option><option value="other">Other government ID</option></select></label>
              {([["id_front", "ID front (required)"], ["id_back", "ID back (optional)"]] as const).map(([key, label]) => (
                <div className="staff-identity-id-side" key={key}>
                  <strong>{label}</strong>
                  <div className="staff-id-side-content">
                    <div className="staff-id-preview">
                      {files[key] ? <StaffFacePhotoPreview file={files[key]} label={label} /> : <span>No image selected</span>}
                    </div>
                    <div>
                      {files[key] && <p>{files[key].name}</p>}
                      <label className="staff-identity-id-upload">Choose image
                        <input type="file" accept="image/jpeg,image/png" disabled={scanning} aria-label={label} onChange={(e) => { const file = e.target.files?.[0]; if (file) { setScan(null); setFiles((current) => ({ ...current, [key]: file })); } }} />
                      </label>
                      <label className="staff-identity-id-upload">{files[key] ? "Retake with camera" : "Use camera"}
                        <input type="file" accept="image/jpeg,image/png" capture="environment" disabled={scanning} aria-label={`Capture ${label}`} onChange={(e) => { const file = e.target.files?.[0]; if (file) { setScan(null); setFiles((current) => ({ ...current, [key]: file })); } }} />
                      </label>
                      {files[key] && <button type="button" className="btn btn-ghost btn-sm" disabled={scanning} onClick={() => { setScan(null); setFiles((current) => { const next = { ...current }; delete next[key]; return next; }); }}>Remove</button>}
                    </div>
                  </div>
                </div>
              ))}
              <p className="tiny">Scanning sends the ID to OCR.space and the ID and face photo to Face++. Obtain the staff member’s permission first.</p>
              <button type="button" className="btn btn-outline" disabled={scanning || busy} onClick={() => void scanId()}>{scanning ? "Scanning…" : "Scan ID and face"}</button>
              {scan && (scan.error ? <div className="staff-id-scan-result is-warning" role="status">{scan.error}</div> : scan.face_match === "rejected" ? (
                <div className="staff-id-scan-result is-warning" role="alert">
                  The face on this ID does not match the staff photo. The ID was not saved. Check the images and try again.
                </div>
              ) : scan.outcome === "mismatch" ? (
                <div className="staff-id-scan-result is-warning" role="alert">
                  The ID type does not match your selection. Check the ID and choose the correct type, then scan again.
                </div>
              ) : (
                <div className="staff-identity-group" role="status">
                  <h4>ID checks</h4>
                  <p>Review these results before saving.</p>
                  <div className="staff-id-checks">
                    {([
                      { label: "ID type", tone: scan.outcome === "match" ? "pass" : scan.outcome === "mismatch" ? "problem" : "check", detail: scan.outcome === "match" ? "The ID type matches your selection." : scan.outcome === "mismatch" ? `Detected ${scan.detected_type?.replaceAll("_", " ")}. Check your selection.` : "Could not identify the ID type." },
                      { label: "Name", tone: "check", detail: scan.name_evidence === "found" ? "Name words found. Check the ID." : "Name could not be confirmed." },
                      { label: "Face match", tone: scan.face_match === "matched" ? "pass" : scan.face_match === "rejected" ? "problem" : "check", detail: scan.face_match === "matched" ? "The photos appear to match." : scan.face_match === "rejected" ? "Photos did not match. Retake or review." : "Face comparison unavailable." },
                    ] satisfies { label: string; tone: StaffIdCheckTone; detail: string }[]).map((item) => <div className="staff-id-result-card" key={item.label}><div><strong>{item.label}</strong><span className={`staff-id-result-badge ${item.tone === "problem" ? "mismatch" : item.tone === "check" ? "review" : "pass"}`}>{staffIdCheckLabel(item.tone)}</span></div><p>{item.detail}</p></div>)}
                  </div>
                  <p className="tiny">These checks do not prove the ID is genuine or approve the account.</p>
                </div>
              ))}
              </div>
              <div role="tabpanel" id="identity-panel-face" aria-labelledby="identity-tab-face" hidden={identityTab !== "face"}>
              <button type="button" className="btn btn-outline" disabled={scanning} onClick={() => { setRetake(null); setCamera(true); }}>{files.face_front ? "Retake face" : "Register face"}</button>
              <div className="staff-identity-poses">{poses.map(([key, label], index) => <div className="staff-identity-upload" key={key}><span className={`staff-identity-step${files[key] ? " is-passed" : ""}`}>{files[key] ? "✓" : index + 1}</span><strong>{label}</strong>{files[key] ? <><StaffFacePhotoPreview file={files[key]} label={label} /><button type="button" className="btn btn-outline btn-sm" disabled={scanning} onClick={() => { setRetake(index); setCamera(true); }}>Retake</button></> : <span>Not captured</span>}</div>)}</div>
              </div>
              {message && <p role="alert">{message}</p>}
              {faceComplete && idComplete ? (
                <button type="button" className="btn btn-primary" disabled={busy || scanning} onClick={() => void save()}>{busy ? "Saving…" : "Save identity images"}</button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={busy || scanning} onClick={() => { setMessage(""); setIdentityTab(!faceComplete ? "face" : "id"); }}>
                  {!faceComplete ? "Next: Complete face photos" : "Next: Add staff ID"}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      {open && camera && <div className="modal-backdrop staff-face-popup-backdrop" style={{ zIndex: 1101 }}><section className="modal staff-face-popup" role="dialog" aria-modal="true" aria-label="Register face"><StaffFaceCamera initialStep={retake ?? 0} singlePose={retake !== null} completedPoses={poses.filter(([key]) => Boolean(files[key])).map(([key]) => key)} onClose={() => setCamera(false)} onCapture={(key, file) => { setScan(null); setFiles((current) => ({ ...current, [key]: file })); }} /></section></div>}
    </div>
  );
}
