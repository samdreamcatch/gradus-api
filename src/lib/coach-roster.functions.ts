import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";

export type RosterSlot = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

export type RosterAthlete = {
  athleteId: string;
  firstName: string;
  lastName: string;
  sport: string | null;
  parentFirstName: string;
  parentLastName: string;
  slots: RosterSlot[];
};

export type CoachRoster = {
  coachSports: string[];
  athletes: RosterAthlete[];
};

export const getCoachRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CoachRoster> => {
    const coach = await supabaseAdmin
      .from("coach_profiles")
      .select("id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) return { coachSports: [], athletes: [] };
    const coachId = coach.data.id;

    const levelsRes = await supabaseAdmin
      .from("coach_levels")
      .select("sport")
      .eq("coach_id", coachId);
    if (levelsRes.error) dbError(levelsRes.error);
    const coachSports = Array.from(
      new Set((levelsRes.data ?? []).map((r) => r.sport as string)),
    ).sort();

    const links = await supabaseAdmin
      .from("coach_athletes")
      .select(
        "athlete_id, athletes!inner(id, first_name, last_name, parent_profiles!inner(first_name, last_name))",
      )
      .eq("coach_id", coachId);
    if (links.error) dbError(links.error);
    const rows = links.data ?? [];
    if (rows.length === 0) return { coachSports, athletes: [] };

    const athleteIds = rows.map((r) => r.athlete_id as string);

    const [sportsRes, slotsRes] = await Promise.all([
      supabaseAdmin
        .from("coach_athlete_sports")
        .select("athlete_id, sport")
        .eq("coach_id", coachId)
        .in("athlete_id", athleteIds),
      supabaseAdmin
        .from("athlete_lesson_slots")
        .select("athlete_id, day_of_week, start_minute, end_minute")
        .eq("coach_id", coachId)
        .in("athlete_id", athleteIds),
    ]);
    if (sportsRes.error) dbError(sportsRes.error);
    if (slotsRes.error) dbError(slotsRes.error);

    const sportByAthlete = new Map<string, string>();
    for (const r of sportsRes.data ?? []) {
      if (!sportByAthlete.has(r.athlete_id)) sportByAthlete.set(r.athlete_id, r.sport);
    }

    const slotsByAthlete = new Map<string, RosterSlot[]>();
    for (const s of slotsRes.data ?? []) {
      const arr = slotsByAthlete.get(s.athlete_id) ?? [];
      arr.push({
        dayOfWeek: s.day_of_week,
        startMinute: s.start_minute,
        endMinute: s.end_minute,
      });
      slotsByAthlete.set(s.athlete_id, arr);
    }
    // Sort slots Mon→Sun (treat Sunday=0 as last)
    const dayOrder = (d: number) => (d === 0 ? 7 : d);
    for (const arr of slotsByAthlete.values()) {
      arr.sort(
        (a, b) =>
          dayOrder(a.dayOfWeek) - dayOrder(b.dayOfWeek) || a.startMinute - b.startMinute,
      );
    }

    const result: RosterAthlete[] = rows.map((r) => {
      const a = r.athletes as unknown as {
        id: string;
        first_name: string;
        last_name: string;
        parent_profiles: { first_name: string; last_name: string };
      };
      return {
        athleteId: a.id,
        firstName: a.first_name,
        lastName: a.last_name,
        sport: sportByAthlete.get(a.id) ?? null,
        parentFirstName: a.parent_profiles.first_name,
        parentLastName: a.parent_profiles.last_name,
        slots: slotsByAthlete.get(a.id) ?? [],
      };
    });

    result.sort(
      (a, b) =>
        a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName),
    );

    return { coachSports, athletes: result };
  });
