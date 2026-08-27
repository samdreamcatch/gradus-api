/**
 * Native (Capacitor) shell helpers.
 *
 * The same web bundle runs in three places: a normal browser, an installed
 * PWA, and the Capacitor webview inside the App Store / Play Store builds.
 * Nothing in here may be imported for its side effects — every browser or
 * plugin touch happens inside a function, and every Capacitor plugin is
 * dynamically imported so the SSR build never evaluates it.
 */

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function cap(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True only inside the iOS/Android Capacitor shell. False on web and in SSR. */
export function isNativeApp(): boolean {
  return cap()?.isNativePlatform?.() === true;
}

/** "ios" | "android" | "web" — "web" in SSR and in any browser. */
export function nativePlatform(): "ios" | "android" | "web" {
  const p = cap()?.getPlatform?.();
  return p === "ios" || p === "android" ? p : "web";
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

/**
 * Short tactile confirmation for a completed action. No-ops on the web, and
 * never throws — haptics are a nicety, not a dependency.
 */
export async function haptic(style: "light" | "medium" | "heavy" = "light"): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    const map = {
      light: ImpactStyle.Light,
      medium: ImpactStyle.Medium,
      heavy: ImpactStyle.Heavy,
    } as const;
    await Haptics.impact({ style: map[style] });
  } catch {
    // ignore
  }
}

/** Success/warning/error pattern, for outcomes rather than taps. */
export async function hapticNotify(type: "success" | "warning" | "error"): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    const map = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    } as const;
    await Haptics.notification({ type: map[type] });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// External links
// ---------------------------------------------------------------------------

/**
 * Open a URL outside the app shell. Stripe Checkout and the billing portal
 * MUST go through here: card entry inside an embedded webview is blocked by
 * Stripe and rejected by the app stores. On the web this is a normal
 * navigation so existing behavior is unchanged.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isNativeApp()) {
    window.location.href = url;
    return;
  }
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url, presentationStyle: "popover" });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

export type NativeShare = { title?: string; text?: string; url?: string };

/**
 * True when this runtime can open a real share sheet. Android's system webview
 * has no `navigator.share`, so the Capacitor plugin is the only path there.
 */
export function canShareNatively(): boolean {
  if (isNativeApp()) return true;
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Open the OS share sheet. Callers keep their clipboard fallback: this
 * rejects the same way `navigator.share` does so existing catch blocks
 * (including the AbortError-means-user-cancelled check) still apply.
 */
export function shareNatively(data: NativeShare): Promise<void> {
  if (isNativeApp()) {
    return import("@capacitor/share").then(({ Share }) =>
      Share.share({
        title: data.title,
        text: data.text,
        url: data.url,
        dialogTitle: data.title,
      }).then(() => undefined),
    );
  }
  return navigator.share(data);
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/**
 * Take a photo (or pick one) with the native camera UI and return it as a File
 * so callers can hand it to the same upload/parse code the web input feeds.
 * Returns null when the user cancels.
 */
export async function captureNativePhoto(
  source: "camera" | "photos" = "camera",
): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  const photo = await Camera.getPhoto({
    quality: 80,
    allowEditing: false,
    correctOrientation: true,
    resultType: CameraResultType.Uri,
    source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
  });
  if (!photo.webPath) return null;
  const blob = await fetch(photo.webPath).then((r) => r.blob());
  const ext = photo.format || "jpeg";
  return new File([blob], `schedule-${Date.now()}.${ext}`, {
    type: blob.type || `image/${ext}`,
  });
}

// ---------------------------------------------------------------------------
// Shell initialization
// ---------------------------------------------------------------------------

let initialized = false;

/**
 * Called once from the root component. Sets up status bar styling, Android
 * back-button behavior, and deep-link handling. Safe to call on the web,
 * where it does nothing at all.
 */
export function initNativeShell(): void {
  if (initialized || !isNativeApp()) return;
  initialized = true;

  document.documentElement.classList.add("native-app");
  document.documentElement.dataset["platform"] = nativePlatform();

  void (async () => {
    try {
      const { StatusBar, Style } = await import("@capacitor/status-bar");
      const dark = document.documentElement.classList.contains("dark");
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
      if (nativePlatform() === "android") {
        await StatusBar.setBackgroundColor({ color: dark ? "#161b25" : "#F5F6FA" });
      }
    } catch {
      // ignore
    }

    try {
      const { App } = await import("@capacitor/app");

      // Android hardware back button: walk browser history, and only leave the
      // app from the top of the stack.
      await App.addListener("backButton", ({ canGoBack }) => {
        if (canGoBack) window.history.back();
        else void App.exitApp();
      });

      // Universal / app links — gradus.training URLs routed into the app.
      await App.addListener("appUrlOpen", ({ url }) => {
        try {
          const parsed = new URL(url);
          const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
          if (path && path !== "/") window.location.assign(path);
        } catch {
          // ignore malformed deep links
        }
      });

      // Returning from Stripe (or any system-browser hop) should re-read
      // server state rather than show a stale screen.
      await App.addListener("resume", () => {
        window.dispatchEvent(new CustomEvent("gradus:native-resume"));
      });
    } catch {
      // ignore
    }

    try {
      const { SplashScreen } = await import("@capacitor/splash-screen");
      await SplashScreen.hide();
    } catch {
      // ignore
    }
  })();
}
