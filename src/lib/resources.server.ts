/**
 * The role-aware `GET /api/v1/resources` dispatcher (PRD Appendix A, listed
 * once as "role-aware" rather than as three separate endpoints): resolves
 * the caller's role and returns the shape that role's existing resource
 * feed already produces, tagged with a `role` field.
 *
 * Role resolution (`resolveCallerRole` in `caller-role.server.ts`, shared
 * with `POST /api/v1/ask`'s audience resolver so both endpoints agree on
 * who the caller is) reproduces the precedence `GET /api/v1/me` and the
 * web's `getMyRole` (`src/lib/parent-signup.functions.ts`) use, onboarding
 * included: an *onboarded* coach wins outright, otherwise parent, then
 * athlete, then an un-onboarded coach still counts as "coach" (there's no
 * other feed to show them). Onboarding has to be factored in here, not just
 * at `/me` — a caller with a not-yet-onboarded `coach_profiles` row *and* a
 * `parent_profiles`/`athletes` row must resolve to the same role this
 * endpoint and `GET /api/v1/me` both report, or the two disagree about who
 * the caller is. (No `org_admin` branch, since there's no resources feed
 * for that role — a pure org admin falls through to the no-profile case
 * below, same as before.)
 *
 * A caller with no profile at all gets the same empty shape
 * `getParentResources` returns for "no parent profile" (`{ sports: [],
 * resources: [], canAskGradus: true }`), tagged as role `"parent"` —
 * arbitrary but harmless, since there is nothing to show either way.
 *
 * The response is `{ role, coach, parent, athlete }` with exactly one of
 * the three payload fields set (matching `role`) and the other two `null`,
 * rather than a tagged union of three shapes. `zod-to-openapi` does not
 * emit an OpenAPI `discriminator` for `z.discriminatedUnion`, so
 * swift-openapi-generator would otherwise generate an unlabeled
 * case1/case2/case3 enum instead of named cases — a plain object with
 * three named optional fields decodes cleanly on every client with no
 * generator-specific behavior to rely on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveCallerRole, type CallerRole } from "./caller-role.server";
import { listCoachResources, type CoachResourcesDTO } from "./coach-resources.server";
import { getParentResources, type ParentResourcesDTO } from "./parent-resources.server";
import { getAthleteResources, type AthleteResourcesDTO } from "./athlete-resources.server";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

export type ResourcesContext = { userId: string; supabase: Client; admin: Admin };

export type ResourcesRole = CallerRole;

export type RoleAwareResourcesDTO = {
  role: ResourcesRole;
  coach: CoachResourcesDTO | null;
  parent: ParentResourcesDTO | null;
  athlete: AthleteResourcesDTO | null;
};

export async function getResourcesForCaller(ctx: ResourcesContext): Promise<RoleAwareResourcesDTO> {
  const role = await resolveCallerRole(ctx.admin, ctx.userId);
  const inner = { userId: ctx.userId, supabase: ctx.supabase, admin: ctx.admin };
  const empty = { role: "parent" as const, coach: null, parent: null, athlete: null };

  // The store app lists curated rows only when their rights are confirmed
  // (`resources.rights`, migration 20260924120000; PRD §12 #16). This
  // dispatcher serves `GET /api/v1/resources` alone, so the web keeps its
  // full library.
  const storeSafe = { storeSafeOnly: true };
  if (role === "coach") {
    return {
      role: "coach",
      coach: await listCoachResources(inner, storeSafe),
      parent: null,
      athlete: null,
    };
  }
  if (role === "athlete") {
    return {
      role: "athlete",
      coach: null,
      parent: null,
      athlete: await getAthleteResources(inner, storeSafe),
    };
  }
  if (role === "parent") {
    return {
      role: "parent",
      coach: null,
      parent: await getParentResources(inner, storeSafe),
      athlete: null,
    };
  }
  // No profile at all: nothing to show either way (judgment call — see file doc comment).
  return empty;
}
