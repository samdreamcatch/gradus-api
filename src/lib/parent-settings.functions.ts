import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}

async function getParentProfile(userId: string): Promise<{
  id: string;
  first_name: string;
  last_name: string;
  promo_code: string | null;
}> {
  const supabaseAdmin = await getAdmin();
  const parent = await supabaseAdmin
    .from("parent_profiles")
    .select("id, first_name, last_name, promo_code")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (!parent.data) throw new Error("Parent profile not found.");
  return {
    id: parent.data.id,
    first_name: parent.data.first_name,
    last_name: parent.data.last_name,
    promo_code: parent.data.promo_code ?? null,
  };
}

async function assertOwnsAthlete(userId: string, athleteId: string) {
  const supabaseAdmin = await getAdmin();
  const row = await supabaseAdmin
    .from("athletes")
    .select("id, parent_profiles!inner(user_id)")
    .eq("id", athleteId)
    .maybeSingle();
  if (row.error) dbError(row.error);
  const pp = row.data?.parent_profiles as unknown as { user_id: string } | undefined;
  if (!row.data || pp?.user_id !== userId) throw new Error("Athlete not found.");
}

/** Resolve primary coach for (athlete, sport); auto-pick earliest eligible coach if none. */
async function ensurePrimaryCoach(
  athleteId: string,
  sport: string,
): Promise<string | null> {
  const supabaseAdmin = await getAdmin();
  const existing = await supabaseAdmin
    .from("athlete_primary_coaches")
    .select("coach_id")
    .eq("athlete_id", athleteId)
    .eq("sport", sport)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data?.coach_id) return existing.data.coach_id;

  // Find earliest eligible coach who is linked to this athlete and teaches this sport.
  // Done as two queries since there is no direct FK between coach_athletes and coach_levels.
  const linked = await supabaseAdmin
    .from("coach_athletes")
    .select("coach_id, created_at")
    .eq("athlete_id", athleteId)
    .order("created_at", { ascending: true });
  if (linked.error) dbError(linked.error);
  const linkedCoachIds = (linked.data ?? []).map((r) => r.coach_id as string);
  if (linkedCoachIds.length === 0) return null;
  const teaching = await supabaseAdmin
    .from("coach_levels")
    .select("coach_id")
    .eq("sport", sport)
    .in("coach_id", linkedCoachIds);
  if (teaching.error) dbError(teaching.error);
  const teachingSet = new Set((teaching.data ?? []).map((r) => r.coach_id as string));
  const coachId = linkedCoachIds.find((id) => teachingSet.has(id));
  if (!coachId) return null;

  const ins = await supabaseAdmin
    .from("athlete_primary_coaches")
    .insert({ athlete_id: athleteId, sport, coach_id: coachId })
    .select("coach_id")
    .maybeSingle();
  if (ins.error) {
    // Race: another request inserted; re-read.
    const reread = await supabaseAdmin
      .from("athlete_primary_coaches")
      .select("coach_id")
      .eq("athlete_id", athleteId)
      .eq("sport", sport)
      .maybeSingle();
    if (reread.error) dbError(reread.error);
    return reread.data?.coach_id ?? null;
  }
  return ins.data?.coach_id ?? null;
}

