// Recovery for stale-deploy chunk failures.
//
// After a new deploy, a browser (or a service worker that cached an older app
// shell) can still hold references to /assets/*.js files that no longer exist.
// The dynamic import for a route then fails with "Importing a module script
// failed" / "Failed to fetch dynamically imported module" and the router shows
// its error screen. The only real cure is to drop the caches and reload once.

const RELOAD_FLAG = "gradus:chunk-reload";
/** Minimum gap between two recovery attempts. */
const MIN_GAP_MS = 60 * 1000;
/** Rolling window and cap so a genuinely broken deploy cannot loop forever. */
const WINDOW_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 3;

const MODULE_ERROR_PATTERNS = [
  "importing a module script failed",
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "'text/html' is not a valid javascript mime type",
  "expected a javascript module script",
];

/** True when the error looks like a missing/stale JS chunk rather than app logic. */
export function isModuleLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ((error as { message?: unknown } | null)?.message as string | undefined) ?? "";
  const lower = message.toLowerCase();
  return MODULE_ERROR_PATTERNS.some((p) => lower.includes(p));
}

async function dropCaches(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // ignore
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // ignore
  }
}

/**
 * Clears service-worker + cache storage and hard-reloads, at most once per tab
 * session so a genuinely broken deploy cannot cause a reload loop.
 * Returns true when a recovery reload was started.
 */
export function recoverFromStaleChunks(): boolean {
  if (typeof window === "undefined") return false;
  // A chunk can also fail to load simply because the device is offline. Wiping
  // caches and reloading then leaves the user with a blank page, so never
  // recover while offline — the import will succeed again once back online.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return false;
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // Storage blocked (private mode) — skip rather than risk a loop.
    return false;
  }
  void dropCaches().finally(() => {
    window.location.reload();
  });
  return true;
}


/** Listens for uncaught chunk-load failures anywhere in the app. */
export function installChunkErrorRecovery(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    if (isModuleLoadError((event as ErrorEvent).error ?? event.message)) {
      recoverFromStaleChunks();
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isModuleLoadError((event as PromiseRejectionEvent).reason)) {
      recoverFromStaleChunks();
    }
  });
}
