import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SPORT_KEYS } from "@/lib/coach-sports";
import { dbError } from "./db-error";

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

const optionalCodeSchema = z
  .union([codeSchema, z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v ? v : null));

const RATE_WINDOW_SECONDS = 60;
const RATE_MAX_PER_WINDOW = 10;

function clientIp(): string {
  try {
    const ip = getRequestIP({ xForwardedFor: true });
    if (ip) return ip;
  } catch {
    // ignore
  }
  const ua = (() => {
    try {
      return getRequestHeader("user-agent") ?? "";
    } catch {
      return "";
    }
  })();
  return `ua:${ua.slice(0, 64)}`;
}


/**
 * Validates an 8-character signup code. Accepts either:
 *  - a coach invite code (from `coach_invite_codes`), OR
 *  - the shared Gradus beta code (env `BETA_INVITE_CODE`).
 * For role='coach', only the beta code is accepted.
 * Runs before account creation, so it does NOT require auth.
 */
export const validateSignupCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        role: z.enum(["parent", "coach"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const beta = (process.env.BETA_INVITE_CODE ?? "").trim().toUpperCase();
    if (beta && data.code === beta) {
      return { kind: "beta" as const };
    }
    if (data.role === "coach") {
      throw new Error("That beta code isn't valid.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) dbError(codeLookup.error);
    if (!codeLookup.data) {
      throw new Error("That code isn't valid. Check with your coach, or use your Gradus beta code.");
    }
    return { kind: "coach" as const, coachId: codeLookup.data.coach_id };
  });

/**
 * Step 1: validate the signup code (coach invite or beta) and create/update
 * the parent profile. Returns the coach invite code (or null for beta) so the
 * next screen can fetch coach details.
 */
export const startParentSignup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firstName: z.string().trim().min(1, "First name required").max(80),
        lastName: z.string().trim().min(1, "Last name required").max(80),
        code: optionalCodeSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const beta = (process.env.BETA_INVITE_CODE ?? "").trim().toUpperCase();
    const isBeta = !!(beta && data.code && data.code === beta);

    let coachId: string | null = null;
    let returnedCode: string | null = null;
    if (data.code && !isBeta) {
      const codeLookup = await supabaseAdmin
        .from("coach_invite_codes")
        .select("coach_id")
        .eq("code", data.code)
        .maybeSingle();
      if (codeLookup.error) dbError(codeLookup.error);
      if (!codeLookup.data) {
        throw new Error("That coach invite code isn't valid.");
      }
      coachId = codeLookup.data.coach_id;
      returnedCode = data.code;
    }

    const existing = await supabaseAdmin
      .from("parent_profiles")
      .select("id, coach_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);

    if (existing.data) {
      const upd = await supabaseAdmin
        .from("parent_profiles")
        .update({
          first_name: data.firstName,
          last_name: data.lastName,
          // Only set coach_id if a new coach code was provided; never clobber
          // an existing link with NULL when the parent re-runs the form.
          ...(coachId ? { coach_id: coachId } : {}),
        })
        .eq("id", existing.data.id);
      if (upd.error) dbError(upd.error);
    } else {
      const ins = await supabaseAdmin.from("parent_profiles").insert({
        user_id: userId,
        first_name: data.firstName,
        last_name: data.lastName,
        coach_id: coachId,
      });
      if (ins.error) dbError(ins.error);
    }

    return { code: returnedCode };
  });


/**
 * Returns whether the signed-in parent has finished signup (has at least one
 * athlete) and the invite code for their coach (used to resume the wizard).
 */
export const getParentSignupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id, coach_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent.error) dbError(parent.error);
    if (!parent.data) return { hasParentProfile: false, hasAthletes: false, hasAnyCoach: false, inviteCode: null };

    const parentId = parent.data.id;

    const [athletes, coachLinks] = await Promise.all([
      supabaseAdmin.from("athletes").select("id").eq("parent_id", parentId).limit(1),
      // Any coach already linked to any of this parent's athletes?
      supabaseAdmin
        .from("coach_athletes")
        .select("coach_id, athletes!inner(parent_id)")
        .eq("athletes.parent_id", parentId)
        .limit(1),
    ]);
    if (athletes.error) dbError(athletes.error);
    if (coachLinks.error) dbError(coachLinks.error);

    let inviteCode: string | null = null;
    if (parent.data.coach_id) {
      const code = await supabaseAdmin
        .from("coach_invite_codes")
        .select("code")
        .eq("coach_id", parent.data.coach_id)
        .maybeSingle();
      if (!code.error && code.data) inviteCode = code.data.code;
    }

    return {
      hasParentProfile: true,
      hasAthletes: (athletes.data ?? []).length > 0,
      hasAnyCoach: (coachLinks.data ?? []).length > 0 || !!parent.data.coach_id,
      inviteCode,
    };
  });

