"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/Icons";
import { StaffFaceCamera } from "./StaffFaceCamera";
import { StaffFacePhotoPreview } from "./StaffFacePhotoPreview";

type Status = {
  enabled: boolean;
  required: boolean;
  enrolled: boolean;
  verified_at: string | null;
  expires_at: string | null;
};

type FacePhotos = {
  face_front: string;
  face_left: string;
  face_right: string;
};

const facePhotoPoses = [
  { key: "face_front", label: "Straight on" },
  { key: "face_left", label: "Turn left" },
  { key: "face_right", label: "Turn right" },
] as const;

type FacePhotoKey = (typeof facePhotoPoses)[number]["key"];
type IdentityDetails = {
  name: string;
  number: string;
  birth_date: string;
  expiration_date: string;
};
type FaceReplacement = FacePhotos & {
  id_front: string;
  id_back: string | null;
  id_type: string | null;
  details: IdentityDetails | null;
  revision: string;
};

function isFacePhotoKey(key: string): key is FacePhotoKey {
  return facePhotoPoses.some((pose) => pose.key === key);
}

function isFacePhotos(value: unknown): value is FacePhotos {
  return typeof value === "object" && value !== null &&
    "face_front" in value && typeof value.face_front === "string" &&
    "face_left" in value && typeof value.face_left === "string" &&
    "face_right" in value && typeof value.face_right === "string";
}

function isFaceReplacement(value: unknown): value is FaceReplacement {
  if (!isFacePhotos(value) || !("id_front" in value) || typeof value.id_front !== "string" ||
      !("id_back" in value) || (value.id_back !== null && typeof value.id_back !== "string") ||
      !("id_type" in value) || (value.id_type !== null && typeof value.id_type !== "string") ||
      !("revision" in value) || typeof value.revision !== "string" || !("details" in value)) {
    return false;
  }
  const details = value.details;
  return details === null || (
    typeof details === "object" && details !== null &&
    "name" in details && typeof details.name === "string" &&
    "number" in details && typeof details.number === "string" &&
    "birth_date" in details && typeof details.birth_date === "string" &&
    "expiration_date" in details && typeof details.expiration_date === "string"
  );
}

