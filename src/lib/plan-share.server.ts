/**
 * Plan sharing (PRD §7.3 "Plan sharing"): a permanent share token for a
 * plan, the public anonymized snapshot behind `/p/:token`, and importing a
 * shared plan as a template. Single source of truth for
 * plan-share.functions.ts and the `/api/v1/plans/{id}/share-token`,
 * `/api/v1/public/plans/{token}`, and `/api/v1/plans/import/{token}` routes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { isAthletePaused, PAUSED_MESSAGE } from "./athlete-authoring.server";

type Client = SupabaseClient<Database>;

export type ShareContext = { userId: string; supabase: Client; admin: Client };

export type TargetKind = "reps" | "mins";

export interface SharedPlanMoveDTO {
  position: number;
  name: string;
  description: string;
  cue: string;
  why: string;
  targetKind: TargetKind;
  targetValue: number;
}

export interface SharedPlanDTO {
  title: string;
  notes: string;
  /** For a plan an athlete wrote these are empty; read `authorFirstName`. */
  coachFirstName: string;
  coachLastName: string;
  sharedAt: string | null;
  moves: SharedPlanMoveDTO[];
  /** `"coach"` or `"athlete"`; omitted by a database that predates athlete-authored plans (treat as coach). */
  authorKind?: string;
  /** The author's first name and nothing else about them: "Plan by Greta" / "Plan by Coach Renata". */
  authorFirstName?: string;
}

function randomToken(bytes = 12): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  // URL-safe base36-ish encoding
  return Array.from(buf, (b) => b.toString(36).padStart(2, "0")).join("");
}

/**
 * A permanent share link for a plan, generated on first call. Allowed for
 * the owning coach, any coach linked to the plan's athlete, the athlete
 * themselves, and the athlete's parent. Idempotent.
 *
 * A plan the athlete wrote (PRD §6.14) is published under their first name,
 * so only the athlete and their parent may mint its link: a rostered coach,
 * who can read it, cannot publish it.
 */
export async function getOrCreateShareToken(
  ctx: ShareContext,
  planId: string,
  now: Date = new Date(),
): Promise<{ token: string }> {
  const { supabase, admin } = ctx;

  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("id, share_token, coach_id, athlete_id, source")
    .eq("id", planId)
    .maybeSingle();
  if (planErr) dbError(planErr);
  if (!plan) throw new ApiError({ code: "not_found", status: 404, message: "Plan not found." });

  let authorized = false;
  const athleteAuthored = plan.source === "athlete";

  const { data: coach } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (coach && coach.id === plan.coach_id) authorized = true;

  // Coaches who share the plan's athlete can also share the plan (not one the athlete wrote).
  if (!authorized && !athleteAuthored && coach && plan.athlete_id) {
    const { data: link } = await supabase
      .from("coach_athletes")
      .select("coach_id")
      .eq("coach_id", coach.id)
      .eq("athlete_id", plan.athlete_id)
      .maybeSingle();
    if (link) authorized = true;
  }

  if (!authorized && plan.athlete_id) {
    const { data: athlete } = await supabase
      .from("athletes")
      .select("id, user_id, parent_id")
      .eq("id", plan.athlete_id)
      .maybeSingle();
    if (athlete) {
      if (athlete.user_id && athlete.user_id === ctx.userId) {
        authorized = true;
      } else if (athlete.parent_id) {
        const { data: parent } = await supabase
          .from("parent_profiles")
          .select("id")
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (parent && parent.id === athlete.parent_id) authorized = true;
      }
    }
  }

  if (!authorized) {
    throw new ApiError({
      code: "forbidden",
      status: 403,
      message: "Not allowed to share this plan.",
    });
  }

  // The link below is written with the admin client, which RLS cannot stop: a
  // paused athlete (§6.13) publishes nothing, and their existing links already
  // resolve to nothing.
  if (athleteAuthored && plan.athlete_id && (await isAthletePaused(admin, plan.athlete_id))) {
    throw new ApiError({ code: "paused", status: 403, message: PAUSED_MESSAGE });
  }

  if (plan.share_token) return { token: plan.share_token };

  // Write with admin client — athletes/parents don't have UPDATE rights on
  // plans, and the caller has already been authorized above.
  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const token = randomToken();
    const { error } = await admin
      .from("plans")
      .update({ share_token: token, shared_at: now.toISOString() })
      .eq("id", plan.id)
      .is("share_token", null);
    if (!error) return { token };
    lastErr = error;
    const { data: refetch } = await admin
      .from("plans")
      .select("share_token")
      .eq("id", plan.id)
      .maybeSingle();
    if (refetch?.share_token) return { token: refetch.share_token };
  }
  dbError(lastErr as never);
  throw new Error("Could not generate share link.");
}

export interface SharePublicEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

/** Public read: a share token resolves to a safe, anonymized snapshot, or null when unknown. */
export async function getSharedPlanPublic(
  token: string,
  env: SharePublicEnv = process.env,
): Promise<SharedPlanDTO | null> {
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase not configured");
  }
  const supabasePublic = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data: json, error } = await supabasePublic.rpc("get_shared_plan", { _token: token });
  if (error) dbError(error);
  if (!json) return null;
  return json as unknown as SharedPlanDTO;
}

/** Coach action: import a shared plan into the caller's library as a template. */
export async function importSharedPlan(
  ctx: Pick<ShareContext, "supabase">,
  token: string,
): Promise<{ planId: string }> {
  const { data: newId, error } = await ctx.supabase.rpc("import_shared_plan", { _token: token });
  if (error) dbError(error);
  if (!newId) {
    throw new ApiError({
      code: "unprocessable",
      status: 422,
      message: "Could not save this plan.",
    });
  }
  return { planId: newId as unknown as string };
}