/**
 * Returns the coach's name and the sports they coach, looked up by invite code.
 * Used on the "add athletes" screen so the parent sees who they're linking to.
 */
export const getCoachByInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const codeLookup = await supabaseAdmin
      .from("coach_invite_codes")
      .select("coach_id")
      .eq("code", data.code)
      .maybeSingle();
    if (codeLookup.error) dbError(codeLookup.error);
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
    if (profile.error) dbError(profile.error);

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
        code: optionalCodeSchema,
        athletes: z
          .array(
            z.object({
              firstName: z.string().trim().min(1, "Athlete first name required").max(80),
              lastName: z.string().trim().min(1, "Athlete last name required").max(80),
              birthdate: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/, "Birthdate required"),
            }),
          )
          .min(1, "Add at least one athlete")
          .max(20),
      })
      .parse(input),

  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    let coachId: string | null = null;
    if (data.code) {
      const codeLookup = await supabaseAdmin
        .from("coach_invite_codes")
        .select("coach_id")
        .eq("code", data.code)
        .maybeSingle();
      if (codeLookup.error) dbError(codeLookup.error);
      if (!codeLookup.data) throw new Error("Invalid invite code.");
      coachId = codeLookup.data.coach_id;
    }

    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent.error) dbError(parent.error);
    if (!parent.data) {
      throw new Error("Parent profile not found. Please complete signup first.");
    }
    const parentId = parent.data.id;

    const athleteRows = data.athletes.map((a) => ({
      parent_id: parentId,
      first_name: a.firstName,
      last_name: a.lastName,
      birthdate: a.birthdate,
    }));

    const athletesIns = await supabaseAdmin
      .from("athletes")
      .insert(athleteRows)
      .select("id");
    if (athletesIns.error) dbError(athletesIns.error);

    if (coachId) {
      // Auto-ack the parent side — the signup wizard's final screen already
      // shows the connection confirmation, so suppress the celebration modal
      // on first load of /parent/plans. The coach still sees theirs.
      const nowIso = new Date().toISOString();
      const linkRows = (athletesIns.data ?? []).map((a) => ({
        coach_id: coachId!,
        athlete_id: a.id,
        other_ack_at: nowIso,
      }));
      const linksIns = await supabaseAdmin.from("coach_athletes").insert(linkRows);
      if (linksIns.error) dbError(linksIns.error);

      // Enable every sport this coach offers for each newly linked athlete.
      const levels = await supabaseAdmin
        .from("coach_levels")
        .select("sport")
        .eq("coach_id", coachId);
      if (levels.error) dbError(levels.error);
      const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));
      if (sports.length > 0 && (athletesIns.data ?? []).length > 0) {
        const scopeRows = (athletesIns.data ?? []).flatMap((a) =>
          sports.map((sport) => ({ athlete_id: a.id, coach_id: coachId!, sport })),
        );

        const scopeIns = await supabaseAdmin
          .from("coach_athlete_sports")
          .insert(scopeRows);
        if (scopeIns.error) dbError(scopeIns.error);
      }
    }

    return { ok: true };
  });


/**
 * Returns the caller's role based on which profile row exists.
 * Used by /login to route the user post-signin.
 */