function responseError(data: unknown, fallback: string) {
  return typeof data === "object" && data !== null &&
    "error" in data && typeof data.error === "string"
    ? data.error
    : fallback;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Could not read the captured face photo."));
    reader.onerror = () => reject(new Error("Could not read the captured face photo."));
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("The registered ID photo could not be loaded.");
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  return new File([bytes], name, { type: match[1] });
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

export function StaffFaceStatus({ userId, name }: { userId: number; name: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [facePhotos, setFacePhotos] = useState<FacePhotos | null>(null);
  const [retakeFiles, setRetakeFiles] = useState<Partial<Record<FacePhotoKey, File>>>({});
  const [retakePose, setRetakePose] = useState<number | null>(null);
  const [retakingAll, setRetakingAll] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [savingFacePhotos, setSavingFacePhotos] = useState(false);
  const reviewDialog = useRef<HTMLDialogElement>(null);
  const reviewRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    if (confirmOpen && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [confirmOpen]);
  useEffect(() => {
    if (reviewOpen && reviewDialog.current && !reviewDialog.current.open) reviewDialog.current.showModal();
  }, [reviewOpen]);
  useEffect(() => () => reviewRequest.current?.abort(), []);
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
    void (async () => {
      await load(controller.signal);
    })();
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

  async function loadFacePhotos() {
    reviewRequest.current?.abort();
    const controller = new AbortController();
    reviewRequest.current = controller;
    setReviewOpen(true);
    setReviewBusy(true);
    setReviewError("");
    setFacePhotos(null);
    try {
      const response = await fetch(`/api/admin/staff/${userId}/identity?review=face`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(data, "Could not load registered face photos."));
      if (!isFacePhotos(data)) throw new Error("Registered face photos are incomplete.");
      if (!controller.signal.aborted) setFacePhotos(data);
    } catch (err) {
      if (!controller.signal.aborted) setReviewError(err instanceof Error ? err.message : "Could not load registered face photos.");
    } finally {
      if (!controller.signal.aborted) setReviewBusy(false);
    }
  }

  function startRetake(pose: number) {
    setRetakingAll(false);
    setRetakePose(pose);
    setCameraOpen(true);
  }

  function startRetakeAll() {
    setRetakeFiles({});
    setRetakingAll(true);
    setRetakePose(null);
    setCameraOpen(true);
  }

  async function saveFacePhotos() {
    if (!facePhotos || !facePhotoPoses.some(({ key }) => retakeFiles[key])) return;
    setSavingFacePhotos(true);
    setReviewError("");
    setNotice("");
    try {
      const identityResponse = await fetch(`/api/admin/staff/${userId}/identity?review=replace`, { cache: "no-store" });
      const identityData: unknown = await identityResponse.json();
      if (!identityResponse.ok) {
        throw new Error(responseError(identityData, "Could not load the current identity registration."));
      }
      if (!isFaceReplacement(identityData)) {
        throw new Error("The current identity registration is incomplete. Reopen the review and try again.");
      }
      if (!identityData.id_type || !identityData.details) {
        throw new Error("Review and save the ID details before replacing the registered face photos.");
      }

      const nextPhotos = { ...facePhotos };
      for (const { key } of facePhotoPoses) {
        const file = retakeFiles[key];
        if (file) nextPhotos[key] = await fileToDataUrl(file);
      }

      const form = new FormData();
      form.set("image", dataUrlToFile(identityData.id_front, "staff-id.jpg"));
      form.set(
        "face",
        retakeFiles.face_front ?? dataUrlToFile(nextPhotos.face_front, "staff-face.jpg"),
      );
      form.set("name", name);
      form.set("type", identityData.id_type);
      const scanResponse = await fetch("/api/admin/staff/id-scan", { method: "POST", body: form });
      const scanData: unknown = await scanResponse.json();
      if (!scanResponse.ok) {
        throw new Error(responseError(scanData, "Could not verify the ID and front face photo."));
      }
      const verificationToken = typeof scanData === "object" && scanData !== null &&
        "verification_token" in scanData && typeof scanData.verification_token === "string"
        ? scanData.verification_token
        : "";
      if (!verificationToken) {
        throw new Error("The ID and front face photo could not be verified. Retake the straight-on photo and try again.");
      }

      const updateResponse = await fetch(`/api/admin/staff/${userId}/identity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replacing: "face",
          revision: identityData.revision,
          id_front: identityData.id_front,
          id_back: identityData.id_back ?? undefined,
          id_type: identityData.id_type,
          ...nextPhotos,
          details: identityData.details,
          details_reviewed: true,
          identity_verification_token: verificationToken,
        }),
      });
      const updateData: unknown = await updateResponse.json();
      if (!updateResponse.ok ||
          typeof updateData !== "object" || updateData === null ||
          !("success" in updateData) || updateData.success !== true) {
        throw new Error(responseError(updateData, "Could not update the registered face photos."));
      }

      setFacePhotos(nextPhotos);
      setRetakeFiles({});
      setRetakingAll(false);
      await load();
      setNotice("Face photos updated. The staff member must verify their face again.");
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Could not update the registered face photos.");
    } finally {
      setSavingFacePhotos(false);
    }
  }

  function closeFaceReview() {
    if (savingFacePhotos) return;
    reviewRequest.current?.abort();
    reviewRequest.current = null;
    setReviewOpen(false);
    setReviewBusy(false);
    setReviewError("");
    setFacePhotos(null);
    setRetakeFiles({});
    setRetakingAll(false);
    setRetakePose(null);
    setCameraOpen(false);
  }

  const retakeCount = facePhotoPoses.filter(({ key }) => retakeFiles[key]).length;
  const label = !status ? "Loading…" : !status.enabled ? "Disabled" : !status.enrolled ? "Face not registered" : status.required ? status.verified_at ? "Expired" : "Not yet verified" : "Verified";
  return <section className="staff-face-status" aria-labelledby={`face-status-${userId}`}>
    <h3 id={`face-status-${userId}`}>Duty face check</h3>
    <p>Status · <strong>{label}</strong></p>
    {status?.verified_at && <p className="tiny">Last verified: {formatTime(status.verified_at)}{status.enabled && status.expires_at ? ` · Expires: ${formatTime(status.expires_at)}` : ""}</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {status?.enrolled && <button type="button" className="btn btn-outline btn-sm" onClick={() => void loadFacePhotos()}>
      Review registered face
    </button>}
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
    {reviewOpen && <dialog
      ref={reviewDialog}
      className="staff-face-review-dialog"
      aria-labelledby={`face-review-title-${userId}`}
      onClose={closeFaceReview}
      onCancel={(event) => { if (savingFacePhotos) event.preventDefault(); }}
    >
      <div className="staff-face-review-heading">
        <div><span className="eyebrow">Face recognition</span><h3 id={`face-review-title-${userId}`}>Registered face photos</h3></div>
        <button type="button" className="btn btn-ghost btn-sm" aria-label="Close face photo review" disabled={savingFacePhotos} onClick={() => reviewDialog.current?.close()}>×</button>
      </div>
      <p className="staff-face-review-description">These are the reference photos used for the staff face check. Retaking and saving photos rechecks the ID and front face with third-party services, replaces the registered face, and requires the staff member to verify again. Obtain their permission first.</p>
      {reviewBusy && <p className="staff-face-review-state" role="status">Loading registered face photos…</p>}
      {reviewError && <p className="staff-face-review-state" role="alert">{reviewError}</p>}
      {facePhotos && <div className="staff-face-review-grid">
        {facePhotoPoses.map(({ key, label: title }, index) => <figure className="staff-face-review-card" key={key}>
          <figcaption>{title}</figcaption>
          {retakeFiles[key]
            ? <StaffFacePhotoPreview file={retakeFiles[key]} label={title} />
            : <Image className="staff-face-review-image" src={facePhotos[key]} alt={`Registered face photo, ${title.toLowerCase()}`} width={400} height={300} unoptimized />}
          <button type="button" className="btn btn-outline btn-sm" aria-label={`Retake ${title.toLowerCase()} photo`} disabled={savingFacePhotos || cameraOpen} onClick={() => startRetake(index)}>
            {retakeFiles[key] ? "Retake again" : "Retake"}
          </button>
        </figure>)}
      </div>}
      {retakingAll && retakeCount < facePhotoPoses.length && <p className="staff-face-review-state" role="status">Capture all three photos before saving the full retake.</p>}
      <div className="staff-face-review-actions">
        {reviewError && !facePhotos && <button type="button" className="btn btn-outline" disabled={reviewBusy} onClick={() => void loadFacePhotos()}>Try again</button>}
        <button type="button" className="btn btn-outline" disabled={!facePhotos || savingFacePhotos || cameraOpen || reviewBusy} onClick={startRetakeAll}>Retake all photos</button>
        <button type="button" className="btn btn-primary" disabled={!facePhotos || savingFacePhotos || cameraOpen || retakeCount === 0 || (retakingAll && retakeCount < facePhotoPoses.length)} onClick={() => void saveFacePhotos()}>
          {savingFacePhotos ? "Verifying and saving…" : "Verify and save"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={savingFacePhotos} onClick={() => reviewDialog.current?.close()}>Close</button>
      </div>
      {cameraOpen && <div className="modal-backdrop staff-face-popup-backdrop" style={{ zIndex: 1102 }}>
        <section className="modal staff-face-popup" role="dialog" aria-modal="true" aria-label={retakePose === null ? "Retake all face photos" : `Retake ${facePhotoPoses[retakePose].label.toLowerCase()} face photo`}>
          <StaffFaceCamera
            initialStep={retakePose ?? 0}
            singlePose={retakePose !== null}
            completedPoses={retakingAll ? [] : facePhotoPoses.filter(({ key }) => Boolean(retakeFiles[key] || facePhotos?.[key])).map(({ key }) => key)}
            onClose={() => setCameraOpen(false)}
            onCapture={(key, file) => {
              if (!isFacePhotoKey(key)) return;
              setRetakeFiles((current) => ({ ...current, [key]: file }));
            }}
          />
        </section>
      </div>}
    </dialog>}
  </section>;
}
