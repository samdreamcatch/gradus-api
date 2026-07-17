/**
 * Roster-cap error surface. The DB trigger `enforce_coach_roster_cap` throws
 * a message starting with "Roster full:" — detect that here so UI can turn
 * it into a friendly nudge instead of a raw red toast.
 */
export function isRosterFullError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /roster full/i.test(msg);
}

export function coachRosterFullCopy(current: number, limit: number): {
  title: string;
  description: string;
} {
  return {
    title: "Roster's full",
    description: `You're at ${current} of ${limit} athletes on the Coach plan. Upgrade to Coach Pro to add up to 50.`,
  };
}

export const coachProSoonDescription =
  "Coach Pro is coming soon — it'll raise this to 50 athletes.";