/** Full settings snapshot for the parent. */
export const getParentSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const parent = await getParentProfile(userId);

    const athletesRes = await supabaseAdmin
      .from("athletes")
      .select("id, first_name, last_name, birthdate, username, user_id")
      .eq("parent_id", parent.id)
      .order("created_at", { ascending: true });
    if (athletesRes.error) dbError(athletesRes.error);
    const athletes = athletesRes.data ?? [];
    const athleteIds = athletes.map((a) => a.id);
    const safeIds = athleteIds.length ? athleteIds : ["00000000-0000-0000-0000-000000000000"];

    const [linksRes, sportsScopeRes, goalsRes, slotsRes, primaryRes, codesRes] =
      await Promise.all([
        supabaseAdmin
          .from("coach_athletes")
          .select("athlete_id, coach_id, created_at, coach_profiles!inner(first_name, last_name)")
          .in("athlete_id", safeIds)
          .order("created_at", { ascending: true }),
        supabaseAdmin
          .from("coach_athlete_sports")
          .select("athlete_id, coach_id, sport")
          .in("athlete_id", safeIds),
        supabaseAdmin
          .from("athlete_goals")
          .select("athlete_id, sport, current_level_key, season_goal_key, long_term_goal, coach_id")
          .in("athlete_id", safeIds),
        supabaseAdmin
          .from("athlete_lesson_slots")
          .select("id, athlete_id, coach_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on")
          .in("athlete_id", safeIds),
        supabaseAdmin
          .from("athlete_primary_coaches")
          .select("athlete_id, sport, coach_id")
          .in("athlete_id", safeIds),
        supabaseAdmin
          .from("athlete_invite_codes")
          .select("athlete_id, code")
          .eq("parent_id", parent.id),
      ]);
    if (linksRes.error) dbError(linksRes.error);
    if (sportsScopeRes.error) dbError(sportsScopeRes.error);
    if (goalsRes.error) dbError(goalsRes.error);
    if (slotsRes.error) dbError(slotsRes.error);
    if (primaryRes.error) dbError(primaryRes.error);
    if (codesRes.error) dbError(codesRes.error);

    // Build (athlete,coach) -> scoped sports map
    const scopeKey = (a: string, c: string) => `${a}|${c}`;
    const scopedSports = new Map<string, Set<string>>();
    for (const r of sportsScopeRes.data ?? []) {
      const k = scopeKey(r.athlete_id, r.coach_id);
      if (!scopedSports.has(k)) scopedSports.set(k, new Set());
      scopedSports.get(k)!.add(r.sport);
    }

    // Lazily generate invite codes for athletes missing one
    const codeMap = new Map((codesRes.data ?? []).map((r) => [r.athlete_id, r.code]));
    for (const a of athletes) {
      if (codeMap.has(a.id)) continue;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = genCode(8);
        const ins = await supabaseAdmin
          .from("athlete_invite_codes")
          .insert({
            parent_id: parent.id,
            athlete_id: a.id,
            code,
            promo_code: parent.promo_code,
          })
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
      athletes: athletes.map((a) => {
        const myLinks = (linksRes.data ?? []).filter((l) => l.athlete_id === a.id);
        const coaches = myLinks.map((l) => {
          const cp = l.coach_profiles as unknown as { first_name: string; last_name: string };
          return {
            coachId: l.coach_id as string,
            coachName: `${cp.first_name} ${cp.last_name}`.trim(),
            sports: Array.from(scopedSports.get(scopeKey(a.id, l.coach_id)) ?? []) as string[],
          };
        });

        // Union of sports across this athlete's coaches
        const sportSet = new Set<string>();
        for (const c of coaches) for (const s of c.sports) sportSet.add(s);

        const myPrimary = new Map(
          (primaryRes.data ?? [])
            .filter((p) => p.athlete_id === a.id)
            .map((p) => [p.sport, p.coach_id]),
        );
        const myGoals = (goalsRes.data ?? []).filter((g) => g.athlete_id === a.id);

        const sports = Array.from(sportSet).sort().map((sport) => {
          const eligibleCoaches = coaches
            .filter((c) => c.sports.includes(sport))
            .map((c) => ({ coachId: c.coachId, coachName: c.coachName }));
          const primaryCoachId =
            myPrimary.get(sport) ?? eligibleCoaches[0]?.coachId ?? null;
          const primaryCoach = eligibleCoaches.find((c) => c.coachId === primaryCoachId);
          const g = myGoals.find((gg) => gg.sport === sport);
          return {
            sport,
            primaryCoachId,
            primaryCoachName: primaryCoach?.coachName ?? null,
            eligibleCoaches,
            goals: g
              ? {
                  currentLevelKey: g.current_level_key,
                  seasonGoalKey: g.season_goal_key,
                  longTermGoal: g.long_term_goal ?? "",
                }
              : null,
          };
        });

        const schedulesByCoach = coaches.map((c) => {
          const slots = (slotsRes.data ?? [])
            .filter((s) => s.athlete_id === a.id && s.coach_id === c.coachId)
            .map((s) => ({
              dayOfWeek: s.day_of_week,
              startMinute: s.start_minute,
              endMinute: s.end_minute,
              frequency: s.frequency as "weekly" | "biweekly" | "twice_monthly" | "monthly",
              weeksOfMonth: (s.weeks_of_month ?? []) as number[],
              startsOn: (s.starts_on as string | null) ?? null,
            }));
          return { coachId: c.coachId, coachName: c.coachName, slots };
        });

        return {
          id: a.id,
          firstName: a.first_name,
          lastName: a.last_name,
          birthdate: a.birthdate as string | null,
          username: (a as { username: string | null }).username ?? null,
          hasAccount: !!(a as { user_id: string | null }).user_id,
          inviteCode: codeMap.get(a.id) ?? null,
          coaches,
          sports,
          schedulesByCoach,
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertOwnsAthlete(context.userId, data.athleteId);
    const coachId = await ensurePrimaryCoach(data.athleteId, data.sport);
    if (!coachId) {
      throw new Error(
        "Link a coach who teaches this sport before setting goals.",
      );
    }
    const up = await supabaseAdmin
      .from("athlete_goals")
      .upsert(
        {
          athlete_id: data.athleteId,
          coach_id: coachId,
          sport: data.sport,
          current_level_key: data.currentLevelKey,
          season_goal_key: data.seasonGoalKey,
          long_term_goal: data.longTermGoal,
        },
        { onConflict: "athlete_id,sport" },
      );
    if (up.error) dbError(up.error);
    return { ok: true };
  });

const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

/**
 * Look up a coach by invite code so the parent can pick which sports apply
 * to their athlete before linking. Does not mutate anything.
 */
export const previewCoachByInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ code: inviteCodeSchema }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) dbError(codeLookup.error);
    if (!codeLookup.data) {
      throw new Error("That invite code isn't valid. Double-check with the coach.");
    }
    const coachId = codeLookup.data.coach_id;
    const [profile, levels] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("first_name, last_name")
        .eq("id", coachId)
        .single(),
      supabaseAdmin.from("coach_levels").select("sport").eq("coach_id", coachId),
    ]);
    if (profile.error) dbError(profile.error);
    const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));
    return {
      coachId,
      coachName: `${profile.data.first_name} ${profile.data.last_name}`.trim(),
      sports,
    };
  });

