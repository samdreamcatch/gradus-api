// Client-side marker for an active admin "view as user" session. Stored in
// sessionStorage so it dies with the tab and can never leak into a normal
// sign-in on another tab.

const KEY = "gradus.impersonating";

export type ImpersonationMarker = { email: string; startedAt: string };

export function markImpersonating(email: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ email, startedAt: new Date().toISOString() }));
  } catch {
    /* storage unavailable — banner just won't show */
  }
}

export function readImpersonating(): ImpersonationMarker | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.email === "string" ? (parsed as ImpersonationMarker) : null;
  } catch {
    return null;
  }
}

export function clearImpersonating() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
