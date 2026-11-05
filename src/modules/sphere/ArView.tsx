"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { startAr } from "./ar";

/** The AR page: a camera view with Arcanus's orb placed in your space. The camera only starts after a tap. */
export default function ArView({ analyser = null, activity = 0, children }: { analyser?: AnalyserNode | null; activity?: number; children?: ReactNode }) {
  // The orb reads these every frame, so they live in refs: a new voice or busy state never restarts the camera.
  const analyserRef = useRef(analyser);
  const activityRef = useRef(activity);
  useEffect(() => {
    analyserRef.current = analyser;
    activityRef.current = activity;
  }, [analyser, activity]);
  const mount = useRef<HTMLDivElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const alive = useRef(false);
  const [phase, setPhase] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [error, setError] = useState("");
  const [hint, setHint] = useState(true);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    setHint(true);
    const timer = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(timer);
  }, [phase]);

  const fail = (message: string) => {
    stopRef.current?.();
    stopRef.current = null;
    setError(message);
    setPhase("error");
  };

  const start = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      return fail("AR needs a secure (HTTPS) connection and a camera. Open this page over HTTPS on your phone.");
    }
    setPhase("starting");
    try {
      const stop = await startAr(mount.current!, { onReady: () => setPhase("running"), onError: fail, onLock: setLocked }, { analyser: () => analyserRef.current, boost: () => activityRef.current });
      if (alive.current) stopRef.current = stop;
      else stop();
    } catch (cause) {
      console.error(cause);
      fail("Could not start AR on this device.");
    }
  };

  return (
    <div className="ar">
      <div ref={mount} className="ar-stage" />
      <Link href="/" className="ar-back">
        ← Arcanus
      </Link>
      {phase === "running" ? (
        <>
          {locked ? (
            <p className="ar-hint" role="status">
              Orb locked in place · tap it or anywhere to unlock
            </p>
          ) : (
            hint && <p className="ar-hint">Tap a surface to place the orb · drag it to move · tap it to lock it in place · pinch to resize · twist to turn</p>
          )}
          {children}
        </>
      ) : (
        <div className="ar-card" role="dialog" aria-label="Start AR">
          <h1>Arcanus in your space</h1>
          {phase === "error" ? (
            <p role="alert">{error}</p>
          ) : (
            <p>Allow the camera, then move your phone slowly so it can find the floor. The orb appears in front of you.</p>
          )}
          <button type="button" className="btn btn-primary" disabled={phase === "starting"} onClick={start}>
            {phase === "starting" ? "Starting…" : phase === "error" ? "Try again" : "Start AR"}
          </button>
        </div>
      )}
    </div>
  );
}
