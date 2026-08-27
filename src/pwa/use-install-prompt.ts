import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { isNativeApp } from "@/lib/native";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallStatus = "hidden" | "installable" | "ios-instructions";
export type InstallPlatform = "none" | "installable" | "ios";

// v2: bumping the key invalidates every previously stored dismissal so the
// banner reappears once for returning users, then the normal snooze kicks in.
const DISMISS_KEY = "gradus.installBannerDismissedAt.v2";
const DISMISS_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const SHOW_DELAY_MS = 3000;

function shouldRefuseEnv(): boolean {
  if (typeof window === "undefined") return true;
  if (!import.meta.env.PROD) return true;
  // Already a real installed app — never offer "add to home screen".
  if (isNativeApp()) return true;
  try {
    if (window.top !== window.self) return true;
  } catch {
    return true;
  }
  const host = window.location.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) return true;
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return true;
  return false;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  if ((window.navigator as unknown as { standalone?: boolean }).standalone) return true;
  return false;
}

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = ua.includes("Macintosh") && "ontouchend" in document;
  return iOSDevice || iPadOS;
}

function isIosSafari(): boolean {
  if (!isIos()) return false;
  const ua = window.navigator.userAgent;
  if (/FBAN|FBAV|Instagram|Line|Snapchat|MicroMessenger/i.test(ua)) return false;
  return true;
}

function dismissedRecently(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared module-level store so multiple components (banner + settings row)
// see and drive the same install state.
// ---------------------------------------------------------------------------

type State = {
  status: InstallStatus;
  platform: InstallPlatform;
  deferred: BeforeInstallPromptEvent | null;
};

let state: State = { status: "hidden", platform: "none", deferred: null };
const listeners = new Set<() => void>();
let initialized = false;
let autoShowTimer: ReturnType<typeof setTimeout> | null = null;

function setState(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot(): State {
  return state;
}

const SERVER_SNAPSHOT: State = { status: "hidden", platform: "none", deferred: null };
function getServerSnapshot(): State {
  return SERVER_SNAPSHOT;
}

function initOnce() {
  if (initialized) return;
  initialized = true;
  if (shouldRefuseEnv()) return;
  if (isStandalone()) return;

  const onBeforeInstall = (e: Event) => {
    e.preventDefault();
    const evt = e as BeforeInstallPromptEvent;
    setState({ deferred: evt, platform: "installable" });
    if (!dismissedRecently()) {
      if (autoShowTimer) clearTimeout(autoShowTimer);
      autoShowTimer = setTimeout(() => setState({ status: "installable" }), SHOW_DELAY_MS);
    }
  };

  const onInstalled = () => {
    setState({ status: "hidden", platform: "none", deferred: null });
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_TTL_MS * 52));
    } catch {
      // ignore
    }
  };

  window.addEventListener("beforeinstallprompt", onBeforeInstall);
  window.addEventListener("appinstalled", onInstalled);

  if (isIosSafari()) {
    setState({ platform: "ios" });
    if (!dismissedRecently()) {
      if (autoShowTimer) clearTimeout(autoShowTimer);
      autoShowTimer = setTimeout(() => setState({ status: "ios-instructions" }), SHOW_DELAY_MS);
    }
  }
}

export function useInstallPrompt() {
  useEffect(() => {
    initOnce();
  }, []);

  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const promptInstall = useCallback(async () => {
    const d = state.deferred;
    if (!d) return;
    try {
      await d.prompt();
      const choice = await d.userChoice;
      if (choice.outcome === "accepted" || choice.outcome === "dismissed") {
        setState({ status: "hidden", deferred: null });
      }
    } catch {
      setState({ status: "hidden" });
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setState({ status: "hidden" });
  }, []);

  const show = useCallback(() => {
    try {
      window.localStorage.removeItem(DISMISS_KEY);
    } catch {
      // ignore
    }
    if (state.platform === "installable") setState({ status: "installable" });
    else if (state.platform === "ios") setState({ status: "ios-instructions" });
  }, []);

  // Keep a no-op useState so the hook signature/behavior stays stable if
  // React fast-refresh remounts the module.
  useState(0);

  return {
    status: snap.status,
    platform: snap.platform,
    promptInstall,
    dismiss,
    show,
  };
}
