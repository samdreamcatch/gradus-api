/**
 * "Open in the Gradus app" for signed-out visitors on public pages.
 *
 * Tapping a gradus.training link from a gradus.training page never fires the
 * universal link (iOS keeps same-domain taps in Safari), so the app is opened
 * through its custom scheme instead. The iOS app's `RouteParser` reads
 * `gradus://<path>` the same as `https://gradus.training/<path>`.
 *
 * If the app opens, the page goes to the background before the fallback
 * timer fires. If the page is still visible, the app isn't installed and the
 * visitor goes to the App Store. Off iOS there is no app to open, so the
 * App Store is the destination straight away.
 */
export const APP_STORE_URL = "https://apps.apple.com/us/app/gradus-training/id6816124994";

const APP_SCHEME = "gradus";
const FALLBACK_MS = 2000;

/** `p/abc` or `/p/abc` → `gradus://p/abc`. */
export function appSchemeUrl(path: string): string {
  return `${APP_SCHEME}://${path.replace(/^\/+/, "")}`;
}

/** iPhone, iPod, or iPad (iPadOS reports itself as a Mac with touch). */
export function isIOSDevice(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/** Opens `path` in the iOS app, or the App Store when the app isn't installed. */
export function openInAppOrStore(path: string): void {
  if (typeof window === "undefined") return;
  if (!isIOSDevice(navigator.userAgent, navigator.maxTouchPoints)) {
    window.location.href = APP_STORE_URL;
    return;
  }

  let left = false;
  const onHide = () => {
    if (document.visibilityState === "hidden") left = true;
  };
  const onPageHide = () => {
    left = true;
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);

  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
    if (!left && document.visibilityState === "visible") window.location.href = APP_STORE_URL;
  }, FALLBACK_MS);

  window.location.href = appSchemeUrl(path);
}
