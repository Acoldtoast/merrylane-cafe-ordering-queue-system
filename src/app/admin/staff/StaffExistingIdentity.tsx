"use client";

import { useEffect, useRef, useState } from "react";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { StaffFaceCamera } from "./StaffFaceCamera";
import { StaffFacePhotoPreview } from "./StaffFacePhotoPreview";
import Image from "next/image";
import {
  checkStaffIdBirthDate,
  checkStaffIdExpiration,
  checkStaffIdName,
  checkStaffIdNumber,
  isStaffIdentityScanVerified,
  staffIdExpirationWarning,
  staffIdRequiresExpirationDate,
} from "@/lib/staffIdChecks";
import { staffIdCheckLabel, type StaffIdCheckTone } from "@/lib/staffIdCheckLabels";
import { useStaffIdDuplicateCheck } from "@/lib/useStaffIdDuplicateCheck";

const poses = [["face_front", "Straight on"], ["face_left", "Turn left"], ["face_right", "Turn right"]] as const;

export function StaffExistingIdentity({ userId, name }: { userId: number; name: string }) {
  const idFrontInput = useRef<HTMLInputElement>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [identityStatus, setIdentityStatus] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [retake, setRetake] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<{ outcome?: string; detected_type?: string | null; name_evidence?: string; face_match?: string; verification_token?: string; error?: string } | null>(null);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [idType, setIdType] = useState("philsys");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<{ id_front: string; id_back: string | null; id_type: string | null; status?: string; duplicate_checked?: boolean } | null>(null);
  const [details, setDetails] = useState({
    name: "",
    number: "",
    birth_date: "",
    expiration_date: "",
  });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [detailsLocked, setDetailsLocked] = useState(false);
  const [draftReview, setDraftReview] = useState(false);
  const [detailsReviewed, setDetailsReviewed] = useState(false);
  const [reviewDetailsConfirmed, setReviewDetailsConfirmed] = useState(false);
  const [identityTab, setIdentityTab] = useState<"face" | "id">("face");
  const duplicate = useStaffIdDuplicateCheck(idType, details.number, draftReview || (reviewOpen && !detailsLocked));
  const reviewDetailsValid =
    Boolean(review) &&
    checkStaffIdName(details.name, name) === "pass" &&
    checkStaffIdNumber(details.number, idType) === "pass" &&
    checkStaffIdBirthDate(details.birth_date) === "pass" &&
    checkStaffIdExpiration(details.expiration_date, idType) === "pass" &&
    duplicate === "unique" &&
    reviewDetailsConfirmed;
  const faceComplete = poses.every(([key]) => Boolean(files[key]));
  const idComplete = Boolean(files.id_front);
  const scanEvidenceReady =
    isStaffIdentityScanVerified(scan?.outcome, scan?.face_match) ||
    (idType === "other" &&
      scan?.outcome === "uncertain" &&
      scan?.face_match === "matched" &&
      Boolean(scan?.verification_token));
  const scanVerified =
    scanEvidenceReady &&
    (idType !== "other" || detailsReviewed) &&
    Boolean(scan?.verification_token);
  const detailsValid =
    checkStaffIdName(details.name, name) === "pass" &&
    checkStaffIdNumber(details.number, idType) === "pass" &&
    checkStaffIdBirthDate(details.birth_date) === "pass" &&
    checkStaffIdExpiration(details.expiration_date, idType) === "pass";
  const expirationWarning = staffIdExpirationWarning(
    details.expiration_date,
    review?.id_type ?? idType
  );
  const canSaveIdentity =
    faceComplete &&
    idComplete &&
    scanVerified &&
    detailsValid &&
    detailsReviewed &&
    duplicate === "unique";
  useEffect(() => {
    let active = true;
    fetch(`/api/admin/staff/${userId}/identity`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => { if (active) { setRegistered(data.registered); setIdentityStatus(typeof data.status === "string" ? data.status : null); } })
      .catch(() => { if (active) setMessage("Could not load identity status."); });
    return () => { active = false; };
  }, [userId]);

  function closeRegistration() {
    setOpen(false);
    setCamera(false);
    setRetake(null);
    setDraftReview(false);
    setDetailsReviewed(false);
    setScan(null);
    setFiles({});
    setIdType("philsys");
    setDetails({ name: "", number: "", birth_date: "", expiration_date: "" });
    setMessage("");
  }

  async function save() {
    if (!scanVerified || !detailsValid || !detailsReviewed || duplicate !== "unique") {
      setMessage("Every ID type, face, detail, review, and duplicate-ID check must pass before saving.");
      return;
    }
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
      const response = await fetch(`/api/admin/staff/${userId}/identity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id_type: idType, ...Object.fromEntries(entries), details, details_reviewed: detailsReviewed, identity_verification_token: scan?.verification_token }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save identity.");
      setFiles({}); setScan(null); setDetailsReviewed(false); setRegistered(true); setIdentityStatus(typeof data.status === "string" ? data.status : "verified"); setOpen(false); setDraftReview(false); setMessage("ID type and face checks passed. Identity status is verified.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save identity."); }
    finally { setBusy(false); }
  }

  async function loadReview() {
    setReviewOpen(true); setMessage(""); setReview(null);
    try {
      const response = await fetch(`/api/admin/staff/${userId}/identity?review=1`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load ID.");
      setReview(data);
      setIdType(data.id_type ?? "other");
      setDetails({
        name: data.details?.name ?? "",
        number: data.details?.number ?? "",
        birth_date: data.details?.birth_date ?? "",
        expiration_date: data.details?.expiration_date ?? "",
      });
      setDetailsLocked(Boolean(data.details));
      setReviewDetailsConfirmed(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load ID."); }
  }

  async function saveDetails() {
    if (!reviewDetailsValid) {
      setMessage("Every ID detail check must pass and the document must be reviewed before saving.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/staff/${userId}/identity`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...details, details_reviewed: reviewDetailsConfirmed }) });
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
    setScanning(true); setScan(null); setDraftReview(false); setDetailsReviewed(false);
    try {
      const form = new FormData();
      form.set("image", files.id_front);
      form.set("face", files.face_front);
      form.set("name", name);
      form.set("type", idType);
      const response = await fetch("/api/admin/staff/id-scan", { method: "POST", body: form });
      const data = await response.json();
      setScan(response.ok ? data : { error: data.error || "Could not scan the ID." });
      const manualTypeReviewRequired =
        idType === "other" &&
        data.outcome === "uncertain" &&
        data.face_match === "matched" &&
        typeof data.verification_token === "string";
      if (response.ok && (isStaffIdentityScanVerified(data.outcome, data.face_match) || manualTypeReviewRequired) && typeof data.verification_token === "string") {
        setDetails(data.suggestions ?? { name: "", number: "", birth_date: "", expiration_date: "" });
      }
    } catch { setScan({ error: "Could not scan the ID. Please try again." }); }
    finally { setScanning(false); }
  }

  function startFaceCapture() {
    setMessage("");
    setIdentityTab("face");
    setRetake(null);
    setCamera(true);
  }

  function handlePrimaryAction() {
    setMessage("");
    if (!faceComplete) {
      startFaceCapture();
      return;
    }
    if (!idComplete) {
      if (identityTab === "id") idFrontInput.current?.click();
      else setIdentityTab("id");
      return;
    }
    if (!scanEvidenceReady) {
      setIdentityTab("id");
      void scanId();
      return;
    }
    if (!draftReview) {
      setDraftReview(true);
      return;
    }
    void save();
  }

  const primaryActionLabel = !faceComplete
    ? "Register face"
    : !idComplete
      ? identityTab === "id" ? "Add staff ID" : "Register staff ID"
      : scanning
        ? "Scanning ID…"
        : !scanEvidenceReady
          ? "Scan ID"
          : !draftReview
            ? "Confirm ID details"
            : busy ? "Saving…" : "Save verified identity";

  return (
    <div className="staff-identity-group">
      <h4>Identity registration</h4>
      <p>{registered === null ? "Checking status…" : registered ? identityStatus === "verified" ? "Identity status · Verified" : "Images on file · awaiting review" : "ID and face photos not registered."}</p>
      {message && <p role="status">{message}</p>}
      {registered === false && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setMessage(""); setIdentityTab("face"); setOpen(true); }}>Register ID and face</button>}
      {registered === true && <button type="button" className="btn btn-outline btn-sm" onClick={() => void loadReview()}>Review ID details</button>}
      {open && draftReview && (
        <div className="modal-backdrop staff-face-popup-backdrop" style={{ zIndex: 1101 }}>
          <section className="modal staff-id-popup" role="dialog" aria-modal="true" aria-label={`Review scanned ID for ${name}`}>
            <div className="modal-head"><h2>ID review — {name}</h2><button type="button" disabled={busy} aria-label="Close review and return to profile" onClick={closeRegistration}>×</button></div>
            <div className="modal-body staff-id-popup-body">
              <p>{scanEvidenceReady ? `Scan checks complete · ${idType.replaceAll("_", " ")}` : `Verification required · ${idType.replaceAll("_", " ")}`}</p>
              <div className="staff-create-grid">{([["id_front", "Front of ID"], ["id_back", "Back of ID"]] as const).map(([key, label]) => <div className="staff-identity-id-side" key={key}><strong>{label}</strong>{files[key] ? <StaffFacePhotoPreview file={files[key]} label={label} /> : <p>Not provided</p>}</div>)}</div>
              <div className="staff-identity-group">
                <h4>Review ID details</h4>
                <p>OCR suggestions may be incomplete or incorrect. Compare each field with the ID and correct it before saving.</p>
                <label className="field"><span className="label">Name on ID (required)</span><input className="input" required maxLength={120} value={details.name} onChange={(e) => { setDetailsReviewed(false); setDetails((current) => ({ ...current, name: e.target.value })); }} /></label>
                <label className="field"><span className="label">ID number (required)</span><input className="input" required maxLength={80} value={details.number} onChange={(e) => { setDetailsReviewed(false); setDetails((current) => ({ ...current, number: e.target.value })); }} /></label>
                <label className="field"><span className="label">Date of birth (if shown)</span><input className="input" type="date" value={details.birth_date} onChange={(e) => { setDetailsReviewed(false); setDetails((current) => ({ ...current, birth_date: e.target.value })); }} /></label>
                <label className="field"><span className="label">Expiration date{staffIdRequiresExpirationDate(idType) ? " (required)" : " (if shown)"}</span><input className="input" type="date" required={staffIdRequiresExpirationDate(idType)} value={details.expiration_date} onChange={(e) => { setDetailsReviewed(false); setDetails((current) => ({ ...current, expiration_date: e.target.value })); }} /></label>
              </div>
              <div className="staff-identity-group">
                <h4>Scan checks</h4>
                <div className="staff-id-checks">
                  {[
                    ["ID type", scan?.outcome === "match" || (idType === "other" && scan?.outcome === "uncertain" && detailsReviewed) ? staffIdCheckLabel("pass") : scan?.outcome === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ["Name on ID", checkStaffIdName(details.name, name) === "pass" ? staffIdCheckLabel("pass") : checkStaffIdName(details.name, name) === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ["Face comparison", scan?.face_match === "matched" ? staffIdCheckLabel("pass") : scan?.face_match === "rejected" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ["Details reviewed", staffIdCheckLabel(detailsReviewed ? "pass" : "unknown")],
                    ["Duplicate ID", duplicate === "checking" ? "Checking…" : staffIdCheckLabel(duplicate === "unique" ? "pass" : duplicate === "duplicate" ? "problem" : "unknown")],
                    ["Date of birth", checkStaffIdBirthDate(details.birth_date) === "pass" ? staffIdCheckLabel("pass") : staffIdCheckLabel("problem")],
                    ["ID number format", checkStaffIdNumber(details.number, idType) === "pass" ? staffIdCheckLabel("pass") : checkStaffIdNumber(details.number, idType) === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("unknown")],
                    ["Expiration date", checkStaffIdExpiration(details.expiration_date, idType) === "pass" ? staffIdCheckLabel("pass") : checkStaffIdExpiration(details.expiration_date, idType) === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                  ].map(([label, status]) => <div className="staff-id-check" key={label}><strong>{label}</strong><span>{status}</span></div>)}
                </div>
                {duplicate === "duplicate" && <p className="field-error" role="alert">This ID number is already attached to another staff account.</p>}
                {expirationWarning && <p className="field-error" role="alert">{expirationWarning === "expired" ? `This ID expired on ${details.expiration_date}. Do not save it; request a replacement.` : expirationWarning === "expires_soon" ? `This ID expires on ${details.expiration_date}. Arrange a replacement before it expires.` : expirationWarning === "invalid" ? "The expiration date is invalid. Correct it using the document." : "This ID type requires an expiration date. Enter it from the document before saving."}</p>}
                {detailsValid && duplicate === "unique" && <label className="field"><span><input type="checkbox" checked={detailsReviewed} onChange={(event) => setDetailsReviewed(event.target.checked)} /> I compared the ID type, name, number, date of birth, and expiration date with the document.</span></label>}
                <p>Automated checks do not prove that the ID is authentic.</p>
              </div>
              {message && <p role="alert">{message}</p>}
              <div className="staff-id-popup-actions"><button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setDraftReview(false); setDetailsReviewed(false); }}>Back</button><button type="button" className="btn btn-primary" disabled={busy || !canSaveIdentity} onClick={() => void save()}>{busy ? "Saving…" : "Save verified identity"}</button></div>
            </div>
          </section>
        </div>
      )}
      {reviewOpen && (
        <div className="modal-backdrop staff-face-popup-backdrop">
          <section className="modal staff-id-popup" role="dialog" aria-modal="true" aria-label={`Review ID for ${name}`}>
            <div className="modal-head"><h2>ID review — {name}</h2><button type="button" onClick={() => { setReviewOpen(false); setReview(null); setDetails({ name: "", number: "", birth_date: "", expiration_date: "" }); setMessage(""); }} aria-label="Close ID review">×</button></div>
            <div className="modal-body staff-id-popup-body">
              {!review && <p role="status">{message || "Loading ID…"}</p>}
              {review && <>
                <p>{review.status === "verified" ? `ID and face checks passed · ${review.id_type?.replaceAll("_", " ") || "Verified"}` : `Awaiting review · ${review.id_type?.replaceAll("_", " ") || "ID type not recorded"}`}</p>
                <div className="staff-create-grid">
                  {([["Front of ID", review.id_front], ["Back of ID", review.id_back]] as const).map(([label, image]) => <div className="staff-identity-id-side" key={label}><strong>{label}</strong>{image ? <Image src={image} alt={label} width={400} height={250} unoptimized style={{ width: "100%", height: "auto", objectFit: "contain" }} /> : <p>Not provided</p>}</div>)}
                </div>
                <div className="staff-identity-group">
                  <h4>Review ID details</h4>
                  <p>Check the document and enter or correct its details. OCR extraction is not yet available here.</p>
                  <label className="field"><span className="label">Name on ID</span><input className="input" readOnly={detailsLocked} maxLength={120} value={details.name} onChange={(e) => { setReviewDetailsConfirmed(false); setDetails((current) => ({ ...current, name: e.target.value })); }} /></label>
                  <label className="field"><span className="label">ID number</span><input className="input" readOnly={detailsLocked} maxLength={80} value={details.number} onChange={(e) => { setReviewDetailsConfirmed(false); setDetails((current) => ({ ...current, number: e.target.value })); }} /></label>
                  <label className="field"><span className="label">Date of birth</span><input className="input" readOnly={detailsLocked} type="date" value={details.birth_date} onChange={(e) => { setReviewDetailsConfirmed(false); setDetails((current) => ({ ...current, birth_date: e.target.value })); }} /></label>
                  <label className="field"><span className="label">Expiration date</span><input className="input" readOnly={detailsLocked} type="date" value={details.expiration_date} onChange={(e) => { setReviewDetailsConfirmed(false); setDetails((current) => ({ ...current, expiration_date: e.target.value })); }} /></label>
                  {expirationWarning && <p className="field-error" role="alert">{expirationWarning === "expired" ? `This ID expired on ${details.expiration_date}. Ask the staff member to submit a replacement.` : expirationWarning === "expires_soon" ? `This ID expires on ${details.expiration_date}. Ask the staff member to submit a replacement before it expires.` : expirationWarning === "invalid" ? "The recorded expiration date is invalid. Correct it using the document." : "An expiration date is required for this ID type but is not recorded."}</p>}
                  {!detailsLocked && <>
                    <label className="field"><span><input type="checkbox" checked={reviewDetailsConfirmed} onChange={(event) => setReviewDetailsConfirmed(event.target.checked)} /> I compared the ID type, name, number, date of birth, and expiration date with the document.</span></label>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy || !reviewDetailsValid} onClick={async () => { if (await confirm("Save these details permanently? They cannot be edited afterwards.")) void saveDetails(); }}>{busy ? "Saving…" : "Save ID details"}</button>
                  </>}
                  {detailsLocked && <p>These details are saved and cannot be edited.</p>}
                  {message && <p role="status">{message}</p>}
                </div>
                <div className="staff-identity-group">
                  <h4>ID checks</h4>
                  <p>Use these as a guide and compare the document before deciding.</p>
                  <div className="staff-id-checks">
                    {[
                      ["ID type", staffIdCheckLabel(detailsLocked || reviewDetailsConfirmed ? "pass" : "unknown")],
                      ["Details reviewed", staffIdCheckLabel(detailsLocked || reviewDetailsConfirmed ? "pass" : "unknown")],
                      ["Face comparison", staffIdCheckLabel(review.status === "verified" ? "pass" : "unknown")],
                      ["Duplicate ID", review.duplicate_checked || (!detailsLocked && duplicate === "unique") ? staffIdCheckLabel("pass") : duplicate === "duplicate" ? staffIdCheckLabel("problem") : staffIdCheckLabel("unknown")],
                      ["Name", checkStaffIdName(details.name, name) === "pass" ? staffIdCheckLabel("pass") : checkStaffIdName(details.name, name) === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                      ["Date of birth", checkStaffIdBirthDate(details.birth_date) === "pass" ? staffIdCheckLabel("pass") : staffIdCheckLabel("problem")],
                      ["ID number format", checkStaffIdNumber(details.number, review.id_type ?? "") === "pass" ? staffIdCheckLabel("pass") : checkStaffIdNumber(details.number, review.id_type ?? "") === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("unknown")],
                      ["Expiration date", checkStaffIdExpiration(details.expiration_date, review.id_type ?? "") === "pass" ? staffIdCheckLabel("pass") : checkStaffIdExpiration(details.expiration_date, review.id_type ?? "") === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ].map(([label, status]) => <div className="staff-id-check" key={label}><strong>{label}</strong><span>{status}</span></div>)}
                  </div>
                </div>
              </>}
            </div>
          </section>
        </div>
      )}
      {open && (
        <div className="modal-backdrop staff-face-popup-backdrop">
          <section className="modal staff-id-popup" role="dialog" aria-modal="true" aria-label={`Register identity for ${name}`}>
            <div className="modal-head"><h2>Register identity — {name}</h2><button type="button" disabled={busy || scanning} onClick={closeRegistration} aria-label="Close"><span aria-hidden="true">×</span></button></div>
            <div className="modal-body staff-id-popup-body">
              <p>Capture the ID and face photos, then scan them. Saving requires a matching ID type and face, reviewed ID details, and a passing duplicate-ID check.</p>
              <div className="staff-identity-tabs" role="tablist" aria-label="Identity sections">
                <button type="button" role="tab" id="identity-tab-face" aria-selected={identityTab === "face"} aria-controls="identity-panel-face" onClick={() => setIdentityTab("face")}>Face photos</button>
                <button type="button" role="tab" id="identity-tab-id" aria-selected={identityTab === "id"} aria-controls="identity-panel-id" onClick={() => setIdentityTab("id")}>Staff ID</button>
              </div>
              <div role="tabpanel" id="identity-panel-id" aria-labelledby="identity-tab-id" hidden={identityTab !== "id"}>
              <label className="field"><span className="label">Kind of ID</span><select className="select" value={idType} disabled={scanning} onChange={(e) => { setIdType(e.target.value); setScan(null); setDraftReview(false); setDetailsReviewed(false); }}><option value="philsys">PhilSys National ID</option><option value="drivers_license">Driver’s license</option><option value="passport">Passport</option><option value="postal">Postal ID</option><option value="voter">Voter’s ID</option><option value="philhealth">PhilHealth ID</option><option value="other">Other government ID</option></select></label>
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
                        <input ref={key === "id_front" ? idFrontInput : undefined} type="file" accept="image/jpeg,image/png" disabled={scanning || busy} aria-label={label} onChange={(e) => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (file) { setScan(null); setDraftReview(false); setDetailsReviewed(false); setFiles((current) => ({ ...current, [key]: file })); } }} />
                      </label>
                      {files[key] && <button type="button" className="btn btn-ghost btn-sm" disabled={scanning || busy} onClick={() => { setScan(null); setDraftReview(false); setDetailsReviewed(false); setFiles((current) => { const next = { ...current }; delete next[key]; return next; }); }}>Remove</button>}
                    </div>
                  </div>
                </div>
              ))}
              <p className="tiny">Scanning sends the ID to OCR.space and the ID and face photo to a third-party verification service. Obtain the staff member’s permission first.</p>
              {scan && (!scanEvidenceReady ? (
                <div className="staff-id-scan-result is-warning" role="alert">
                  {scan.error || (scan.face_match === "rejected" ? "The face on this ID does not match the staff photo. Check the images and try again." : scan.outcome !== "match" ? "The ID type could not be verified. Use a clearer image and scan again." : "Face comparison is unavailable. Please try again.")}
                </div>
              ) : (
                <div className="staff-identity-group" role="status">
                  <h4>ID checks</h4>
                  <p>{idType === "other" ? "Face comparison passed. OCR could not classify this ID type; compare it manually during the details review." : "ID type and face matched. Complete the ID details review before saving."}</p>
                  <div className="staff-id-checks">
                    {([
                        { label: "ID type", tone: idType === "other" ? "check" : "pass", detail: idType === "other" ? "OCR could not identify this ID type. Confirm the type manually in the review." : "The ID type matches your selection." },
                      { label: "Face match", tone: "pass", detail: "The face on the ID matched the staff face photo." },
                    ] satisfies { label: string; tone: StaffIdCheckTone; detail: string }[]).map((item) => <div className="staff-id-result-card" key={item.label}><div><strong>{item.label}</strong><span className="staff-id-result-badge pass">{staffIdCheckLabel(item.tone)}</span></div><p>{item.detail}</p></div>)}
                  </div>

                </div>
              ))}
              </div>
              <div role="tabpanel" id="identity-panel-face" aria-labelledby="identity-tab-face" hidden={identityTab !== "face"}>
              <div className="staff-identity-poses">{poses.map(([key, label], index) => <div className="staff-identity-upload" key={key}><span className={`staff-identity-step${files[key] ? " is-passed" : ""}`}>{files[key] ? "✓" : index + 1}</span><strong>{label}</strong>{files[key] ? <><StaffFacePhotoPreview file={files[key]} label={label} /><button type="button" className="btn btn-outline btn-sm" disabled={scanning} onClick={() => { setRetake(index); setCamera(true); }}>Retake</button></> : <span>Not captured</span>}</div>)}</div>
              </div>
              {message && <p role="alert">{message}</p>}
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || scanning || (draftReview && !canSaveIdentity)}
                onClick={handlePrimaryAction}
              >
                {primaryActionLabel}
              </button>
            </div>
          </section>
        </div>
      )}
      {open && camera && <div className="modal-backdrop staff-face-popup-backdrop" style={{ zIndex: 1101 }}><section className="modal staff-face-popup" role="dialog" aria-modal="true" aria-label="Register face"><StaffFaceCamera initialStep={retake ?? poses.findIndex(([key]) => !files[key])} singlePose={retake !== null} completedPoses={poses.filter(([key]) => Boolean(files[key])).map(([key]) => key)} onClose={() => { setCamera(false); setRetake(null); }} onCapture={(key, file) => { setScan(null); setDraftReview(false); setDetailsReviewed(false); setFiles((current) => ({ ...current, [key]: file })); }} /></section></div>}
    {confirmDialog}
    </div>
  );
}
