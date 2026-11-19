"use client";

import { useEffect, useRef, useState } from "react";
import { initializeWithoutTfliteInfo, runWithoutTfliteInfo } from "@/lib/faceLandmarkerLog";
import { BLINK_HOLD_MS, blinkHoldComplete, eyeStates, faceMoved } from "@/lib/faceCheckGuidance";
import { LoadingDots } from "@/components/LoadingDots";

type Captures = { front?: string; left?: string; right?: string; closed?: string; open?: string; closedAgain?: string; openAgain?: string };
type Point = { x: number; y: number };

function eyeRatio(face: Point[], a: number, b: number, top: number, bottom: number, aspect: number) {
  const distance = (p: Point, q: Point) => Math.hypot((p.x - q.x) * aspect, p.y - q.y);
  return distance(face[top], face[bottom]) / Math.max(distance(face[a], face[b]), 0.001);
}

export function StaffFaceCheck({ onVerified, enrolled, embedded = false }: { onVerified: () => void; enrolled: boolean; embedded?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [running, setRunning] = useState(enrolled);
  const [attempt, setAttempt] = useState(0);
  const [guide, setGuide] = useState("Starting camera…");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"scanning" | "checking" | "verified" | "failed">("scanning");
  const [stepDisplay, setStepDisplay] = useState(0);
  const [progress, setProgress] = useState(0);
  const [faceInRange, setFaceInRange] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await fetch("/api/auth/face-check", { cache: "no-store", signal: controller.signal });
        if (response.status === 401 && (await response.json()).reason === "face_reset") {
          window.location.assign("/login?next=/staff&reason=face_reset");
        }
      } catch { /* The next check or verification request will retry. */ }
    };
    const timer = window.setInterval(() => { void check(); }, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!running || !enrolled) return;
    let active = true;
    let frame = 0;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | undefined;
    let landmarker: import("@mediapipe/tasks-vision").FaceLandmarker | undefined;
    const captures: Captures = {};
    let step = 0;
    let blink = 0;
    let held = 0;
    let closedSince = 0;
    let anchor: (Point & { turn: number; width: number }) | undefined;
    let lastTime = -1;
    const snapshot = () => {
      const current = video.current;
      if (!current?.videoWidth || !current.videoHeight) throw new Error("Camera is not ready.");
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / Math.max(current.videoWidth, current.videoHeight));
      canvas.width = Math.round(current.videoWidth * scale);
      canvas.height = Math.round(current.videoHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not capture the image.");
      context.drawImage(current, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.8);
    };
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires a secure connection.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        if (!video.current) throw new Error("Camera preview is unavailable.");
        video.current.srcObject = stream;
        await video.current.play();
        const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        landmarker = await initializeWithoutTfliteInfo(async () => {
          const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
          return FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: "/models/face_landmarker.task" },
            runningMode: "VIDEO",
            numFaces: 2,
          });
        });
        if (!active) { landmarker.close(); return; }
        const tick = (now: number) => {
          if (!active || !landmarker) return;
          try {
            const current = video.current;
            if (current && current.readyState >= 2 && current.currentTime !== lastTime) {
              lastTime = current.currentTime;
              const result = runWithoutTfliteInfo(() => landmarker!.detectForVideo(current, now));
              const face = result.faceLandmarks[0];
              if (result.faceLandmarks.length !== 1 || !face) {
                held = 0;
                anchor = undefined;
                closedSince = 0;
                if (step === 2) { blink = 0; delete captures.closed; delete captures.open; delete captures.closedAgain; delete captures.openAgain; }
                setProgress(0);
                setFaceInRange(false);
                setGuide(result.faceLandmarks.length > 1 ? "Only one person may be in view." : "Position your face inside the circle.");
              } else {
                const left = face[234], right = face[454], nose = face[1];
                const width = Math.abs(right.x - left.x);
                const center = (left.x + right.x) / 2;
                const turn = width ? (nose.x - center) / width : 0;
                const inRange = width >= 0.22 && width <= 0.8 && Math.abs(center - 0.5) <= 0.2 && nose.y >= 0.2 && nose.y <= 0.8;
                const aspect = current.videoWidth / current.videoHeight;
                const leftEye = eyeRatio(face, 33, 133, 159, 145, aspect);
                const rightEye = eyeRatio(face, 362, 263, 386, 374, aspect);
                const { open: eyesOpen, closed: eyesClosed } = eyeStates(leftEye, rightEye);
                setFaceInRange(inRange);
                if (!inRange) {
                  held = 0;
                  anchor = undefined;
                  closedSince = 0;
                  if (step === 2) { blink = 0; delete captures.closed; delete captures.open; delete captures.closedAgain; delete captures.openAgain; }
                  setProgress(0);
                  setGuide("Center your face and move to a comfortable distance.");
                } else if (step === 2) {
                  if (Math.abs(turn) >= 0.1) {
                    setGuide("Look straight ahead to blink.");
                    blink = 0;
                    held = 0;
                    anchor = undefined;
                    closedSince = 0;
                    setProgress(0);
                  } else if (blink > 0 && anchor && (Math.hypot(nose.x - anchor.x, nose.y - anchor.y) > 0.03 || Math.abs(turn - anchor.turn) > 0.05)) {
                    blink = 0;
                    held = 0;
                    anchor = undefined;
                    closedSince = 0;
                    delete captures.closed;
                    delete captures.open;
                    delete captures.closedAgain;
                    delete captures.openAgain;
                    setProgress(0);
                    setGuide("Hold your head still and look straight ahead.");
                  } else if (blink === 0 && eyesOpen) {
                    if (!anchor || faceMoved(anchor, nose) || Math.abs(turn - anchor.turn) > 0.035 || Math.abs(width - anchor.width) > 0.025) {
                      anchor = { x: nose.x, y: nose.y, turn, width };
                      held = now;
                    }
                    setProgress(Math.min(1, (now - held) / 800));
                    setGuide("Look straight ahead and hold still…");
                    if (now - held >= 800) { blink = 1; held = 0; setProgress(0); }
                  } else if ((blink === 1 || blink === 3) && eyesClosed) {
                    if (!closedSince) closedSince = now;
                    setGuide(`Blink ${blink === 1 ? "1" : "2"} of 2: close both eyes slowly and hold…`);
                    setProgress(Math.min(1, (now - closedSince) / BLINK_HOLD_MS));
                    if (blinkHoldComplete(closedSince, now)) {
                      if (blink === 1) captures.closed = snapshot();
                      else captures.closedAgain = snapshot();
                      blink++;
                      closedSince = 0;
                      held = 0;
                      setProgress(0);
                    }
                  } else if ((blink === 2 || blink === 4) && eyesOpen) {
                    if (!held) held = now;
                    setGuide("Open both eyes slowly and hold…");
                    setProgress(Math.min(1, (now - held) / BLINK_HOLD_MS));
                    if (blinkHoldComplete(held, now)) {
                      if (blink === 2) {
                        captures.open = snapshot();
                        blink = 3;
                        setGuide("Blink 2 of 2: close both eyes slowly.");
                      } else {
                        captures.openAgain = snapshot();
                        step = 3;
                        setStepDisplay(step);
                        setGuide("Turn your head right.");
                      }
                      setProgress(0);
                      held = 0;
                    }
                  } else {
                    if (blink === 0) { held = 0; anchor = undefined; setProgress(0); }
                    if (blink === 1 || blink === 3) { closedSince = 0; setProgress(0); }
                    if (blink === 2 || blink === 4) { held = 0; setProgress(0); }
                    setGuide(blink === 0 ? "Open both eyes and look straight ahead." : blink === 1 || blink === 3 ? `Blink ${blink === 1 ? "1" : "2"} of 2: close both eyes slowly and hold.` : "Open both eyes slowly and hold.");
                  }
                } else {
                  const valid = step === 0 ? Math.abs(turn) < 0.1 && eyesOpen : step === 1 ? turn > 0.13 : turn < -0.13;
                  const label = step === 0 ? "Look straight ahead with your eyes open." : step === 1 ? "Turn your head left." : "Turn your head right.";
                  if (!valid) { held = 0; anchor = undefined; setProgress(0); setGuide(label); }
                  else {
                    if (!anchor || faceMoved(anchor, nose) || Math.abs(turn - anchor.turn) > 0.035 || Math.abs(width - anchor.width) > 0.025) {
                      anchor = { x: nose.x, y: nose.y, turn, width };
                      held = now;
                    }
                    setProgress(Math.min(1, (now - held) / 2500));
                    setGuide("Hold still…");
                    if (now - held >= 2500) {
                      const image = snapshot();
                      if (step === 0) captures.front = image;
                      else if (step === 1) captures.left = image;
                      else captures.right = image;
                      step++;
                      if (step < 4) setStepDisplay(step);
                      setProgress(0);
                      held = 0;
                      anchor = undefined;
                      if (step === 4) {
                        setPhase("checking");
                        stream?.getTracks().forEach((track) => track.stop());
                        void fetch("/api/auth/face-check", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(captures),
                        }).then(async (response) => {
                          const data = await response.json();
                          if (response.status === 401 && data.reason === "face_reset") {
                            window.location.assign("/login?next=/staff&reason=face_reset");
                            return;
                          }
                          if (!response.ok || !data.success) throw new Error(data.error || "Verification failed.");
                          if (active) {
                            setPhase("verified");
                            completionTimer = setTimeout(() => { if (active) onVerified(); }, 1500);
                          }
                        }).catch((err: unknown) => {
                          if (active) { setError(err instanceof Error ? err.message : "Verification failed."); setPhase("failed"); setRunning(false); }
                        });
                        return;
                      }
                    }
                  }
                }
              }
            }
            frame = requestAnimationFrame(tick);
          } catch {
            setError("Face detection stopped. Please try again.");
            setPhase("failed");
            setRunning(false);
          }
        };
        frame = requestAnimationFrame(tick);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Could not start the camera.");
          setPhase("failed");
          setRunning(false);
        }
      }
    }
    void start();
    return () => { active = false; cancelAnimationFrame(frame); if (completionTimer) clearTimeout(completionTimer); stream?.getTracks().forEach((track) => track.stop()); landmarker?.close(); };
  }, [running, enrolled, attempt, onVerified]);

  return (
    <main className={embedded ? undefined : "card"} style={embedded ? undefined : { maxWidth: 560, margin: "3rem auto", padding: "1.5rem" }}>
      <span className="eyebrow">Staff verification</span>
      <h1 className="staff-face-check-title">Let&apos;s make sure it&apos;s you.</h1>
      {!enrolled ? <p role="alert">Your face is not registered. Ask an administrator to register your face before continuing.</p> : (
        <>
          {phase === "scanning" && running && <div className="staff-face-camera staff-duty-camera">
            <div className="staff-face-camera-top"><div><span className="eyebrow">{`Step ${stepDisplay + 1} of 4`}</span><h4>{["Face forward", "Turn left", "Blink", "Turn right"][stepDisplay]}</h4></div></div>
            <div className={`staff-face-camera-ring${faceInRange ? " is-detected" : ""}`} role="progressbar" aria-label="Current capture progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} style={{ background: `conic-gradient(#439c68 ${progress * 360}deg, ${faceInRange ? "#b6ddc5" : "#e7ded3"} 0deg)` }}>
              <div className="staff-face-camera-circle">
                <video ref={video} playsInline muted aria-label="Live camera preview" />
              </div>
            </div>
            <div className="staff-face-camera-progress" aria-label="Verification steps">
              {["Face forward", "Turn left", "Blink", "Turn right"].map((label, index) => <span key={label} className={index < stepDisplay ? "completed" : index === stepDisplay ? "active" : ""} aria-label={`${label}: ${index < stepDisplay ? "completed" : index === stepDisplay ? "current" : "waiting"}`}>{index < stepDisplay ? "✓" : index + 1}</span>)}
            </div>
            <p className="staff-duty-guide" role="status">{guide}</p>
            <p className="tiny">{faceInRange ? "Face detected" : "Waiting for a clear face"}</p>
          </div>}
          {phase === "checking" && <div className="staff-face-result staff-face-checking"><LoadingDots label="Checking your face" /></div>}
          {(phase === "verified" || phase === "failed") && <div className={`staff-face-result ${phase}`} role={phase === "failed" ? "alert" : "status"}>
            <div className="staff-face-result-icon" aria-hidden="true">
              <svg viewBox="0 0 48 48" fill="none">
                {phase === "verified" ? <path d="M12 24l8 8 16-17" /> : <path d="M15 15l18 18M33 15L15 33" />}
              </svg>
            </div>
            <h3>{phase === "verified" ? "Face verified" : "Verification unsuccessful"}</h3>
            <p>{phase === "verified" ? "You can continue to your account." : error}</p>
            {phase === "failed" && <button type="button" className="btn btn-primary" onClick={() => { setError(""); setStepDisplay(0); setProgress(0); setFaceInRange(false); setGuide("Starting camera…"); setPhase("scanning"); setAttempt((n) => n + 1); setRunning(true); }}>Try again</button>}
          </div>}
        </>
      )}
      <p><button type="button" className="btn btn-ghost" onClick={() => { void fetch("/api/auth/login?area=staff", { method: "DELETE" }).finally(() => window.location.assign("/login")); }}>Sign out</button></p>
    </main>
  );
}
