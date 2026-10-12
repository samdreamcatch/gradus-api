// Bump this when terms change to require re-acceptance.
export const CURRENT_TERMS_VERSION = "2026-10-11";

// localStorage key set on the signup form when the user checks the terms box,
// then consumed by the authed layout after the session lands. Wrapped in a
// timestamped envelope with a 15 min expiry so a cancelled/abandoned OAuth
// attempt can't apply terms acceptance to a different account signed in on
// the same browser later.
export const PENDING_TERMS_ACCEPT_KEY = "gradus.pendingTermsAccept";

const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

type Stash = { stashedAt: number };

export function stashPendingTermsAccept() {
  try {
    const payload: Stash = { stashedAt: Date.now() };
    localStorage.setItem(PENDING_TERMS_ACCEPT_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** Returns true if a non-expired pending-accept marker is present. Clears
 *  the entry when it's absent, malformed, or expired. */
export function readPendingTermsAccept(): boolean {
  try {
    const raw = localStorage.getItem(PENDING_TERMS_ACCEPT_KEY);
    if (!raw) return false;
    // Back-compat: previous versions stored a bare role string like "coach".
    // Treat as expired and clear.
    if (!raw.startsWith("{")) {
      localStorage.removeItem(PENDING_TERMS_ACCEPT_KEY);
      return false;
    }
    const parsed = JSON.parse(raw) as Partial<Stash>;
    if (
      !parsed ||
      typeof parsed.stashedAt !== "number" ||
      Date.now() - parsed.stashedAt > MAX_AGE_MS
    ) {
      localStorage.removeItem(PENDING_TERMS_ACCEPT_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearPendingTermsAccept() {
  try {
    localStorage.removeItem(PENDING_TERMS_ACCEPT_KEY);
  } catch {
    /* ignore */
  }
}
