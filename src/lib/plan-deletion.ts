/**
 * Delete replaces Bench (PRD decision #67): a deleted plan waits in Recently
 * deleted for 30 days, then the database removes it (`purge_deleted_plans`,
 * migration 20261112130000). The stored status is still `benched`; the plan's
 * `deleted_at` is when the clock started. The number lives here for the
 * server's answers and in that migration for the removal itself.
 */
export const DELETED_PLAN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a deleted plan will be removed for good, as an ISO time; undefined for
 * a plan that is not deleted (or a row from before the clock existed, which
 * the migration back-filled). Optional on the wire, so an installed client
 * never fails to decode a server that predates it.
 */
export function purgeAtOf(deletedAt: string | null | undefined): string | undefined {
  if (!deletedAt) return undefined;
  const started = Date.parse(deletedAt);
  if (Number.isNaN(started)) return undefined;
  return new Date(started + DELETED_PLAN_DAYS * DAY_MS).toISOString();
}

/** `{ purgeAt }` to spread into a response, or nothing. */
export function purgeAtField(deletedAt: string | null | undefined): { purgeAt?: string } {
  const purgeAt = purgeAtOf(deletedAt);
  return purgeAt ? { purgeAt } : {};
}
