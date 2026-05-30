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
export function dbError(
  err: { message?: string; code?: string; details?: string; hint?: string } | null | undefined,
  fallback = "Something went wrong. Please try again.",
): never {
  // Full detail goes to server logs only.
  console.error("[db]", err);
  throw new Error(fallback);
}
