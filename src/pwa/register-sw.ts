// Guarded service worker registration. Refuses to register in dev,
// inside Lovable preview iframes, on Lovable preview hostnames, or
// when the URL has ?sw=off. In any refused context, unregisters any
// existing /sw.js registration so stale workers do not stick around.

import { isNativeApp } from "@/lib/native";

const SW_URL = "/sw.js";

/** Dispatched on `window` when a newer build has been downloaded and is waiting. */
export const SW_UPDATE_EVENT = "gradus:sw-update";

/** How often an open session re-checks for a newer build. */
const UPDATE_POLL_MS = 30 * 60 * 1000;

function announceUpdate(waiting: ServiceWorker | null): void {
  window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT, { detail: { waiting } }));
}

function watchForUpdates(reg: ServiceWorkerRegistration): void {
  // Already downloaded and waiting when we registered.
  if (reg.waiting && navigator.serviceWorker.controller) announceUpdate(reg.waiting);

  reg.addEventListener("updatefound", () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // A worker reaching "installed" while one is already controlling the
      // page means this is an update, not a first install.
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        announceUpdate(reg.waiting ?? installing);
      }
    });
  });

  const check = () => {
    void reg.update().catch(() => undefined);
  };
  window.setInterval(check, UPDATE_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
}

let reloadedForNewWorker = false;

/**
 * When a newer worker takes control of this page, its assets may differ from
 * the ones this document loaded. Reload exactly once. A first install has no
 * previous controller, so nothing is stale and no reload is needed.
 */
function watchForControllerChange(hadController: boolean): void {
  if (!hadController) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForNewWorker) return;
    reloadedForNewWorker = true;
    window.location.reload();
  });
}

function shouldRefuse(): boolean {
  if (typeof window === "undefined") return true;
  if (!("serviceWorker" in navigator)) return true;
  if (!import.meta.env.PROD) return true;
  // Inside the Capacitor shell the native app owns caching and updates.
  if (isNativeApp()) return true;

  try {
    if (window.top !== window.self) return true;
  } catch {
    // Cross-origin iframe access throws — treat as iframe.
    return true;
  }

  const host = window.location.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) return true;
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return true;

  if (new URLSearchParams(window.location.search).has("sw")) {
    if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  }

  return false;
}

async function unregisterExisting(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((r) => {
          const url = r.active?.scriptURL ?? r.installing?.scriptURL ?? r.waiting?.scriptURL ?? "";
          return url.endsWith(SW_URL);
        })
        .map((r) => r.unregister()),
    );
  } catch {
    // ignore
  }
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  if (shouldRefuse()) {
    void unregisterExisting();
    return;
  }

  window.addEventListener("load", () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker
      .register(SW_URL, { type: "classic", scope: "/" })
      .then((reg) => {
        watchForUpdates(reg);
        watchForControllerChange(hadController);
      })
      .catch((err) => {
        console.warn("[pwa] service worker registration failed", err);
      });
  });
}
