import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dbError } from "./db-error";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

async function getParentAndCoach(userId: string): Promise<{
  id: string;
  first_name: string;
  last_name: string;
  coach_id: string;
}> {
  const p = await getParentMaybeCoach(userId);
  if (!p.coach_id) throw new Error("No coach linked yet.");
  return {
    id: p.id,
    first_name: p.first_name,
    last_name: p.last_name,
    coach_id: p.coach_id,
  };
}

async function getParentMaybeCoach(userId: string): Promise<{
  id: string;
  first_name: string;
  last_name: string;
  coach_id: string | null;
}> {
  const parent = await supabaseAdmin
    .from("parent_profiles")
    .select("id, first_name, last_name, coach_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (!parent.data) throw new Error("Parent profile not found.");
  return {
    id: parent.data.id,
    first_name: parent.data.first_name,
    last_name: parent.data.last_name,
    coach_id: parent.data.coach_id,
  };
}

async function assertOwnsAthlete(userId: string, athleteId: string) {
  const row = await supabaseAdmin
    .from("athletes")
    .select("id, parent_profiles!inner(user_id)")
    .eq("id", athleteId)
    .maybeSingle();
  if (row.error) dbError(row.error);
  const pp = row.data?.parent_profiles as unknown as { user_id: string } | undefined;
  if (!row.data || pp?.user_id !== userId) throw new Error("Athlete not found.");
}

/**
 * Full settings snapshot for the parent: profile, every athlete with goals,
 * schedule slots, and invite code (lazily generated if missing).
 */
export const getParentSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const parent = await getParentAndCoach(userId);

    const athletes = await supabaseAdmin
      .from("athletes")
      .select("id, first_name, last_name, birthdate")
      .eq("parent_id", parent.id)
      .order("created_at", { ascending: true });
    if (athletes.error) dbError(athletes.error);
    const athleteIds = (athletes.data ?? []).map((a) => a.id);

    const [goals, slots, codes, coachLevels] = await Promise.all([
      supabaseAdmin
        .from("athlete_goals")
        .select("athlete_id, sport, current_level_key, season_goal_key, long_term_goal")
        .in("athlete_id", athleteIds.length ? athleteIds : ["00000000-0000-0000-0000-000000000000"])
        .eq("coach_id", parent.coach_id),
      supabaseAdmin
        .from("athlete_lesson_slots")
        .select("id, athlete_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on")
        .in("athlete_id", athleteIds.length ? athleteIds : ["00000000-0000-0000-0000-000000000000"])
        .eq("coach_id", parent.coach_id),
      supabaseAdmin
        .from("athlete_invite_codes")
        .select("athlete_id, code")
        .eq("parent_id", parent.id),
      supabaseAdmin.from("coach_levels").select("sport").eq("coach_id", parent.coach_id),
    ]);
    if (goals.error) dbError(goals.error);
    if (slots.error) dbError(slots.error);
    if (codes.error) dbError(codes.error);
    if (coachLevels.error) dbError(coachLevels.error);

    const coachSports = Array.from(
      new Set((coachLevels.data ?? []).map((l) => l.sport)),
    );

    const codeMap = new Map((codes.data ?? []).map((r) => [r.athlete_id, r.code]));
    // Lazily generate invite codes for any athletes missing one
    for (const a of athletes.data ?? []) {
      if (codeMap.has(a.id)) continue;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = genCode(8);
        const ins = await supabaseAdmin
          .from("athlete_invite_codes")
          .insert({ parent_id: parent.id, athlete_id: a.id, code })
          .select("code")
          .maybeSingle();
        if (!ins.error && ins.data) {
          codeMap.set(a.id, ins.data.code);
          break;
        }
      }
    }

    return {
      profile: {
        firstName: parent.first_name,
        lastName: parent.last_name,
      },
      coachId: parent.coach_id,
      coachSports,
      athletes: (athletes.data ?? []).map((a) => {
        const ag = (goals.data ?? []).find((g) => g.athlete_id === a.id);
        const aSlots = (slots.data ?? []).filter((s) => s.athlete_id === a.id);
        return {
          id: a.id,
          firstName: a.first_name,
          lastName: a.last_name,
          birthdate: a.birthdate as string | null,
          inviteCode: codeMap.get(a.id) ?? null,
          goals: ag
            ? {
                sport: ag.sport,
                currentLevelKey: ag.current_level_key,
                seasonGoalKey: ag.season_goal_key,
                longTermGoal: ag.long_term_goal ?? "",
              }
            : null,
          slots: aSlots.map((s) => ({
            dayOfWeek: s.day_of_week,
            startMinute: s.start_minute,
            endMinute: s.end_minute,
            frequency: s.frequency as "weekly" | "biweekly" | "twice_monthly" | "monthly",
            weeksOfMonth: (s.weeks_of_month ?? []) as number[],
            startsOn: (s.starts_on as string | null) ?? null,
          })),
        };
      }),
    };
  });

