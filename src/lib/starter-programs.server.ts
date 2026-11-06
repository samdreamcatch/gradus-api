import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import {
  resolveStarterPrograms,
  staleStarterTitles,
  starterMoveCopy,
  starterTitlesForSport,
} from "@/data/starter-programs";

const titlesForSport = starterTitlesForSport;

/**
 * Create the Gradus starter program(s) for an athlete's sport + level.
 *
 * Idempotent: if the athlete already has a Gradus plan for this sport we leave
 * it alone (a level change never swaps programs — logged sessions stay intact).
 * Never throws; a failure here must not block signup.
 */
export async function ensureStarterPrograms(
  athleteId: string,
  sport: string,
  levelKey: string,
): Promise<void> {
  try {
    const programs = resolveStarterPrograms(sport, levelKey);
    if (!programs.length) return;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const existing = await supabaseAdmin
      .from("plans")
      .select("title")
      .eq("athlete_id", athleteId)
      .eq("source", "gradus");
    if (existing.error) return;

    const sportTitles = titlesForSport(sport);
    const hasAnyForSport = (existing.data ?? []).some((p) => sportTitles.has(p.title));
    if (hasAnyForSport) return;

    for (const program of programs) {
      const inserted = await supabaseAdmin
        .from("plans")
        .insert({
          coach_id: null,
          athlete_id: athleteId,
          kind: "plan",
          title: program.title,
          notes: "",
          status: "active",
          source: "gradus",
        })
        .select("id")
        .single();
      if (inserted.error || !inserted.data) continue;

      const moves = program.moves.map((m) => ({
        plan_id: inserted.data.id,
        move_id: null,
        position: m.position,
        name: m.name,
        description: m.description,
        cue: m.cue,
        why: m.why,
        target_kind: "reps",
        target_value: 1,
      }));
      await supabaseAdmin.from("plan_moves").insert(moves);
    }
  } catch {
    // Starter programs are a nice-to-have; never block the caller.
  }
}

/**
 * One-time repair for starter plans created before moves carried coaching copy.
 * Only touches Gradus plan moves that are still missing a cue.
 */
async function repairStarterMoveCopy(athleteId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const plans = await supabaseAdmin
      .from("plans")
      .select("id")
      .eq("athlete_id", athleteId)
      .eq("source", "gradus");
    if (plans.error || !plans.data?.length) return;

    const planIds = plans.data.map((p) => p.id);
    const stale = await supabaseAdmin
      .from("plan_moves")
      .select("id, name")
      .in("plan_id", planIds)
      .eq("cue", "");
    if (stale.error || !stale.data?.length) return;

    await Promise.all(
      stale.data.map((m) => {
        const copy = starterMoveCopy(m.name);
        return supabaseAdmin
          .from("plan_moves")
          .update({ description: copy.description, cue: copy.cue, why: copy.why })
          .eq("id", m.id);
      }),
    );
  } catch {
    // never block the caller
  }
}

/**
 * One-time repair for athletes seeded with another level's program — every
 * level at Juvenile or below got "Juvenile — Free Skate" until 2026-11-05.
 * A Gradus plan for the sport whose title belongs to a different level is
 * removed when nothing was ever logged against it, so the right one can be
 * seeded; a plan with sessions stays (logged work is never thrown away).
 * Adopted plans are no longer `source = gradus` and are never touched.
 */
async function replaceWrongLevelStarters(
  athleteId: string,
  sport: string,
  levelKey: string,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const plans = await supabaseAdmin
      .from("plans")
      .select("id, title")
      .eq("athlete_id", athleteId)
      .eq("source", "gradus");
    if (plans.error || !plans.data?.length) return;
    const stale = new Set(
      staleStarterTitles(
        plans.data.map((p) => p.title),
        sport,
        levelKey,
      ),
    );
    for (const plan of plans.data.filter((p) => stale.has(p.title))) {
      const logged = await supabaseAdmin
        .from("plan_sessions")
        .select("id", { count: "exact", head: true })
        .eq("plan_id", plan.id);
      if (logged.error || (logged.count ?? 0) > 0) continue;
      await supabaseAdmin.from("plan_moves").delete().eq("plan_id", plan.id);
      await supabaseAdmin.from("plans").delete().eq("id", plan.id).eq("source", "gradus");
    }
  } catch {
    // never block the caller
  }
}

/**
 * Backfill safety net: create starter programs from the athlete's saved goals.
 * Safe to call on every read — ensureStarterPrograms is idempotent and silent.
 */
export async function ensureStarterProgramsForAthlete(athleteId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const goals = await supabaseAdmin
      .from("athlete_goals")
      .select("sport, current_level_key")
      .eq("athlete_id", athleteId);
    if (goals.error) return;
    for (const g of goals.data ?? []) {
      await replaceWrongLevelStarters(athleteId, g.sport, g.current_level_key);
      await ensureStarterPrograms(athleteId, g.sport, g.current_level_key);
    }
    await repairStarterMoveCopy(athleteId);
  } catch {
    // never block the caller
  }
}

/**
 * A coach adopts a Gradus starter plan for one of their rostered athletes
 * (PRD §7.3 "Starter programs"). Ownership transfers to the coach and the
 * plan becomes an ordinary coach plan. Shared by starter-programs.functions.ts
 * and `POST /api/v1/coach/starter-plans/{id}/adopt`.
 */
export async function adoptStarterPlan(
  ctx: { userId: string; admin: SupabaseClient<Database> },
  planId: string,
): Promise<{ ok: true }> {
  const coachRes = await ctx.admin
    .from("coach_profiles")
    .select("id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (coachRes.error) dbError(coachRes.error);
  const coachId = coachRes.data?.id;
  if (!coachId) {
    throw new ApiError({ code: "unprocessable", status: 422, message: "Coach profile not found" });
  }

  const planRes = await ctx.admin
    .from("plans")
    .select("id, athlete_id, source, coach_id")
    .eq("id", planId)
    .maybeSingle();
  if (planRes.error) dbError(planRes.error);
  const plan = planRes.data;
  if (!plan || plan.source !== "gradus" || plan.coach_id || !plan.athlete_id) {
    throw new ApiError({
      code: "unprocessable",
      status: 422,
      message: "Plan is not available to adopt",
    });
  }

  const rosterRes = await ctx.admin
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", coachId)
    .eq("athlete_id", plan.athlete_id)
    .maybeSingle();
  if (rosterRes.error) dbError(rosterRes.error);
  if (!rosterRes.data) {
    throw new ApiError({
      code: "unprocessable",
      status: 422,
      message: "Athlete is not on your roster",
    });
  }

  const upd = await ctx.admin
    .from("plans")
    .update({ coach_id: coachId, source: "coach" })
    .eq("id", plan.id)
    .eq("source", "gradus");
  if (upd.error) dbError(upd.error);

  return { ok: true };
}
