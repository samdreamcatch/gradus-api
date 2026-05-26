import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

/**
 * Step 1: validate the coach's invite code and create/update the parent profile.
 * Returns the (normalized) code so the next screen can fetch coach details.
 */
export const startParentSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firstName: z.string().trim().min(1, "First name required").max(80),
        lastName: z.string().trim().min(1, "Last name required").max(80),
        code: codeSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) throw new Error(codeLookup.error.message);
    if (!codeLookup.data) {
      throw new Error("That invite code isn't valid. Double-check with your coach.");
    }

    const existing = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    if (existing.data) {
      const upd = await supabaseAdmin
        .from("parent_profiles")
        .update({ first_name: data.firstName, last_name: data.lastName })
        .eq("id", existing.data.id);
      if (upd.error) throw new Error(upd.error.message);
    } else {
      const ins = await supabaseAdmin.from("parent_profiles").insert({
        user_id: userId,
        first_name: data.firstName,
        last_name: data.lastName,
      });
      if (ins.error) throw new Error(ins.error.message);
    }

    return { code: data.code };
  });

/**
 * Returns the coach's name and the sports they coach, looked up by invite code.
 * Used on the "add athletes" screen so the parent sees who they're linking to.
 */
export const getCoachByInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) throw new Error(codeLookup.error.message);
    if (!codeLookup.data) throw new Error("Invalid invite code.");

    const coachId = codeLookup.data.coach_id;

    const [profile, levels] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("first_name,last_name")
        .eq("id", coachId)
        .single(),
      supabaseAdmin.from("coach_levels").select("sport").eq("coach_id", coachId),
    ]);
    if (profile.error) throw new Error(profile.error.message);

    const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));
    return {
      coachId,
      firstName: profile.data.first_name,
      lastName: profile.data.last_name,
      sports,
    };
  });

/**
 * Creates athletes for the current parent and links each one to the coach
 * resolved from the invite code.
 */
export const linkAthletesToCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        athletes: z
          .array(
            z.object({
              firstName: z.string().trim().min(1, "Athlete first name required").max(80),
              lastName: z.string().trim().min(1, "Athlete last name required").max(80),
            }),
          )
          .min(1, "Add at least one athlete")
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) throw new Error(codeLookup.error.message);
    if (!codeLookup.data) throw new Error("Invalid invite code.");
    const coachId = codeLookup.data.coach_id;

    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent.error) throw new Error(parent.error.message);
    if (!parent.data) {
      throw new Error("Parent profile not found. Please complete signup first.");
    }
    const parentId = parent.data.id;

    const athleteRows = data.athletes.map((a) => ({
      parent_id: parentId,
      first_name: a.firstName,
      last_name: a.lastName,
    }));
    const athletesIns = await supabaseAdmin
      .from("athletes")
      .insert(athleteRows)
      .select("id");
    if (athletesIns.error) throw new Error(athletesIns.error.message);

    const linkRows = (athletesIns.data ?? []).map((a) => ({
      coach_id: coachId,
      athlete_id: a.id,
    }));
    const linksIns = await supabaseAdmin.from("coach_athletes").insert(linkRows);
    if (linksIns.error) throw new Error(linksIns.error.message);

    return { ok: true };
  });

/**
 * Returns the caller's role based on which profile row exists.
 * Used by /login to route the user post-signin.
 */
export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const [coach, parent] = await Promise.all([
      supabase.from("coach_profiles").select("id").maybeSingle(),
      supabase.from("parent_profiles").select("id").maybeSingle(),
    ]);
    if (coach.data) return { role: "coach" as const };
    if (parent.data) return { role: "parent" as const };
    return { role: null };
  });

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 8): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
  }
  // Restrict to A-Z2-9 to match check constraint
  return out.replace(/[^A-Z2-9]/g, "A");
}

/**
 * List the signed-in parent's athletes linked to the coach behind `code`,
 * plus the sports that coach teaches.
 */
export const listAthletesForCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) throw new Error(codeLookup.error.message);
    if (!codeLookup.data) throw new Error("Invalid invite code.");
    const coachId = codeLookup.data.coach_id;

    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent.error) throw new Error(parent.error.message);
    if (!parent.data) throw new Error("Parent profile not found.");

    const links = await supabaseAdmin
      .from("coach_athletes")
      .select("athlete_id, athletes!inner(id, first_name, last_name, parent_id)")
      .eq("coach_id", coachId);
    if (links.error) throw new Error(links.error.message);

    const athletes = (links.data ?? [])
      .map((l) => l.athletes as unknown as {
        id: string;
        first_name: string;
        last_name: string;
        parent_id: string;
      })
      .filter((a) => a.parent_id === parent.data!.id)
      .map((a) => ({ id: a.id, firstName: a.first_name, lastName: a.last_name }));

    const levels = await supabaseAdmin
      .from("coach_levels")
      .select("sport")
      .eq("coach_id", coachId);
    if (levels.error) throw new Error(levels.error.message);
    const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));

    return { coachId, athletes, sports };
  });

