/**
 * Sanitize database/server errors before they reach the client.
 *
 * Raw Supabase / Postgres error messages routinely include internal table
 * names, column names, and constraint identifiers. Surfacing those verbatim
 * leaks schema details and helps attackers map the database. This helper
 * logs the full error server-side (where developers can see it) and throws
 * a generic, user-safe message to the client.
 *
 * Usage:
 *   if (error) dbError(error);                            // generic fallback
 *   if (error) dbError(error, "Couldn't load plans");     // custom fallback
 */
import { isRosterFullError, rosterFullBackstopMessage } from "./roster-limits";

// Messages raised by our own PL/pgSQL triggers that are safe (and useful) to
// surface verbatim to end users. These are intentional, user-facing validation
// errors — not internal schema details.
const PASSTHROUGH_MESSAGES = [
  "This account is registered as a coach, not a parent.",
  "This account is registered as a parent, not a coach.",
  "Self-managed athletes must be at least 18 years old",
];

export function dbError(
  err: { message?: string; code?: string; details?: string; hint?: string } | null | undefined,
  fallback = "Something went wrong. Please try again.",
): never {
  // Full detail goes to server logs only.
  console.error("[db]", err);
  const msg = err?.message ?? "";
  for (const allowed of PASSTHROUGH_MESSAGES) {
    if (msg.includes(allowed)) {
      throw new Error(allowed);
    }
  }
  // The roster-cap trigger fires from call sites that don't always belong to
  // the coach (e.g. a parent mid-signup via a coach's invite code), so this
  // is deliberately audience-neutral rather than the trigger's own
  // coach-facing "the X plan is limited to N athletes" wording — still
  // matches isRosterFullError() so normalizeError maps it to the same 409
  // `roster_full` code.
  if (isRosterFullError(msg)) {
    throw new Error(rosterFullBackstopMessage);
  }
  const wrapped = new Error(fallback);
  // Keep the raw database detail attached (never serialized to the client —
  // only the message crosses the RPC boundary) so server-side error logging
  // can record what actually failed instead of the generic fallback.
  (wrapped as Error & { dbDetail?: unknown }).dbDetail = {
    message: err?.message ?? null,
    code: err?.code ?? null,
    details: err?.details ?? null,
    hint: err?.hint ?? null,
  };
  throw wrapped;
}

/**
 * Postgres "undefined column" (42703), or PostgREST's schema-cache miss for
 * one (PGRST204): a column whose migration has not been applied yet. Lovable
 * applies migrations separately from code deploys, in either order, so a read
 * of a new column retries without it and a write that needs it answers 503.
 */
export function isMissingColumn(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}
