"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { areStaffIdDetailsPassing, checkStaffIdDetails, staffIdRequiresExpirationDate, type StaffIdDetails } from "@/lib/staffIdChecks";
import { staffIdCheckLabel } from "@/lib/staffIdCheckLabels";
import { useStaffIdDuplicateCheck } from "@/lib/useStaffIdDuplicateCheck";
import { StaffFacePhotoPreview } from "./StaffFacePhotoPreview";

type FacePhotos = {
  face_front: string;
  face_left: string;
  face_right: string;
};

type StoredIdentity = FacePhotos & {
  id_front: string;
  id_back: string | null;
  id_type: string | null;
  details: StaffIdDetails | null;
  revision: string;
};

type IdScan = {
  outcome?: string;
  detected_type?: string | null;
  name_evidence?: string;
  face_match?: string;
  verification_token?: string;
  error?: string;
  suggestions?: StaffIdDetails;
};

const emptyDetails: StaffIdDetails = {
  name: "",
  number: "",
  birth_date: "",
  expiration_date: "",
};

function isFacePhotos(value: unknown): value is FacePhotos {
  return typeof value === "object" && value !== null &&
    "face_front" in value && typeof value.face_front === "string" &&
    "face_left" in value && typeof value.face_left === "string" &&
    "face_right" in value && typeof value.face_right === "string";
}

function isStaffIdDetails(value: unknown): value is StaffIdDetails {
  return typeof value === "object" && value !== null &&
    "name" in value && typeof value.name === "string" &&
    "number" in value && typeof value.number === "string" &&
    "birth_date" in value && typeof value.birth_date === "string" &&
    "expiration_date" in value && typeof value.expiration_date === "string";
}

function isStoredIdentity(value: unknown): value is StoredIdentity {
  if (!isFacePhotos(value) ||
      !("id_front" in value) || typeof value.id_front !== "string" ||
      !("id_back" in value) || (value.id_back !== null && typeof value.id_back !== "string") ||
      !("id_type" in value) || (value.id_type !== null && typeof value.id_type !== "string") ||
      !("details" in value) || !("revision" in value) || typeof value.revision !== "string") {
    return false;
  }
  return value.details === null || isStaffIdDetails(value.details);
}

function responseError(data: unknown, fallback: string) {
  return typeof data === "object" && data !== null &&
    "error" in data && typeof data.error === "string"
    ? data.error
    : fallback;
}

function parseIdScan(data: unknown): IdScan {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("The ID scan returned an invalid response.");
  }
  const result = data as Record<string, unknown>;
  return {
    outcome: typeof result.outcome === "string" ? result.outcome : undefined,
    detected_type: typeof result.detected_type === "string" ? result.detected_type : null,
    name_evidence: typeof result.name_evidence === "string" ? result.name_evidence : undefined,
    face_match: typeof result.face_match === "string" ? result.face_match : undefined,
    verification_token: typeof result.verification_token === "string" ? result.verification_token : undefined,
    error: typeof result.error === "string" ? result.error : undefined,
    suggestions: isStaffIdDetails(result.suggestions) ? result.suggestions : undefined,
  };
}

function isValidImage(file: File) {
  return file.size >= 4 && file.size <= 2 * 1024 * 1024 &&
    ["image/jpeg", "image/png"].includes(file.type);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Could not read the selected ID image."));
    reader.onerror = () => reject(new Error("Could not read the selected ID image."));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("The registered face photo could not be loaded.");
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  return new File([bytes], name, { type: match[1] });
}

function scanIsVerified(scan: IdScan | null, idType: string) {
  return Boolean(
    scan?.verification_token &&
    scan.face_match === "matched" &&
    (scan.outcome === "match" || (idType === "other" && scan.outcome === "uncertain"))
  );
}