export const saveAthleteGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        athleteId: z.string().uuid(),
        sport: z.string().min(1).max(64),
        currentLevelKey: z.string().min(1).max(64),
        seasonGoalKey: z.string().min(1).max(64),
        longTermGoal: z.string().max(2000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) throw new Error(codeLookup.error.message);
    if (!codeLookup.data) throw new Error("Invalid invite code.");
    const coachId = codeLookup.data.coach_id;

    // Ownership check
    const athlete = await supabaseAdmin
      .from("athletes")
      .select("id, parent_id, parent_profiles!inner(user_id)")
      .eq("id", data.athleteId)
      .maybeSingle();
    if (athlete.error) throw new Error(athlete.error.message);
    const parentRow = athlete.data?.parent_profiles as unknown as { user_id: string } | undefined;
    if (!athlete.data || parentRow?.user_id !== userId) {
      throw new Error("Athlete not found.");
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
        { onConflict: "athlete_id,coach_id,sport" },
      );
    if (up.error) throw new Error(up.error.message);
    return { ok: true };
  });

export const saveAthleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        athleteId: z.string().uuid(),
        slots: z
          .array(
            z.object({
              dayOfWeek: z.number().int().min(0).max(6),
              startMinute: z.number().int().min(0).max(1439),
              endMinute: z.number().int().min(1).max(1440),
              frequency: z.enum(["weekly", "biweekly", "twice_monthly", "monthly"]).default("weekly"),
            }),
          )
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    for (const s of data.slots) {
      if (s.endMinute <= s.startMinute) throw new Error("End time must be after start time.");
    }

    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) throw new Error(codeLookup.error.message);
    if (!codeLookup.data) throw new Error("Invalid invite code.");
    const coachId = codeLookup.data.coach_id;

    const athlete = await supabaseAdmin
      .from("athletes")
      .select("id, parent_profiles!inner(user_id)")
      .eq("id", data.athleteId)
      .maybeSingle();
    if (athlete.error) throw new Error(athlete.error.message);
    const parentRow = athlete.data?.parent_profiles as unknown as { user_id: string } | undefined;
    if (!athlete.data || parentRow?.user_id !== userId) {
      throw new Error("Athlete not found.");
    }

    const del = await supabaseAdmin
      .from("athlete_lesson_slots")
      .delete()
      .eq("athlete_id", data.athleteId)
      .eq("coach_id", coachId);
    if (del.error) throw new Error(del.error.message);

    if (data.slots.length > 0) {
      const ins = await supabaseAdmin.from("athlete_lesson_slots").insert(
        data.slots.map((s) => ({
          athlete_id: data.athleteId,
          coach_id: coachId,
          day_of_week: s.dayOfWeek,
          start_minute: s.startMinute,
          end_minute: s.endMinute,
          frequency: s.frequency,
        })),
      );
      if (ins.error) throw new Error(ins.error.message);
    }
    return { ok: true };
  });

/**
 * Returns the parent's athletes with their invite codes, generating codes
 * for any athletes that don't have one yet.
 */
export const listAthletesWithInviteCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent.error) throw new Error(parent.error.message);
    if (!parent.data) return { athletes: [] };
    const parentId = parent.data.id;

    const athletes = await supabaseAdmin
      .from("athletes")
      .select("id, first_name, last_name")
      .eq("parent_id", parentId)
      .order("created_at", { ascending: true });
    if (athletes.error) throw new Error(athletes.error.message);

    const existing = await supabaseAdmin
      .from("athlete_invite_codes")
      .select("athlete_id, code")
      .eq("parent_id", parentId);
    if (existing.error) throw new Error(existing.error.message);
    const byAthlete = new Map((existing.data ?? []).map((r) => [r.athlete_id, r.code]));

    for (const a of athletes.data ?? []) {
      if (byAthlete.has(a.id)) continue;
      // Generate, retry on collision a few times
      let inserted = false;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        const code = genCode(8);
        const ins = await supabaseAdmin
          .from("athlete_invite_codes")
          .insert({ parent_id: parentId, athlete_id: a.id, code })
          .select("code")
          .maybeSingle();
        if (!ins.error && ins.data) {
          byAthlete.set(a.id, ins.data.code);
          inserted = true;
        }
      }
    }

    return {
      athletes: (athletes.data ?? []).map((a) => ({
        id: a.id,
        firstName: a.first_name,
        lastName: a.last_name,
        code: byAthlete.get(a.id) ?? null,
      })),
    };
  });
