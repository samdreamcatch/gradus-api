/**
 * Browser actions shared by the web app: opening links in a new tab and the
 * Web Share API. Every browser touch happens inside a function, so SSR can
 * import this module safely.
 */

/**
 * Open a URL in a new tab, or in the current tab when `window.open` returns
 * nothing. Stripe Checkout and the billing portal go through here.
 */
export async function openExternal(url: string): Promise<void> {
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) window.location.href = url;
}

export type NativeShare = { title?: string; text?: string; url?: string };

/** True when this browser can open the OS share sheet. */
export function canShareNatively(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Open the OS share sheet. Callers keep their clipboard fallback: this
 * rejects the way `navigator.share` does, including the AbortError that
 * means the user cancelled.
 */
export function shareNatively(data: NativeShare): Promise<void> {
  return navigator.share(data);
}
