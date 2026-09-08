/** Shared age helpers for athlete labeling. */

export function isMinorBirthdate(birthdate?: string | null): boolean {
  if (!birthdate) return false;
  const dob = new Date(birthdate);
  if (Number.isNaN(dob.getTime())) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age < 18;
}

/**
 * Eligibility for Ask Gradus's athlete persona (Mariah's call, 2026-09-07 —
 * a non-negotiable safety decision, not just a UI preference): Ask Gradus
 * must be intentionally unavailable to athletes under 18, so only a
 * *confirmed* 18-or-older athlete is eligible.
 *
 * `isMinorBirthdate` treats a missing/invalid birthdate as "not a minor" —
 * a fine default for display labeling, but wrong here. This function
 * applies the conservative convention this codebase already uses for
 * safety-relevant minor checks elsewhere (`resetParentAthletePassword`'s
 * guard in `parent-settings.server.ts`): no birthdate on file, OR a
 * birthdate that doesn't parse, means age is UNCONFIRMED, which is treated
 * the same as a confirmed minor — refused, never assumed adult. So this is
 * deliberately not just `!isMinorBirthdate`, which would (wrongly) treat an
 * unparseable birthdate as eligible.
 */
export function canAskGradus(birthdate: string | null | undefined): boolean {
  if (!birthdate) return false;
  const dob = new Date(birthdate);
  if (Number.isNaN(dob.getTime())) return false;
  return !isMinorBirthdate(birthdate);
}
