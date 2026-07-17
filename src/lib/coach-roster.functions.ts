import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

export type SlotOverride = {
  date: string; // YYYY-MM-DD
  status: "canceled" | "rescheduled";
  startMinute: number | null;
  endMinute: number | null;
};

export type RosterSlot = {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  overrides: SlotOverride[];
};

export type RosterAthlete = {
  athleteId: string;
  firstName: string;
  lastName: string;
  sport: string | null;
  // Null for self-managed adult athletes (no parent in the loop).
  parentFirstName: string | null;
  parentLastName: string | null;
  selfManaged: boolean;
  slots: RosterSlot[];
  // Count of OTHER coaches on this athlete's roster (excluding the viewer).
  otherCoachCount: number;
  // When N=1, the single other coach's last name for the "+ D. Wallace" chip.
  otherCoachLastName: string | null;
};



export type CoachRoster = {
  coachSports: string[];
  athletes: RosterAthlete[];
};


export const getCoachRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CoachRoster> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
        "athlete_id, athletes!inner(id, first_name, last_name, self_managed, parent_profiles(first_name, last_name))",
      )
      .eq("coach_id", coachId);
    if (links.error) dbError(links.error);

    const rows = links.data ?? [];
    if (rows.length === 0) return { coachSports, athletes: [] };

    const athleteIds = rows.map((r) => r.athlete_id as string);

    const [sportsRes, slotsRes, otherLinksRes] = await Promise.all([
      supabaseAdmin
        .from("coach_athlete_sports")
        .select("athlete_id, sport")
        .eq("coach_id", coachId)
        .in("athlete_id", athleteIds),
      supabaseAdmin
        .from("athlete_lesson_slots")
        .select("id, athlete_id, day_of_week, start_minute, end_minute")
        .eq("coach_id", coachId)
        .in("athlete_id", athleteIds),
      supabaseAdmin
        .from("coach_athletes")
        .select("athlete_id, coach_profiles!inner(last_name)")
        .in("athlete_id", athleteIds)
        .neq("coach_id", coachId),
    ]);
    if (sportsRes.error) dbError(sportsRes.error);
    if (slotsRes.error) dbError(slotsRes.error);
    if (otherLinksRes.error) dbError(otherLinksRes.error);


    const slotIds = (slotsRes.data ?? []).map((s) => s.id as string);
    const overridesRes = slotIds.length
      ? await supabaseAdmin
          .from("lesson_slot_overrides")
          .select("slot_id, occurrence_date, status, start_minute, end_minute")
          .in("slot_id", slotIds)
      : { data: [] as Array<{
          slot_id: string;
          occurrence_date: string;
          status: string;
          start_minute: number | null;
          end_minute: number | null;
        }>, error: null };
    if (overridesRes.error) dbError(overridesRes.error);

    const overridesBySlot = new Map<string, SlotOverride[]>();
    for (const o of overridesRes.data ?? []) {
      const arr = overridesBySlot.get(o.slot_id) ?? [];
      arr.push({
        date: o.occurrence_date,
        status: o.status as "canceled" | "rescheduled",
        startMinute: o.start_minute,
        endMinute: o.end_minute,
      });
      overridesBySlot.set(o.slot_id, arr);
    }

    const sportByAthlete = new Map<string, string>();
    for (const r of sportsRes.data ?? []) {
      if (!sportByAthlete.has(r.athlete_id)) sportByAthlete.set(r.athlete_id, r.sport);
    }

    const slotsByAthlete = new Map<string, RosterSlot[]>();
    for (const s of slotsRes.data ?? []) {
      const arr = slotsByAthlete.get(s.athlete_id) ?? [];
      arr.push({
        id: s.id,
        dayOfWeek: s.day_of_week,
        startMinute: s.start_minute,
        endMinute: s.end_minute,
        overrides: overridesBySlot.get(s.id) ?? [],
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
        self_managed: boolean | null;
        parent_profiles: { first_name: string; last_name: string } | null;
      };
      return {
        athleteId: a.id,
        firstName: a.first_name,
        lastName: a.last_name,
        sport: sportByAthlete.get(a.id) ?? null,
        parentFirstName: a.parent_profiles?.first_name ?? null,
        parentLastName: a.parent_profiles?.last_name ?? null,
        selfManaged: a.self_managed === true,
        slots: slotsByAthlete.get(a.id) ?? [],
      };
    });


    result.sort(
      (a, b) =>
        a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName),
    );

    return { coachSports, athletes: result };
  });
