/**
 * Carries the date of birth (and, for minors, the guardian email) typed on the
 * athlete entry screen across the account-creation hop into onboarding.
 * Session-scoped and non-authoritative — the server re-validates both.
 */
const KEY = "gradus.pendingAthleteDob";

export interface PendingAthleteDob {
  birthdate: string;
  guardianEmail?: string;
}

export function savePendingAthleteDob(value: PendingAthleteDob) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function readPendingAthleteDob(): PendingAthleteDob | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingAthleteDob;
    if (!parsed?.birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.birthdate)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingAthleteDob() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Whole years old on today's date. */
export function ageInYears(birthdate: string): number {
  const [y, m, d] = birthdate.split("-").map(Number);
  const today = new Date();
  let age = today.getUTCFullYear() - y;
  const beforeBirthday =
    today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}
