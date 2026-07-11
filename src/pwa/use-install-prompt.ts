import { useEffect, useState, useCallback } from "react";

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
  // iOS Safari
  if ((window.navigator as unknown as { standalone?: boolean }).standalone) return true;
  return false;
}

function isIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as Mac; detect touch
  const iPadOS = ua.includes("Macintosh") && "ontouchend" in document;
  return iOSDevice || iPadOS;
}

function isIosSafari(): boolean {
  if (!isIos()) return false;
  const ua = window.navigator.userAgent;
  // Exclude only in-app webviews where Add to Home Screen isn't reachable.
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

export function useInstallPrompt() {
  const [status, setStatus] = useState<InstallStatus>("hidden");
  const [platform, setPlatform] = useState<InstallPlatform>("none");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (shouldRefuseEnv()) return;
    if (isStandalone()) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      const evt = e as BeforeInstallPromptEvent;
      setDeferred(evt);
      setPlatform("installable");
      if (!dismissedRecently()) {
        timer = setTimeout(() => setStatus("installable"), SHOW_DELAY_MS);
      }
    };

    const onInstalled = () => {
      setStatus("hidden");
      setPlatform("none");
      setDeferred(null);
      try {
        window.localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_TTL_MS * 52));
      } catch {
        // ignore
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS Safari never fires beforeinstallprompt — show instructions after delay
    if (isIosSafari()) {
      setPlatform("ios");
      if (!dismissedRecently()) {
        timer = setTimeout(() => setStatus("ios-instructions"), SHOW_DELAY_MS);
      }
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted" || choice.outcome === "dismissed") {
        setStatus("hidden");
        setDeferred(null);
      }
    } catch {
      setStatus("hidden");
    }
  }, [deferred]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setStatus("hidden");
  }, []);

  const show = useCallback(() => {
    try {
      window.localStorage.removeItem(DISMISS_KEY);
    } catch {
      // ignore
    }
    if (platform === "installable") setStatus("installable");
    else if (platform === "ios") setStatus("ios-instructions");
  }, [platform]);

  return { status, platform, promptInstall, dismiss, show };
}
