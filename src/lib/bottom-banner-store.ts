import { useSyncExternalStore } from "react";

/**
 * Tiny global flag set by any component that renders a fixed-bottom banner
 * (install prompt, lesson wrap-up, etc.) so the feedback FAB can yield
 * to avoid visual collisions. Use `useBottomBannerLock(active)` inside the
 * banner component; the FAB calls `useBottomBannerLocked()`.
 */
import { useEffect } from "react";

let count = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return count > 0;
}

export function useBottomBannerLocked() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Increments the lock while `active` is true. Decrements on unmount/change. */
export function useBottomBannerLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    count += 1;
    emit();
    return () => {
      count -= 1;
      emit();
    };
  }, [active]);
}
