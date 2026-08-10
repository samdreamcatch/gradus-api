import { STARTER_PROGRAMS, resolveStarterPrograms } from "@/data/starter-programs";

/** Every title this sport could ever produce, used for the "already has one" check. */
function titlesForSport(sport: string): Set<string> {
  const bySport = STARTER_PROGRAMS[sport];
  const titles = new Set<string>();
  if (!bySport) return titles;
  for (const programs of Object.values(bySport)) {
    for (const p of programs) titles.add(p.title);
  }
  return titles;
}

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
      await ensureStarterPrograms(athleteId, g.sport, g.current_level_key);
    }
    await repairStarterMoveCopy(athleteId);
  } catch {
    // never block the caller
  }
}