export const linkAthleteToCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        code: inviteCodeSchema,
        sports: z.array(z.string().min(1).max(64)).min(1, "Pick at least one sport").max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertOwnsAthlete(context.userId, data.athleteId);

    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) dbError(codeLookup.error);
    if (!codeLookup.data) {
      throw new Error("That invite code isn't valid. Double-check with the coach.");
    }
    const coachId = codeLookup.data.coach_id;

    // Validate selected sports are actually offered by this coach
    const offered = await supabaseAdmin
      .from("coach_levels")
      .select("sport")
      .eq("coach_id", coachId);
    if (offered.error) dbError(offered.error);
    const offeredSet = new Set((offered.data ?? []).map((r) => r.sport));
    const chosen = Array.from(new Set(data.sports));
    for (const s of chosen) {
      if (!offeredSet.has(s)) throw new Error(`Coach doesn't offer ${s}.`);
    }

    const existing = await supabaseAdmin
      .from("coach_athletes")
      .select("id")
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data) {
      throw new Error("That coach is already linked to this athlete.");
    }

    const ins = await supabaseAdmin
      .from("coach_athletes")
      .insert({ athlete_id: data.athleteId, coach_id: coachId });
    if (ins.error) dbError(ins.error);

    const scopeRows = chosen.map((sport) => ({
      athlete_id: data.athleteId,
      coach_id: coachId,
      sport,
    }));
    const scopeIns = await supabaseAdmin
      .from("coach_athlete_sports")
      .insert(scopeRows);
    if (scopeIns.error) dbError(scopeIns.error);

    return { ok: true };
  });

/**
 * Replace the set of sports an athlete does with a coach. If a sport is
 * removed and that coach was the primary for it, clear the primary row.
 */
export const updateCoachAthleteSports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        coachId: z.string().uuid(),
        sports: z.array(z.string().min(1).max(64)).min(1, "Pick at least one sport").max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertOwnsAthlete(context.userId, data.athleteId);

    const link = await supabaseAdmin
      .from("coach_athletes")
      .select("id")
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", data.coachId)
      .maybeSingle();
    if (link.error) dbError(link.error);
    if (!link.data) throw new Error("That coach isn't linked to this athlete.");

    const offered = await supabaseAdmin
      .from("coach_levels")
      .select("sport")
      .eq("coach_id", data.coachId);
    if (offered.error) dbError(offered.error);
    const offeredSet = new Set((offered.data ?? []).map((r) => r.sport));
    const chosen = Array.from(new Set(data.sports));
    for (const s of chosen) {
      if (!offeredSet.has(s)) throw new Error(`Coach doesn't offer ${s}.`);
    }

    const existing = await supabaseAdmin
      .from("coach_athlete_sports")
      .select("sport")
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", data.coachId);
    if (existing.error) dbError(existing.error);
    const currentSet = new Set((existing.data ?? []).map((r) => r.sport));
    const chosenSet = new Set(chosen);

    const toAdd = chosen.filter((s) => !currentSet.has(s));
    const toRemove = Array.from(currentSet).filter((s) => !chosenSet.has(s));

    if (toAdd.length > 0) {
      const ins = await supabaseAdmin.from("coach_athlete_sports").insert(
        toAdd.map((sport) => ({
          athlete_id: data.athleteId,
          coach_id: data.coachId,
          sport,
        })),
      );
      if (ins.error) dbError(ins.error);
    }
    if (toRemove.length > 0) {
      const del = await supabaseAdmin
        .from("coach_athlete_sports")
        .delete()
        .eq("athlete_id", data.athleteId)
        .eq("coach_id", data.coachId)
        .in("sport", toRemove);
      if (del.error) dbError(del.error);

      // If this coach was primary for any removed sport, clear it so it can
      // re-resolve (or vanish if no other eligible coaches remain).
      await supabaseAdmin
        .from("athlete_primary_coaches")
        .delete()
        .eq("athlete_id", data.athleteId)
        .eq("coach_id", data.coachId)
        .in("sport", toRemove);
    }

    return { ok: true };
  });