export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const [coach, parent, athlete, orgAdmin] = await Promise.all([
      supabaseAdmin
        .from("coach_profiles")
        .select("id, onboarded_at")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("parent_profiles")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("athletes")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("org_admins")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle(),
    ]);
    if (coach.error) dbError(coach.error);
    if (parent.error) dbError(parent.error);
    if (athlete.error) dbError(athlete.error);
    if (orgAdmin.error) dbError(orgAdmin.error);

    if (coach.data?.onboarded_at) return { role: "coach" as const };
    if (parent.data) return { role: "parent" as const };
    if (athlete.data) return { role: "athlete" as const };
    if (coach.data) return { role: "coach" as const };
    // Pure org admin (no coach profile) — the club purchaser or a delegated director.
    if (orgAdmin.data) return { role: "org_admin" as const };
    return { role: null };
  });

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  }
  return out;
}

/**
 * List the signed-in parent's athletes linked to the coach behind `code`,
 * plus the sports that coach teaches.
 */
export const listAthletesForCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: optionalCodeSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    if (!data.code) {
      // Coach-less path: single query joining athletes to parent_profiles.
      const athletesRes = await supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name, parent_profiles!inner(user_id)")
        .eq("parent_profiles.user_id", userId)
        .order("created_at", { ascending: true });
      if (athletesRes.error) dbError(athletesRes.error);

      return {
        coachId: null as string | null,
        athletes: (athletesRes.data ?? []).map((a) => ({
          id: a.id,
          firstName: a.first_name,
          lastName: a.last_name,
        })),
        sports: [...SPORT_KEYS] as string[],
      };
    }

    // Coached path: parent lookup + code lookup in parallel.
    const [parent, codeLookup] = await Promise.all([
      supabaseAdmin.from("parent_profiles").select("id").eq("user_id", userId).maybeSingle(),
      supabaseAdmin.from("coach_invite_codes").select("coach_id").eq("code", data.code).maybeSingle(),
    ]);
    if (parent.error) dbError(parent.error);
    if (!parent.data) throw new Error("Parent profile not found.");
    if (codeLookup.error) dbError(codeLookup.error);
    if (!codeLookup.data) throw new Error("Invalid invite code.");
    const parentId = parent.data.id;
    const coachId = codeLookup.data.coach_id;

    // Athletes link + coach sports in parallel.
    const [links, levels] = await Promise.all([
      supabaseAdmin
        .from("coach_athletes")
        .select("athlete_id, athletes!inner(id, first_name, last_name, parent_id)")
        .eq("coach_id", coachId),
      supabaseAdmin.from("coach_levels").select("sport").eq("coach_id", coachId),
    ]);
    if (links.error) dbError(links.error);
    if (levels.error) dbError(levels.error);

    const athletes = (links.data ?? [])
      .map((l) => l.athletes as unknown as {
        id: string;
        first_name: string;
        last_name: string;
        parent_id: string;
      })
      .filter((a) => a.parent_id === parentId)
      .map((a) => ({ id: a.id, firstName: a.first_name, lastName: a.last_name }));

    const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));

    return { coachId: coachId as string | null, athletes, sports };
  });

