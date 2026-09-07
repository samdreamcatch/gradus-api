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
 * Whether Ask Gradus's athlete persona may be shown to this caller. Unlike
 * `isMinorBirthdate`, a missing or unparseable birthdate is treated as
 * UNCONFIRMED age and refused (`false`) rather than assumed adult — this
 * gates a feature, not just a display label.
 */
export function canAskGradus(birthdate: string | null | undefined): boolean {
  if (!birthdate) return false;
  if (Number.isNaN(new Date(birthdate).getTime())) return false;
  return !isMinorBirthdate(birthdate);
}
