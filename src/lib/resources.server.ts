/**
 * The role-aware `GET /api/v1/resources` dispatcher (PRD Appendix A, listed
 * once as "role-aware" rather than as three separate endpoints): resolves
 * the caller's role and returns the shape that role's existing resource
 * feed already produces, tagged with a `role` field.
 *
 * Role resolution reproduces the precedence `GET /api/v1/me` and the web's
 * `getMyRole` (`src/lib/parent-signup.functions.ts`) use, onboarding
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
 * resources: [] }`), tagged as role `"parent"` — arbitrary but harmless,
 * since there is nothing to show either way.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";
import { listCoachResources, type CoachResourcesDTO } from "./coach-resources.server";
import { getParentResources, type ParentResourcesDTO } from "./parent-resources.server";
import { getAthleteResources, type AthleteResourcesDTO } from "./athlete-resources.server";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

export type ResourcesContext = { userId: string; supabase: Client; admin: Admin };

export type RoleAwareResourcesDTO =
  | ({ role: "coach" } & CoachResourcesDTO)
  | ({ role: "parent" } & ParentResourcesDTO)
  | ({ role: "athlete" } & AthleteResourcesDTO);

async function resolveRole(
  admin: Admin,
  userId: string,
): Promise<"coach" | "parent" | "athlete" | null> {
  const [coach, parent, athlete] = await Promise.all([
    admin.from("coach_profiles").select("id, onboarded_at").eq("user_id", userId).maybeSingle(),
    admin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
    admin.from("athletes").select("id").eq("user_id", userId).limit(1).maybeSingle(),
  ]);
  const failed = [coach, parent, athlete].find((r) => r.error);
  if (failed?.error) dbError(failed.error);

  if (coach.data?.onboarded_at) return "coach";
  if (parent.data) return "parent";
  if (athlete.data) return "athlete";
  if (coach.data) return "coach";
  return null;
}

export async function getResourcesForCaller(ctx: ResourcesContext): Promise<RoleAwareResourcesDTO> {
  const role = await resolveRole(ctx.admin, ctx.userId);
  const inner = { userId: ctx.userId, supabase: ctx.supabase };

  if (role === "coach") {
    return { role: "coach", ...(await listCoachResources(inner)) };
  }
  if (role === "athlete") {
    return { role: "athlete", ...(await getAthleteResources(inner)) };
  }
  if (role === "parent") {
    return { role: "parent", ...(await getParentResources(inner)) };
  }
  // No profile at all: nothing to show either way (judgment call — see file doc comment).
  return { role: "parent", sports: [], resources: [] };
}