export const saveAthleteGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: optionalCodeSchema,
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
    const userId = context.userId;

    let coachId: string | null = null;
    if (data.code) {
      const codeLookup = await supabaseAdmin
        .from("coach_invite_codes")
        .select("coach_id")
        .eq("code", data.code)
        .maybeSingle();
      if (codeLookup.error) dbError(codeLookup.error);
      if (!codeLookup.data) throw new Error("Invalid invite code.");
      coachId = codeLookup.data.coach_id;
    }

    // Ownership check
    const athlete = await supabaseAdmin
      .from("athletes")
      .select("id, parent_id, parent_profiles!inner(user_id)")
      .eq("id", data.athleteId)
      .maybeSingle();
    if (athlete.error) dbError(athlete.error);
    const parentRow = athlete.data?.parent_profiles as unknown as { user_id: string } | undefined;
    if (!athlete.data || parentRow?.user_id !== userId) {
      throw new Error("Athlete not found.");
    }

    let stampCoachId: string | null = coachId;
    if (coachId) {
      // Ensure a primary coach exists for this (athlete, sport).
      const primary = await supabaseAdmin
        .from("athlete_primary_coaches")
        .upsert(
          { athlete_id: data.athleteId, sport: data.sport, coach_id: coachId },
          { onConflict: "athlete_id,sport", ignoreDuplicates: true },
        );
      if (primary.error) dbError(primary.error);

      const resolvedPrimary = await supabaseAdmin
        .from("athlete_primary_coaches")
        .select("coach_id")
        .eq("athlete_id", data.athleteId)
        .eq("sport", data.sport)
        .maybeSingle();
      if (resolvedPrimary.error) dbError(resolvedPrimary.error);
      stampCoachId = resolvedPrimary.data?.coach_id ?? coachId;
    }

    const up = await supabaseAdmin
      .from("athlete_goals")
      .upsert(
        {
          athlete_id: data.athleteId,
          coach_id: stampCoachId,
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

export const saveAthleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: optionalCodeSchema,
        athleteId: z.string().uuid(),
        slots: z
          .array(
            z.object({
              dayOfWeek: z.number().int().min(0).max(6),
              startMinute: z.number().int().min(0).max(1439),
              endMinute: z.number().int().min(1).max(1440),
              frequency: z.enum(["weekly", "biweekly", "twice_monthly", "monthly"]).default("weekly"),
              weeksOfMonth: z.array(z.number().int().min(1).max(5)).default([]),
              startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
            }),
          )
          .max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    for (const s of data.slots) {
      if (s.endMinute <= s.startMinute) throw new Error("End time must be after start time.");
    }

    let coachId: string | null = null;
    if (data.code) {
      const codeLookup = await supabaseAdmin
        .from("coach_invite_codes")
        .select("coach_id")
        .eq("code", data.code)
        .maybeSingle();
      if (codeLookup.error) dbError(codeLookup.error);
      if (!codeLookup.data) throw new Error("Invalid invite code.");
      coachId = codeLookup.data.coach_id;
    }

    const athlete = await supabaseAdmin
      .from("athletes")
      .select("id, parent_profiles!inner(user_id)")
      .eq("id", data.athleteId)
      .maybeSingle();
    if (athlete.error) dbError(athlete.error);
    const parentRow = athlete.data?.parent_profiles as unknown as { user_id: string } | undefined;
    if (!athlete.data || parentRow?.user_id !== userId) {
      throw new Error("Athlete not found.");
    }

    // Replace only the rows scoped to this coach (or coach-less rows when
    // no code) so each coach owns their own schedule blocks.
    const delQuery = supabaseAdmin
      .from("athlete_lesson_slots")
      .delete()
      .eq("athlete_id", data.athleteId);
    const del = await (coachId ? delQuery.eq("coach_id", coachId) : delQuery.is("coach_id", null));
    if (del.error) dbError(del.error);

    if (data.slots.length > 0) {
      const ins = await supabaseAdmin.from("athlete_lesson_slots").insert(
        data.slots.map((s) => ({
          athlete_id: data.athleteId,
          coach_id: coachId,
          day_of_week: s.dayOfWeek,
          start_minute: s.startMinute,
          end_minute: s.endMinute,
          frequency: s.frequency,
          weeks_of_month: s.frequency === "biweekly" || s.frequency === "weekly" ? [] : s.weeksOfMonth,
          starts_on: s.frequency === "biweekly" ? s.startsOn : null,
        })),
      );
      if (ins.error) dbError(ins.error);
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;
    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent.error) dbError(parent.error);
    if (!parent.data) return { athletes: [] };
    const parentId = parent.data.id;

    const [athletes, parentPromo] = await Promise.all([
      supabaseAdmin
        .from("athletes")
        .select("id, first_name, last_name")
        .eq("parent_id", parentId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("parent_profiles")
        .select("promo_code")
        .eq("id", parentId)
        .maybeSingle(),
    ]);
    if (athletes.error) dbError(athletes.error);
    const inviterPromo = parentPromo.data?.promo_code ?? null;

    const existing = await supabaseAdmin
      .from("athlete_invite_codes")
      .select("athlete_id, code")
      .eq("parent_id", parentId);
    if (existing.error) dbError(existing.error);
    const byAthlete = new Map((existing.data ?? []).map((r) => [r.athlete_id, r.code]));

    for (const a of athletes.data ?? []) {
      if (byAthlete.has(a.id)) continue;
      // Generate, retry on collision a few times
      let inserted = false;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        const code = genCode(8);
        const ins = await supabaseAdmin
          .from("athlete_invite_codes")
          .insert({
            parent_id: parentId,
            athlete_id: a.id,
            code,
            promo_code: inviterPromo,
          })
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

/**
 * Returns the signed-in parent's invite code, creating one on first use.
 * Coaches use this code (or the link wrapping it) to join the parent's
 * account.
 */
export const getOrCreateParentInviteCode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const parent = await supabaseAdmin
      .from("parent_profiles")
      .select("id, promo_code")
      .eq("user_id", userId)
      .maybeSingle();
    if (parent.error) dbError(parent.error);
    if (!parent.data) throw new Error("Parent profile not found.");
    const parentId = parent.data.id;
    const inviterPromo = parent.data.promo_code ?? null;

    const existing = await supabaseAdmin
      .from("parent_invite_codes")
      .select("code")
      .eq("parent_id", parentId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data) return { code: existing.data.code };

    for (let attempt = 0; attempt < 8; attempt++) {
      const code = genCode(8);
      const ins = await supabaseAdmin
        .from("parent_invite_codes")
        .insert({ parent_id: parentId, code, promo_code: inviterPromo })
        .select("code")
        .maybeSingle();
      if (!ins.error && ins.data) return { code: ins.data.code };
      // Collision on either parent_id (race) or code: re-read parent's row.
      const reread = await supabaseAdmin
        .from("parent_invite_codes")
        .select("code")
        .eq("parent_id", parentId)
        .maybeSingle();
      if (reread.data) return { code: reread.data.code };
    }
    throw new Error("Could not generate a unique invite code.");
  });

/**
 * Public-ish lookup for a parent's invite code. Used by /signup/coach before
 * the coach has an account, so it's unauthenticated and rate-limited per IP.
 */
export const getParentByInviteCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ code: codeSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip = clientIp();

    const limit = await supabaseAdmin.rpc("record_invite_lookup_attempt", {
      _ip: ip,
      _code: data.code,
      _max_per_window: RATE_MAX_PER_WINDOW,
      _window_seconds: RATE_WINDOW_SECONDS,
    });
    if (limit.error) dbError(limit.error);
    if (limit.data === -1) {
      throw new Error("Too many attempts. Please wait a minute and try again.");
    }

    const lookup = await supabaseAdmin.rpc("get_parent_by_invite_code", { _code: data.code });
    if (lookup.error) dbError(lookup.error);
    const row = (lookup.data ?? [])[0];
    if (!row) throw new Error("That parent invite code isn't valid.");
    return {
      parentId: row.parent_id as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      athleteCount: row.athlete_count as number,
    };
  });