export const updateParentProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const upd = await supabaseAdmin
      .from("parent_profiles")
      .update({ first_name: data.firstName, last_name: data.lastName })
      .eq("user_id", context.userId);
    if (upd.error) dbError(upd.error);
    return { ok: true };
  });

export const updateAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        birthdate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Birthdate required (YYYY-MM-DD)")
          .nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsAthlete(context.userId, data.athleteId);
    const upd = await supabaseAdmin
      .from("athletes")
      .update({
        first_name: data.firstName,
        last_name: data.lastName,
        birthdate: data.birthdate,
      })
      .eq("id", data.athleteId);
    if (upd.error) dbError(upd.error);
    return { ok: true };
  });

export const updateAthleteGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        sport: z.string().min(1).max(64),
        currentLevelKey: z.string().min(1).max(64),
        seasonGoalKey: z.string().min(1).max(64),
        longTermGoal: z.string().max(2000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsAthlete(context.userId, data.athleteId);
    const parent = await getParentAndCoach(context.userId);
    const up = await supabaseAdmin
      .from("athlete_goals")
      .upsert(
        {
          athlete_id: data.athleteId,
          coach_id: parent.coach_id,
          sport: data.sport,
          current_level_key: data.currentLevelKey,
          season_goal_key: data.seasonGoalKey,
          long_term_goal: data.longTermGoal,
        },
        { onConflict: "athlete_id,coach_id,sport" },
      );
    if (up.error) dbError(up.error);
    return { ok: true };
  });

export const replaceAthleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        slots: z
          .array(
            z.object({
              dayOfWeek: z.number().int().min(0).max(6),
              startMinute: z.number().int().min(0).max(1439),
              endMinute: z.number().int().min(1).max(1440),
              frequency: z
                .enum(["weekly", "biweekly", "twice_monthly", "monthly"])
                .default("weekly"),
              weeksOfMonth: z.array(z.number().int().min(1).max(5)).default([]),
              startsOn: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .nullable()
                .default(null),
            }),
          )
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsAthlete(context.userId, data.athleteId);
    const parent = await getParentAndCoach(context.userId);
    for (const s of data.slots) {
      if (s.endMinute <= s.startMinute) throw new Error("End time must be after start time.");
    }

    const del = await supabaseAdmin
      .from("athlete_lesson_slots")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", parent.coach_id);
    if (del.error) dbError(del.error);

    if (data.slots.length > 0) {
      const ins = await supabaseAdmin.from("athlete_lesson_slots").insert(
        data.slots.map((s) => ({
          athlete_id: data.athleteId,
          coach_id: parent.coach_id,
          day_of_week: s.dayOfWeek,
          start_minute: s.startMinute,
          end_minute: s.endMinute,
          frequency: s.frequency,
          weeks_of_month:
            s.frequency === "biweekly" || s.frequency === "weekly" ? [] : s.weeksOfMonth,
          starts_on: s.frequency === "biweekly" ? s.startsOn : null,
        })),
      );
      if (ins.error) dbError(ins.error);
    }
    return { ok: true };
  });

export const addAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firstName: z.string().trim().min(1).max(80),
        lastName: z.string().trim().min(1).max(80),
        birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const parent = await getParentAndCoach(context.userId);

    const ins = await supabaseAdmin
      .from("athletes")
      .insert({
        parent_id: parent.id,
        first_name: data.firstName,
        last_name: data.lastName,
        birthdate: data.birthdate,
      })
      .select("id")
      .single();
    if (ins.error) dbError(ins.error);

    const link = await supabaseAdmin.from("coach_athletes").insert({
      coach_id: parent.coach_id,
      athlete_id: ins.data.id,
    });
    if (link.error) dbError(link.error);

    // Best-effort invite code
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genCode(8);
      const c = await supabaseAdmin
        .from("athlete_invite_codes")
        .insert({ parent_id: parent.id, athlete_id: ins.data.id, code });
      if (!c.error) break;
    }

    return { ok: true, athleteId: ins.data.id };
  });

export const removeAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ athleteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsAthlete(context.userId, data.athleteId);
    const parent = await getParentAndCoach(context.userId);

    // Refuse to remove the only athlete
    const count = await supabaseAdmin
      .from("athletes")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", parent.id);
    if (count.error) dbError(count.error);
    if ((count.count ?? 0) <= 1) {
      throw new Error("You need at least one athlete on your account.");
    }

    // Delete dependents first in case FKs aren't cascading
    await supabaseAdmin.from("athlete_lesson_slots").delete().eq("athlete_id", data.athleteId);
    await supabaseAdmin.from("athlete_goals").delete().eq("athlete_id", data.athleteId);
    await supabaseAdmin.from("athlete_invite_codes").delete().eq("athlete_id", data.athleteId);
    await supabaseAdmin.from("coach_athletes").delete().eq("athlete_id", data.athleteId);

    const del = await supabaseAdmin.from("athletes").delete().eq("id", data.athleteId);
    if (del.error) dbError(del.error);
    return { ok: true };
  });