function scanMessage(scan: IdScan, verified: boolean) {
  if (scan.error) return scan.error;
  if (scan.face_match === "rejected") return "The ID face does not match the registered staff face. Check the ID and try again.";
  if (scan.outcome === "mismatch") return `The selected ID type does not match${scan.detected_type ? ` the detected ${scan.detected_type.replaceAll("_", " ")}` : ""}. Choose the correct type or a clearer ID image.`;
  if (verified && scan.outcome === "uncertain") return "The registered face matched. OCR could not identify this ID type; compare the document and selected type manually.";
  if (verified) return "The ID type and registered face matched. Review every detail against the new ID.";
  return "The ID and registered face could not be verified. Use a clearer image and try again.";
}

function checkLabel(status: "pass" | "mismatch" | "unknown") {
  return staffIdCheckLabel(status === "pass" ? "pass" : status === "mismatch" ? "problem" : "unknown");
}

export function StaffIdentityUpdate({
  userId,
  name,
  onClose,
  onUpdated,
}: {
  userId: number;
  name: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [idType, setIdType] = useState("philsys");
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [details, setDetails] = useState<StaffIdDetails>(emptyDetails);
  const [detailsReviewed, setDetailsReviewed] = useState(false);
  const [scan, setScan] = useState<IdScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const verifiedScan = scanIsVerified(scan, idType);
  const duplicate = useStaffIdDuplicateCheck(idType, details.number, verifiedScan);
  const detailChecks = checkStaffIdDetails(details, name, idType);
  const detailsValid = areStaffIdDetailsPassing(detailChecks);
  const canSave = Boolean(
    identity && frontFile && isValidImage(frontFile) &&
    (!backFile || isValidImage(backFile)) &&
    verifiedScan && detailsReviewed && detailsValid && duplicate === "unique"
  );

  useEffect(() => {
    const controller = new AbortController();
    async function loadIdentity() {
      try {
        const response = await fetch(`/api/admin/staff/${userId}/identity?review=replace`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data: unknown = await response.json();
        if (!response.ok) throw new Error(responseError(data, "Could not load the current ID."));
        if (!isStoredIdentity(data)) throw new Error("The current identity registration is incomplete.");
        if (!controller.signal.aborted) {
          setIdentity(data);
          setIdType(data.id_type || "philsys");
          setDetails(data.details || emptyDetails);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setLoadError(err instanceof Error ? err.message : "Could not load the current ID.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadIdentity();
    return () => controller.abort();
  }, [userId, loadAttempt]);

  async function scanId() {
    if (!identity || !frontFile || !isValidImage(frontFile)) {
      setError("Choose a valid front image for the new ID first.");
      return;
    }
    setScanning(true);
    setError("");
    setScan(null);
    setDetails(emptyDetails);
    setDetailsReviewed(false);
    try {
      const form = new FormData();
      form.set("image", frontFile);
      form.set("face", dataUrlToFile(identity.face_front, "registered-face.jpg"));
      form.set("name", name);
      form.set("type", idType);
      const response = await fetch("/api/admin/staff/id-scan", { method: "POST", body: form });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(data, "Could not scan the new ID."));
      const result = parseIdScan(data);
      setScan(result);
      if (scanIsVerified(result, idType) && result.suggestions) {
        setDetails(result.suggestions);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not scan the new ID. Please try again.");
    } finally {
      setScanning(false);
    }
  }

  async function saveUpdate() {
    if (!identity || !frontFile || !scan?.verification_token || !canSave) {
      setError("Choose and verify the new ID, review its details, and resolve the duplicate-ID check before saving.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const [idFront, idBack] = await Promise.all([
        fileToDataUrl(frontFile),
        backFile ? fileToDataUrl(backFile) : Promise.resolve(null),
      ]);
      const response = await fetch(`/api/admin/staff/${userId}/identity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replacing: "id",
          revision: identity.revision,
          id_type: idType,
          id_front: idFront,
          ...(idBack ? { id_back: idBack } : {}),
          face_front: identity.face_front,
          face_left: identity.face_left,
          face_right: identity.face_right,
          details,
          details_reviewed: true,
          identity_verification_token: scan.verification_token,
        }),
      });
      const data: unknown = await response.json();
      if (!response.ok ||
          typeof data !== "object" || data === null ||
          !("success" in data) || data.success !== true) {
        throw new Error(responseError(data, "Could not update the staff ID."));
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the staff ID.");
    } finally {
      setSaving(false);
    }
  }

  function changeIdType(value: string) {
    setIdType(value);
    setScan(null);
    setDetails(emptyDetails);
    setDetailsReviewed(false);
  }

  function setImage(side: "front" | "back", file: File | null) {
    if (side === "front") setFrontFile(file);
    else setBackFile(file);
    setScan(null);
    setDetails(emptyDetails);
    setDetailsReviewed(false);
    setError("");
  }

  const scanVerified = verifiedScan;
  return (
    <div className="modal-backdrop staff-face-popup-backdrop" style={{ zIndex: 1101 }}>
      <section className="modal staff-id-popup" role="dialog" aria-modal="true" aria-label={`Update ID for ${name}`}>
        <div className="modal-head">
          <div><span className="eyebrow">Identity registration</span><h2>Update ID — {name}</h2></div>
          <button type="button" disabled={saving} aria-label="Close ID update" onClick={onClose}>×</button>
        </div>
        <div className="modal-body staff-id-popup-body">
          {loading && <p role="status">Loading the current ID…</p>}
          {loadError && <div role="alert"><p>{loadError}</p><button type="button" className="btn btn-outline btn-sm" onClick={() => { setLoadError(""); setLoading(true); setLoadAttempt((attempt) => attempt + 1); }}>Try again</button></div>}
          {identity && <>
            <p>Choose the new ID type and upload its front. The back is optional; if you leave it blank, the previous back image will be removed. The new ID and registered face photo are sent to OCR.space and Face++ for verification. Obtain the staff member’s permission first.</p>
            <div className="staff-create-grid">
              {([["Front of current ID", identity.id_front], ["Back of current ID", identity.id_back]] as const).map(([label, image]) => (
                <div className="staff-identity-id-side" key={label}>
                  <strong>{label}</strong>
                  {image ? <Image src={image} alt={label} width={400} height={250} unoptimized style={{ width: "100%", height: "auto", objectFit: "contain" }} /> : <p>Not provided</p>}
                </div>
              ))}
            </div>
            <label className="field">
              <span className="label">Kind of new ID</span>
              <select className="select" value={idType} disabled={scanning || saving} onChange={(event) => changeIdType(event.target.value)}>
                <option value="philsys">PhilSys National ID</option>
                <option value="drivers_license">Driver’s license</option>
                <option value="passport">Passport</option>
                <option value="postal">Postal ID</option>
                <option value="voter">Voter’s ID</option>
                <option value="philhealth">PhilHealth ID</option>
                <option value="other">Other government ID</option>
              </select>
            </label>
            {([
              { side: "front", title: "Front of new ID (required)", file: frontFile },
              { side: "back", title: "Back of new ID (optional)", file: backFile },
            ] as const).map(({ side, title, file }) => (
              <div className="staff-identity-id-side" key={side}>
                <strong>{title}</strong>
                <div className="staff-id-side-content">
                  <div className="staff-id-preview">
                    {file ? <StaffFacePhotoPreview file={file} label={title} /> : <span>No new image selected</span>}
                  </div>
                  <div>
                    <label className="staff-identity-id-upload">Choose image
                      <input type="file" accept="image/jpeg,image/png" disabled={scanning || saving} aria-label={title} onChange={(event) => setImage(side, event.target.files?.[0] ?? null)} />
                    </label>
                    <label className="staff-identity-id-upload">Use camera
                      <input type="file" accept="image/jpeg,image/png" capture="environment" disabled={scanning || saving} aria-label={`Capture ${title}`} onChange={(event) => setImage(side, event.target.files?.[0] ?? null)} />
                    </label>
                    {file && <button type="button" className="btn btn-ghost btn-sm" disabled={scanning || saving} onClick={() => setImage(side, null)}>Remove</button>}
                  </div>
                </div>
                {file && !isValidImage(file) && <p className="field-error" role="alert">Choose a JPEG or PNG under 2 MB.</p>}
              </div>
            ))}
            <button type="button" className="btn btn-outline" disabled={!frontFile || !isValidImage(frontFile) || scanning || saving} onClick={() => void scanId()}>
              {scanning ? "Scanning new ID…" : "Scan new ID"}
            </button>
            {scan && <div className={`staff-id-scan-result${scanVerified ? "" : " is-warning"}`} role={scanVerified ? "status" : "alert"}>
              {scanMessage(scan, scanVerified)}
            </div>}
            {scanVerified && scan && <>
              <div className="staff-identity-group">
                <h4>Review new ID details</h4>
                <p>Compare the extracted suggestions with the new document and correct any mistakes.</p>
                <label className="field"><span className="label">Name on ID</span><input className="input" maxLength={120} value={details.name} onChange={(event) => { setDetailsReviewed(false); setDetails((current) => ({ ...current, name: event.target.value })); }} /></label>
                <label className="field"><span className="label">ID number</span><input className="input" maxLength={80} value={details.number} onChange={(event) => { setDetailsReviewed(false); setDetails((current) => ({ ...current, number: event.target.value })); }} /></label>
                <label className="field"><span className="label">Date of birth (if shown)</span><input className="input" type="date" value={details.birth_date} onChange={(event) => { setDetailsReviewed(false); setDetails((current) => ({ ...current, birth_date: event.target.value })); }} /></label>
                <label className="field"><span className="label">Expiration date{staffIdRequiresExpirationDate(idType) ? " (required)" : " (if shown)"}</span><input className="input" type="date" required={staffIdRequiresExpirationDate(idType)} value={details.expiration_date} onChange={(event) => { setDetailsReviewed(false); setDetails((current) => ({ ...current, expiration_date: event.target.value })); }} /></label>
              </div>
              <div className="staff-identity-group">
                <h4>ID checks</h4>
                <div className="staff-id-checks">
                  {[
                    ["ID type", checkLabel(scan.outcome === "match" || (idType === "other" && scan.outcome === "uncertain") ? "pass" : scan.outcome === "mismatch" ? "mismatch" : "unknown")],
                    ["Details reviewed", checkLabel(detailsReviewed ? "pass" : "unknown")],
                    ["Registered face match", checkLabel(scan.face_match === "matched" ? "pass" : scan.face_match === "rejected" ? "mismatch" : "unknown")],
                    ["Duplicate ID", duplicate === "checking" ? "Checking…" : checkLabel(duplicate === "unique" ? "pass" : duplicate === "duplicate" ? "mismatch" : "unknown")],
                    ["Name", checkLabel(detailChecks.name)],
                    ["Date of birth", checkLabel(detailChecks.birth_date)],
                    ["ID number format", checkLabel(detailChecks.number)],
                    ["Expiration date", checkLabel(detailChecks.expiration_date)],
                  ].map(([label, value]) => <div className="staff-id-check" key={label}><strong>{label}</strong><span>{value}</span></div>)}
                </div>
                {duplicate === "duplicate" && <p className="field-error" role="alert">This ID number is already attached to another staff account.</p>}
                {idType === "other" && scan.outcome === "uncertain" && <p>OCR could not identify this ID type. Compare the document manually; a detected mismatch cannot be overridden.</p>}
                <label className="field"><span><input type="checkbox" checked={detailsReviewed} onChange={(event) => setDetailsReviewed(event.target.checked)} /> I compared the ID type and details with the new document, including its expiration date if present.</span></label>
                <p>Automated checks do not prove that the ID is authentic.</p>
              </div>
            </>}
          </>}
          {error && <p role="alert">{error}</p>}
          <div className="staff-id-popup-actions">
            <button type="button" className="btn btn-outline" disabled={saving} onClick={onClose}>Cancel</button>
            {identity && <button type="button" className="btn btn-primary" disabled={!canSave || scanning || saving} onClick={() => void saveUpdate()}>
              {saving ? "Updating ID…" : "Verify and update ID"}
            </button>}
          </div>
        </div>
      </section>
    </div>
  );
}