/**
 * Called by an authenticated, onboarded coach to claim a parent invite:
 * - Adds coach_athletes links for every athlete under the parent.
 * - Enables every sport the coach offers on each athlete (coach_athlete_sports).
 * - Fills the coach_id on any of the parent's coach-less athlete_goals /
 *   athlete_lesson_slots rows that match a sport the coach offers.
 * - Sets athlete_primary_coaches for each (athlete, sport) when missing.
 *
 * Idempotent: re-running it for the same coach is a no-op.
 */
export const claimParentInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: codeSchema,
        // When true, marks the coach side as already acknowledged so the
        // celebration modal doesn't appear on the coach's first page load
        // after the signup wizard. Used by /signup/coach?invite=...
        autoAckCoach: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const userId = context.userId;

    const coach = await supabaseAdmin
      .from("coach_profiles")
      .select("id, promo_code")
      .eq("user_id", userId)
      .maybeSingle();
    if (coach.error) dbError(coach.error);
    if (!coach.data) throw new Error("Coach profile not found.");
    const coachId = coach.data.id;

    const inviteRow = await supabaseAdmin
      .from("parent_invite_codes")
      .select("parent_id, promo_code")
      .eq("code", data.code)
      .maybeSingle();
    if (inviteRow.error) dbError(inviteRow.error);
    if (!inviteRow.data) throw new Error("That parent invite code isn't valid.");
    const parentId = inviteRow.data.parent_id;

    // Propagate the inviter's promo code onto the coach's own row so it
    // becomes their attribution + auto-applies at Stripe checkout.
    // First-invite-wins: only stamp when the coach doesn't already have one.
    if (inviteRow.data.promo_code && !coach.data.promo_code) {
      await supabaseAdmin
        .from("coach_profiles")
        .update({ promo_code: inviteRow.data.promo_code })
        .eq("id", coachId)
        .is("promo_code", null);
    }

    // Athletes under this parent
    const athletesRes = await supabaseAdmin
      .from("athletes")
      .select("id")
      .eq("parent_id", parentId);
    if (athletesRes.error) dbError(athletesRes.error);
    const athleteIds = (athletesRes.data ?? []).map((a) => a.id);
    if (athleteIds.length === 0) return { ok: true, athletes: 0, sports: 0 };

    // Sports this coach offers
    const levelsRes = await supabaseAdmin
      .from("coach_levels")
      .select("sport")
      .eq("coach_id", coachId);
    if (levelsRes.error) dbError(levelsRes.error);
    const coachSports = Array.from(new Set((levelsRes.data ?? []).map((l) => l.sport)));

    // 1. coach_athletes (skip duplicates). Ack coach side when the caller
    //    is the signup wizard (celebration modal would duplicate the
    //    wizard's own confirmation screen).
    const ackIso = data.autoAckCoach ? new Date().toISOString() : null;
    const linkRows = athleteIds.map((athlete_id) => ({
      coach_id: coachId,
      athlete_id,
      ...(ackIso ? { coach_ack_at: ackIso } : {}),
    }));
    const linksIns = await supabaseAdmin
      .from("coach_athletes")
      .upsert(linkRows, { onConflict: "coach_id,athlete_id", ignoreDuplicates: true });
    if (linksIns.error) dbError(linksIns.error);

    if (coachSports.length === 0) return { ok: true, athletes: athleteIds.length, sports: 0 };

    // 2. coach_athlete_sports for each (athlete, sport)
    const scopeRows = athleteIds.flatMap((athlete_id) =>
      coachSports.map((sport) => ({ athlete_id, coach_id: coachId, sport })),
    );
    const scopeIns = await supabaseAdmin
      .from("coach_athlete_sports")
      .upsert(scopeRows, { onConflict: "athlete_id,coach_id,sport", ignoreDuplicates: true });
    if (scopeIns.error) dbError(scopeIns.error);

    // 3. Fill coach_id on pending parent-owned goals/slots that match a
    //    sport this coach offers.
    const goalsUpd = await supabaseAdmin
      .from("athlete_goals")
      .update({ coach_id: coachId })
      .in("athlete_id", athleteIds)
      .in("sport", coachSports)
      .is("coach_id", null);
    if (goalsUpd.error) dbError(goalsUpd.error);

    const slotsUpd = await supabaseAdmin
      .from("athlete_lesson_slots")
      .update({ coach_id: coachId })
      .in("athlete_id", athleteIds)
      .is("coach_id", null);
    if (slotsUpd.error) dbError(slotsUpd.error);

    // 4. athlete_primary_coaches — set missing (athlete, sport) → coach.
    const primaryRows = athleteIds.flatMap((athlete_id) =>
      coachSports.map((sport) => ({ athlete_id, sport, coach_id: coachId })),
    );
    const primaryIns = await supabaseAdmin
      .from("athlete_primary_coaches")
      .upsert(primaryRows, { onConflict: "athlete_id,sport", ignoreDuplicates: true });
    if (primaryIns.error) dbError(primaryIns.error);

    return { ok: true, athletes: athleteIds.length, sports: coachSports.length };
  });
