import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "recording" | "processing" | "error";

export interface UseVoiceCaptureOptions {
  /** Called when the user releases and the recording is ready. */
  onCapture: (blob: Blob) => Promise<void> | void;
  /** Maximum recording length in milliseconds (default 90s). */
  maxMs?: number;
}

interface UseVoiceCaptureResult {
  state: VoiceState;
  /** mean amplitude 0..1 for live waveform */
  level: number;
  /** elapsed milliseconds while recording */
  elapsedMs: number;
  /** error string if state === "error" */
  errorMsg: string | null;
  /** Begin recording. Asks for mic permission if needed. */
  start: () => Promise<void>;
  /** Stop and trigger onCapture with the recorded blob. */
  stop: () => void;
  /** Stop and discard. */
  cancel: () => void;
  /** Manually clear error state. */
  reset: () => void;
}

/**
 * Push-to-talk audio capture using MediaRecorder + Web Audio AnalyserNode for levels.
 */
export function useVoiceCapture({
  onCapture,
  maxMs = 90_000,
}: UseVoiceCaptureOptions): UseVoiceCaptureResult {
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const releaseWakeLock = useCallback(() => {
    const wl = wakeLockRef.current;
    wakeLockRef.current = null;
    if (wl) {
      void wl.release().catch(() => {});
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
    } catch {
      /* noop — unsupported or denied */
    }
  }, []);

  const cleanup = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (maxTimeoutRef.current) clearTimeout(maxTimeoutRef.current);
    maxTimeoutRef.current = null;
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
    }
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    releaseWakeLock();
    setLevel(0);
  }, [releaseWakeLock]);

  useEffect(() => () => cleanup(), [cleanup]);

  // iOS auto-releases the wake lock when the tab is backgrounded; re-acquire on return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible" && recorderRef.current?.state === "recording") {
        void requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [requestWakeLock]);

  const start = useCallback(async () => {
    if (state === "recording" || state === "processing") return;
    setErrorMsg(null);
    cancelledRef.current = false;
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      console.error("mic denied", e);
      setErrorMsg("Microphone permission needed");
      setState("error");
      return;
    }
    streamRef.current = stream;

    // Analyser for visual levels
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 2.5));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* visualization is optional */
    }

    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      cleanup();
      if (cancelledRef.current || blob.size < 800) {
        setState("idle");
        setElapsedMs(0);
        if (!cancelledRef.current) setErrorMsg("Didn't catch that");
        return;
      }
      setState("processing");
      try {
        await onCapture(blob);
        setState("idle");
        setElapsedMs(0);
      } catch (e) {
        console.error("voice capture handler failed", e);
        setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
        setState("error");
      }
    };

    startedAtRef.current = Date.now();
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 100);
    maxTimeoutRef.current = setTimeout(() => {
      try {
        recorder.state === "recording" && recorder.stop();
      } catch {
        /* noop */
      }
    }, maxMs);

    recorder.start();
    setState("recording");
    void requestWakeLock();
  }, [cleanup, maxMs, onCapture, requestWakeLock, state]);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (!r || r.state !== "recording") return;
    cancelledRef.current = false;
    try {
      r.stop();
    } catch {
      /* noop */
    }
  }, []);

  const cancel = useCallback(() => {
    const r = recorderRef.current;
    cancelledRef.current = true;
    if (r && r.state === "recording") {
      try {
        r.stop();
      } catch {
        /* noop */
      }
    } else {
      cleanup();
      setState("idle");
      setElapsedMs(0);
    }
  }, [cleanup]);

  const reset = useCallback(() => {
    setErrorMsg(null);
    setState("idle");
  }, []);

  return { state, level, elapsedMs, errorMsg, start, stop, cancel, reset };
}
