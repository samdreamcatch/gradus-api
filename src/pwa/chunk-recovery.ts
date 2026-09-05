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

/** Recent recovery attempt timestamps, oldest first, within the rolling window. */
function readAttempts(now: number): number[] | null {
  try {
    const raw = localStorage.getItem(RELOAD_FLAG);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const list = Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number") : [];
    return list.filter((t) => now - t < WINDOW_MS).sort((a, b) => a - b);
  } catch {
    return null;
  }
}

function writeAttempts(attempts: number[]): boolean {
  try {
    localStorage.setItem(RELOAD_FLAG, JSON.stringify(attempts));
    return true;
  } catch {
    return false;
  }
}

/** True when the network really is reachable (not just `navigator.onLine`). */
async function isReachable(): Promise<boolean> {
  try {
    await fetch("/", { method: "HEAD", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears service-worker + cache storage and hard-reloads, rate-limited to one
 * attempt per minute and three per hour so a genuinely broken deploy cannot
 * cause a reload loop. Never runs while offline — wiping caches then would
 * leave the user with a blank page.
 * Resolves true when a recovery reload was started.
 */
export async function recoverFromStaleChunks(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;

  const now = Date.now();
  const attempts = readAttempts(now);
  // Storage blocked (private mode) — skip rather than risk a loop.
  if (attempts === null) return false;
  const last = attempts[attempts.length - 1];
  if (last !== undefined && now - last < MIN_GAP_MS) return false;
  if (attempts.length >= MAX_ATTEMPTS_PER_WINDOW) return false;

  // `navigator.onLine` lies on captive portals and flaky mobile links.
  if (!(await isReachable())) return false;

  if (!writeAttempts([...attempts, now])) return false;

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
      void recoverFromStaleChunks();
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isModuleLoadError((event as PromiseRejectionEvent).reason)) {
      void recoverFromStaleChunks();
    }
  });
}
