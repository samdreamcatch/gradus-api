/** sessionStorage key: the promo code entered on a signup screen, awaiting
 *  application once the user's profile row exists in the database. */
export const PENDING_PROMO_CODE_KEY = "gradus.pendingPromoCode";

export function savePendingPromoCode(code: string) {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return;
  try {
    sessionStorage.setItem(PENDING_PROMO_CODE_KEY, trimmed);
  } catch {
    /* ignore */
  }
}

export function readPendingPromoCode(): string | null {
  try {
    return sessionStorage.getItem(PENDING_PROMO_CODE_KEY);
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
