/**
 * Roster-cap error surface. The DB trigger `enforce_coach_roster_cap` throws
 * a message starting with "Roster full:" — detect that here so UI can turn
 * it into a friendly nudge instead of a raw red toast.
 */
import { athleteLimitForTier, computeEffectiveTier } from "./coach-profile-types";

export function isRosterFullError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /roster full/i.test(msg);
}

/**
 * The single source of truth for the message the app-level pre-check
 * throws (coach-roster.server.ts, invites.server.ts, parent-signup.server.ts):
 * coach-facing, names the tier and cap. Always starts with "Roster full:" so
 * isRosterFullError() recognizes it.
 */
export function rosterFullMessage(tier: string, limit: number): string {
  return `Roster full: the ${tier} plan is limited to ${limit} athletes. Upgrade to add more.`;
}

/**
 * The fallback dbError() throws when the DB trigger itself fires — the
 * backstop for any coach_athletes insert site without (or ahead of) its own
 * pre-check. Deliberately generic: this reaches call sites whose caller
 * isn't always the coach (e.g. a parent mid-signup via a coach invite
 * code), so unlike rosterFullMessage() it never names a tier, a cap number,
 * or an "Upgrade" CTA. Still starts with "Roster full:" so
 * isRosterFullError() recognizes it and the API still maps it to the same
 * 409 `roster_full` code.
 */
export const rosterFullBackstopMessage =
  "Roster full: this coach isn't able to take on more athletes right now.";

/**
 * Pure roster-cap check shared by every coach_athletes insert site (mirrors
 * the DB trigger `enforce_coach_roster_cap`): throws rosterFullMessage()
 * when adding `newLinksCount` more links would put the coach over their
 * plan's cap. Callers compute `currentCount` and `newLinksCount` themselves
 * since each call site has a different cheapest way to get them (a
 * head-only count, or a full roster fetch it already needs for an
 * idempotency check) and a different notion of how many *new* links it's
 * actually about to create (a single add, or a batch minus whichever
 * athletes are already linked).
 */
export function checkRosterRoom(
  coach: { organizationId: string | null; subscriptionTier: "coach" | "coach_pro" | null },
  currentCount: number,
  newLinksCount: number,
): void {
  if (newLinksCount <= 0) return;
  const tier = computeEffectiveTier(coach);
  const limit = athleteLimitForTier(tier);
  if (limit === null) return;
  if (currentCount + newLinksCount > limit) {
    throw new Error(rosterFullMessage(tier, limit));
  }
}

export function coachRosterFullCopy(
  current: number,
  limit: number,
): {
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