export const unlinkAthleteFromCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        coachId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertOwnsAthlete(context.userId, data.athleteId);

    // Clean up coach-scoped data so a relink starts fresh
    await supabaseAdmin
      .from("athlete_lesson_slots")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", data.coachId);
    await supabaseAdmin
      .from("athlete_primary_coaches")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", data.coachId);
    await supabaseAdmin
      .from("athlete_goals")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", data.coachId);

    const del = await supabaseAdmin
      .from("coach_athletes")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", data.coachId);
    if (del.error) dbError(del.error);
    return { ok: true };
  });


export const setPrimaryCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        sport: z.string().min(1).max(64),
        coachId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertOwnsAthlete(context.userId, data.athleteId);
    // The DB trigger enforces that coach is linked to athlete and offers sport.
    const up = await supabaseAdmin
      .from("athlete_primary_coaches")
      .upsert(
        { athlete_id: data.athleteId, sport: data.sport, coach_id: data.coachId },
        { onConflict: "athlete_id,sport" },
      );
    if (up.error) dbError(up.error);

    // Re-stamp coach_id on any matching goal record so it tracks the current primary.
    await supabaseAdmin
      .from("athlete_goals")
      .update({ coach_id: data.coachId })
      .eq("athlete_id", data.athleteId)
      .eq("sport", data.sport);
    return { ok: true };
  });

export const replaceAthleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        coachId: z.string().uuid(),
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertOwnsAthlete(context.userId, data.athleteId);
    // Validate the coach is actually linked to this athlete
    const link = await supabaseAdmin
      .from("coach_athletes")
      .select("id")
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", data.coachId)
      .maybeSingle();
    if (link.error) dbError(link.error);
    if (!link.data) throw new Error("That coach isn't linked to this athlete.");

    for (const s of data.slots) {
      if (s.endMinute <= s.startMinute) throw new Error("End time must be after start time.");
    }

    const del = await supabaseAdmin
      .from("athlete_lesson_slots")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", data.coachId);
    if (del.error) dbError(del.error);

    if (data.slots.length > 0) {
      const ins = await supabaseAdmin.from("athlete_lesson_slots").insert(
        data.slots.map((s) => ({
          athlete_id: data.athleteId,
          coach_id: data.coachId,
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const parent = await getParentProfile(context.userId);

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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertOwnsAthlete(context.userId, data.athleteId);
    const parent = await getParentProfile(context.userId);

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
    await supabaseAdmin.from("athlete_primary_coaches").delete().eq("athlete_id", data.athleteId);
    await supabaseAdmin.from("athlete_invite_codes").delete().eq("athlete_id", data.athleteId);
    await supabaseAdmin.from("coach_athletes").delete().eq("athlete_id", data.athleteId);

    const del = await supabaseAdmin.from("athletes").delete().eq("id", data.athleteId);
    if (del.error) dbError(del.error);
    return { ok: true };
  });

/**
 * Reset (or set) the password for one of the parent's athletes. Only works
 * for athletes that have an account (user_id is set). Used by the parent
 * settings page since username-only athletes have no email-based recovery.
 */
export const resetAthletePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        athleteId: z.string().uuid(),
        password: z.string().min(8, "Password must be at least 8 characters"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsAthlete(context.userId, data.athleteId);
    const supabaseAdmin = await getAdmin();
    const row = await supabaseAdmin
      .from("athletes")
      .select("user_id, username")
      .eq("id", data.athleteId)
      .single();
    if (row.error) dbError(row.error);
    if (!row.data.user_id) {
      throw new Error("This athlete hasn't created their account yet.");
    }
    const upd = await supabaseAdmin.auth.admin.updateUserById(row.data.user_id, {
      password: data.password,
    });
    if (upd.error) throw new Error(upd.error.message);
    return { ok: true, username: row.data.username as string | null };
  });
