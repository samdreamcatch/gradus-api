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
