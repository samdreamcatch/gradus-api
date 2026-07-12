import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { touchLastSeen } from "@/lib/presence.functions";

const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY = "gradus.last_seen_bumped_at";

let inFlight = false;

function maybeTouch() {
  if (typeof window === "undefined") return;
  if (inFlight) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const last = raw ? Number(raw) : 0;
    if (Number.isFinite(last) && Date.now() - last < LAST_SEEN_THROTTLE_MS) return;
  } catch {
    // localStorage may throw in privacy modes; fall through and try anyway.
  }
  inFlight = true;
  touchLastSeen()
    .then(() => {
      try {
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    })
    .catch(() => {
      // Silent — presence is best-effort.
    })
    .finally(() => {
      inFlight = false;
    });
}

/**
 * Fires touchLastSeen on mount and on every route change, throttled to once
 * per 5 minutes across the whole session (persisted in localStorage).
 * Mount inside an authenticated subtree — server fn requires auth.
 */
export function useTouchLastSeen() {
  const router = useRouter();
  useEffect(() => {
    maybeTouch();
    const unsub = router.subscribe("onResolved", () => {
      maybeTouch();
    });
    return unsub;
  }, [router]);
}
