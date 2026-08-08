import { useEffect, useRef } from "react";

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: "release", cb: () => void) => void;
};

/** Holds a Screen Wake Lock while `enabled` is true. No-op where unsupported. */
export function useWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined") return;
    const wl = (
      navigator as unknown as {
        wakeLock?: { request: (t: string) => Promise<WakeLockSentinelLike> };
      }
    ).wakeLock;
    if (!wl?.request) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await wl.request("screen");
        if (cancelled) {
          await s.release().catch(() => {});
          return;
        }
        sentinelRef.current = s;
        s.addEventListener("release", () => {
          if (sentinelRef.current === s) sentinelRef.current = null;
        });
      } catch {
        // ignore — battery saver or unsupported
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) {
        void acquire();
      }
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s) void s.release().catch(() => {});
    };
  }, [enabled]);
}
