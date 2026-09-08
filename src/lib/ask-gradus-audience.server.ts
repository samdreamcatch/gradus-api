/**
 * The trust boundary for `POST /api/v1/ask`'s `audience` (Mariah's call,
 * 2026-09-07 — a non-negotiable product/safety decision, not just a UI
 * preference): Ask Gradus must be intentionally unavailable to athletes
 * under 18.
 *
 * Before this module existed, `POST /api/v1/ask` had zero identity
 * awareness — `audience` was entirely client-supplied and untrusted, so any
 * caller, including a minor athlete's own account, could pass
 * `audience: "athlete"` and get the athlete persona. This resolves the
 * TRUSTED audience server-side instead, from the caller's real role
 * (`resolveCallerRole`, shared with `GET /api/v1/resources`) and — only for
 * a caller who *is* an athlete — a fresh, authoritative read of that
 * athlete's birthdate. The client-supplied audience is never trusted for
 * this decision:
 *
 *   - caller resolves to athlete: eligible (birthdate on file AND
 *     confirmed 18+, via `canAskGradus` in `athlete-age.ts`) → "athlete".
 *     Not eligible (no birthdate on file, or confirmed under 18) → refused
 *     with a coded `ApiError`, never silently downgraded.
 *   - caller resolves to coach, parent, or no profile at all → "parent",
 *     always — only a confirmed-eligible athlete ever receives the athlete
 *     persona.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { resolveCallerRole } from "./caller-role.server";
import { canAskGradus } from "./athlete-age";
import type { AskGradusInput } from "./ask-gradus.server";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

export type AskGradusAudienceContext = { userId: string; supabase: Client; admin: Admin };

const askGradusUnavailable = () =>
  new ApiError({
    code: "ask_gradus_unavailable",
    status: 403,
    message: "Ask Gradus isn't available for this account.",
  });

/**
 * Resolves the trusted `audience` to actually pass to `askGradus`, ignoring
 * whatever `clientAudience` the request body asked for. Kept as an explicit
 * parameter (rather than dropped from the signature) so the call site keeps
 * the client's request visible for logging/auditing, even though it never
 * influences the result.
 */
export async function resolveAskGradusAudience(
  ctx: AskGradusAudienceContext,
  clientAudience: AskGradusInput["audience"],
): Promise<AskGradusInput["audience"]> {
  const role = await resolveCallerRole(ctx.admin, ctx.userId);

  if (role !== "athlete") return "parent";

  const { data: athlete, error } = await ctx.admin
    .from("athletes")
    .select("birthdate")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) dbError(error);

  if (!canAskGradus(athlete?.birthdate ?? null)) {
    throw askGradusUnavailable();
  }
  if (clientAudience !== "athlete") {
    // Not a security concern (the trusted result below is what's actually
    // used) — just a sign the client's own eligibility check is out of
    // sync with the server's, worth knowing about.
    console.warn("[ask-gradus] eligible athlete's request asked for a different audience", {
      clientAudience,
    });
  }
  return "athlete";
}
