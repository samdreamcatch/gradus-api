/**
 * Sending a coach back to the iOS app after a plan change on the web.
 *
 * The app opens billing pages through `/auth/handoff`, which marks this tab.
 * Once checkout or a plan switch succeeds on the paywall, the tab opens
 * `gradus://billing/updated`: the app comes back to the front and reloads the
 * coach's tier on the screen they left. Plain web visits never get the mark,
 * so they behave as before.
 */
const KEY = "gradus.fromApp";

export const APP_BILLING_UPDATED_URL = "gradus://billing/updated";

export function markOpenedFromApp(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage blocked: the coach switches back to the app by hand.
  }
}

/** Opens the app when this tab came from it. True when it did. */
export function returnToAppAfterBilling(): boolean {
  if (typeof window === "undefined") return false;
  let fromApp = false;
  try {
    fromApp = window.sessionStorage.getItem(KEY) === "1";
    if (fromApp) window.sessionStorage.removeItem(KEY);
  } catch {
    return false;
  }
  if (fromApp) window.location.href = APP_BILLING_UPDATED_URL;
  return fromApp;
}
