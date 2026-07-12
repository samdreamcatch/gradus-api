/** sessionStorage key: the promo code entered on a signup screen, awaiting
 *  application once the user's profile row exists in the database.
 *  Wrapped in a timestamped envelope so stale entries can't cross-apply to a
 *  different account on the same browser (belt-and-suspenders on top of
 *  sessionStorage's per-tab scope). */
export const PENDING_PROMO_CODE_KEY = "gradus.pendingPromoCode";

const MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

type Stash = { code: string; stashedAt: number };

export function savePendingPromoCode(code: string) {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return;
  try {
    const payload: Stash = { code: trimmed, stashedAt: Date.now() };
    sessionStorage.setItem(PENDING_PROMO_CODE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function readPendingPromoCode(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PROMO_CODE_KEY);
    if (!raw) return null;
    // Back-compat: previous versions stored the bare code string.
    if (!raw.startsWith("{")) {
      sessionStorage.removeItem(PENDING_PROMO_CODE_KEY);
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<Stash>;
    if (
      !parsed ||
      typeof parsed.code !== "string" ||
      typeof parsed.stashedAt !== "number" ||
      Date.now() - parsed.stashedAt > MAX_AGE_MS
    ) {
      sessionStorage.removeItem(PENDING_PROMO_CODE_KEY);
      return null;
    }
    return parsed.code;
  } catch {
    return null;
  }
}

export function clearPendingPromoCode() {
  try {
    sessionStorage.removeItem(PENDING_PROMO_CODE_KEY);
  } catch {
    /* ignore */
  }
}
