"use client";

import { useEffect, useRef, useState } from "react";
import { initializeWithoutTfliteInfo, runWithoutTfliteInfo } from "@/lib/faceLandmarkerLog";

const poses = [
  { key: "face_front", label: "Look straight ahead" },
  { key: "face_left", label: "Turn your head left" },
  { key: "face_right", label: "Turn your head right" },
] as const;

export function StaffFaceCamera({ onCapture, onClose, initialStep = 0, singlePose = false, completedPoses = [] }: {
  onCapture: (key: string, file: File) => void;
  onClose: () => void;
  initialStep?: number;
  singlePose?: boolean;
  completedPoses?: string[];
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [step, setStep] = useState(initialStep);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [guide, setGuide] = useState("Starting face guide…");
  const [progress, setProgress] = useState(0);
  const [faceInRange, setFaceInRange] = useState(false);
  const [retry, setRetry] = useState(0);
  const captureRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let stream: MediaStream | undefined;
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires a secure connection and a supported browser.");
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (!active) { camera.getTracks().forEach((track) => track.stop()); return; }
        stream = camera;
        if (video.current) {
          video.current.srcObject = camera;
          await video.current.play();
          if (active) setReady(true);
        }
      } catch {
        if (active) setError("Could not start the camera. Check camera permission and try again.");
      }
    }
    void start();
    return () => { active = false; stream?.getTracks().forEach((track) => track.stop()); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    let frame = 0;
    let heldSince = 0;
    let lastVideoTime = -1;
    let landmarker: import("@mediapipe/tasks-vision").FaceLandmarker | undefined;
    async function guideFace() {
      try {
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
          const current = video.current;
          if (current && current.readyState >= 2 && current.currentTime !== lastVideoTime) {
            lastVideoTime = current.currentTime;
            let result: ReturnType<typeof landmarker.detectForVideo>;
            try {
              result = runWithoutTfliteInfo(() => landmarker!.detectForVideo(current, now));
            } catch {
              setFaceInRange(false);
              setGuide("Face detection stopped. Close the camera and try again.");
              return;
            }
            const face = result.faceLandmarks[0];
            let message: string = poses[step].label;
            let valid = false;
            let inRange = false;
            if (result.faceLandmarks.length !== 1 || !face) {
              message = result.faceLandmarks.length > 1 ? "Only one person in view" : "Position your face inside the circle";
            } else {
              const left = face[234], right = face[454], nose = face[1];
              const width = Math.abs(right.x - left.x);
              const center = (left.x + right.x) / 2;
              const turn = width > 0 ? (nose.x - center) / width : 0;
              if (width < 0.22) message = "Too far away — move closer";
              else if (width > 0.8) message = "Too close — move back";
              else if (Math.abs(center - 0.5) > 0.2 || nose.y < 0.2 || nose.y > 0.8) message = "Center your face in the circle";
              else {
                inRange = true;
                valid = step === 0 ? Math.abs(turn) < 0.10 : step === 1 ? turn > 0.13 : turn < -0.13;
                message = valid ? "Face detected — hold still…" : `Face detected — ${poses[step].label.toLowerCase()}`;
              }
            }
            setFaceInRange(inRange);
            if (!valid) heldSince = 0;
            else if (!heldSince) heldSince = now;
            const amount = valid ? Math.min(1, (now - heldSince) / 1500) : 0;
            setGuide(message);
            setProgress(amount);
            if (amount >= 1) { captureRef.current(); return; }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        if (active) { setFaceInRange(false); setGuide("Automatic face guidance is unavailable. Close the camera and try again."); }
      }
    }
    void guideFace();
    return () => { active = false; cancelAnimationFrame(frame); landmarker?.close(); };
  }, [ready, step, retry]);

  function capture() {
    const current = video.current;
    if (!current?.videoWidth || !current.videoHeight) {
      setError("Camera is not ready yet. Trying again.");
      setRetry((value) => value + 1);
      return;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / Math.max(current.videoWidth, current.videoHeight));
    canvas.width = Math.round(current.videoWidth * scale);
    canvas.height = Math.round(current.videoHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) { setError("Could not capture the image. Trying again."); setRetry((value) => value + 1); return; }
    context.drawImage(current, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob || blob.size > 2 * 1024 * 1024) { setError("Could not capture a suitable photo. Trying again."); setRetry((value) => value + 1); return; }
      setError("");
      setProgress(0);
      onCapture(poses[step].key, new File([blob], `${poses[step].key}.jpg`, { type: "image/jpeg" }));
      if (singlePose || step === poses.length - 1) onClose();
      else setStep((value) => value + 1);
    }, "image/jpeg", 0.85);
  }
  useEffect(() => {
    captureRef.current = capture;
  });

  return (
    <div className="staff-face-camera" role="region" aria-label="Face photo camera">
      <div className="staff-face-camera-top">
        <div><span className="eyebrow">Photo {step + 1} of 3</span><h4>{poses[step].label}</h4></div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close camera</button>
      </div>
      <div className={`staff-face-camera-ring${faceInRange ? " is-detected" : ""}`} style={{ background: `conic-gradient(#439c68 ${progress * 360}deg, ${faceInRange ? "#b6ddc5" : "#e7ded3"} 0deg)` }}>
      <div className="staff-face-camera-circle">
        <video ref={video} playsInline muted aria-label="Live camera preview" />
      </div>
      </div>
      <div className="staff-face-camera-progress" aria-label={`Photo ${step + 1} of 3`}>
        {poses.map((pose, index) => {
          const completed = completedPoses.includes(pose.key) || (!singlePose && index < step);
          return <span key={pose.key} className={index === step ? "active" : completed ? "completed" : ""} aria-label={`${pose.label}: ${index === step ? "current" : completed ? "captured" : "waiting"}`}>{index !== step && completed ? "✓" : index + 1}</span>;
        })}
      </div>
      {error && <p role="alert">{error}</p>}
      <p role="status">{guide}</p>
    </div>
  );
}
