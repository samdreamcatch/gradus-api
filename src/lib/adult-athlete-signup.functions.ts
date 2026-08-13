import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

const nameSchema = z.string().trim().min(1, "Required").max(60, "Too long");

const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(8, "Invite code must be 8 characters")
  .regex(/^[A-Z2-9]+$/, "Invalid characters in code");

// Server-side age gate. The DB trigger enforces this too; the double check
// gives a friendlier error before we hit Postgres.
function ageInYears(birthdate: string): number {
  const [y, m, d] = birthdate.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const bMonth = m - 1;
  if (now.getMonth() < bMonth || (now.getMonth() === bMonth && now.getDate() < d)) {
    age -= 1;
  }
  return age;
}

const birthdateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      !Number.isNaN(dt.getTime()) &&
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "Enter a valid date")
  .refine((v) => ageInYears(v) < 120, "Enter a valid date");

/**
 * Create the signed-in user's self-managed athlete row. Idempotent: if the
 * caller already has an athletes row we return it unchanged (birthdate is
 * locked once written).
 *
 * Under-18 athletes may manage their own login as long as a parent/guardian
 * email is on file — the DB trigger `enforce_adult_self_managed` enforces
 * that. When one is supplied we mint a claim token and email the guardian.
 *
 * Uses the user-scoped supabase client so RLS decides authorization — the
 * "Adults can insert own self-managed athlete row" policy plus the trigger
 * are the only gates.
 */
export const createSelfManagedAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        firstName: nameSchema,
        lastName: nameSchema,
        birthdate: birthdateSchema,
        guardianEmail: z
          .string()
          .trim()
          .toLowerCase()
          .email("Enter a valid parent or guardian email")
          .max(255)
          .optional(),
      })
      .refine((v) => ageInYears(v.birthdate) >= 18 || Boolean(v.guardianEmail), {
        message: "Athletes under 18 need a parent or guardian email.",
        path: ["guardianEmail"],
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const isMinor = ageInYears(data.birthdate) < 18;

    // Idempotent: don't error if the user already has a row (e.g. the signup
    // form was submitted twice, or they returned to onboarding).
    const existing = await supabase
      .from("athletes")
      .select("id, self_managed")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data) {
      if (!existing.data.self_managed) {
        throw new Error("This account is already registered as a parent-managed athlete.");
      }
      return { athleteId: existing.data.id };
    }

    const { newGuardianToken, sendGuardianInvite } = await import("./guardian.server");
    const guardianEmail = isMinor ? (data.guardianEmail ?? null) : null;
    const guardianToken = guardianEmail ? newGuardianToken() : null;

    const insert = await supabase
      .from("athletes")
      .insert({
        first_name: data.firstName,
        last_name: data.lastName,
        birthdate: data.birthdate,
        self_managed: true,
        parent_id: null,
        user_id: context.userId,
        guardian_email: guardianEmail,
        guardian_claim_token: guardianToken,
        guardian_invited_at: guardianEmail ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    if (insert.error) {
      // 23514 = check_violation (age trigger). Give a friendly message.
      if ((insert.error as { code?: string }).code === "23514") {
        throw new Error("Athletes under 18 need a parent or guardian email.");
      }

      dbError(insert.error);
    }

    if (guardianEmail && guardianToken) {
      await sendGuardianInvite({
        to: guardianEmail,
        athleteName: `${data.firstName} ${data.lastName}`.trim(),
        token: guardianToken,
      });
    }

    return { athleteId: insert.data.id };
  });

/**
 * Any athlete with their own login may connect coaches. The requirement is a
 * reachable guardian, not self-management: adults need nothing, minors need
 * either a guardian email on file or a linked parent account (whose email is
 * the guardian on file).
 */
export function athleteCanConnectCoach(row: {
  birthdate: string | null;
  guardian_email: string | null;
  parent_id: string | null;
}): boolean {
  const minor = row.birthdate ? ageInYears(row.birthdate) < 18 : false;
  if (!minor) return true;
  return Boolean(row.guardian_email) || Boolean(row.parent_id);
}

function assertCanConnectCoach(row: {
  birthdate: string | null;
  guardian_email: string | null;
  parent_id: string | null;
}) {
  if (!athleteCanConnectCoach(row)) {
    throw new Error("Add a parent or guardian email in Settings before connecting a coach.");
  }
}


/**
 * Preview a coach by invite code from the adult-athlete onboarding screen.
 * Mirrors previewCoachByInviteCode from parent-settings but does not gate
 * on parent ownership — any signed-in self-managed athlete can preview.
 */
export const previewCoachForAdultAthlete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ code: inviteCodeSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Any athlete with their own login may preview; minors need a guardian
    // email on file or a linked parent account.
    const me = await supabaseAdmin
      .from("athletes")
      .select("id, self_managed, birthdate, guardian_email, parent_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (me.error) dbError(me.error);
    if (!me.data) throw new Error("Finish setting up your athlete profile first.");
    assertCanConnectCoach(me.data);

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

/**
 * Link the caller's self-managed athlete row to a coach via that coach's
 * 8-char invite code. Mirrors linkAthleteToCoach from parent-settings; the
 * user-scoped supabase client + RLS keep this restricted to self-managed
 * athletes (see is_self_managed_athlete + the corresponding INSERT policies).
 */
export const linkAdultAthleteToCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        code: inviteCodeSchema,
        sports: z.array(z.string().min(1).max(64)).min(1, "Pick at least one sport").max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = context.supabase as Client;

    // Resolve the caller's self-managed athlete.
    const me = await supabase
      .from("athletes")
      .select("id, self_managed, birthdate, guardian_email, parent_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (me.error) dbError(me.error);
    if (!me.data) throw new Error("Finish setting up your athlete profile first.");
    assertCanConnectCoach(me.data);
    const athleteId = me.data.id;

    // Resolve the coach code (admin: codes are opaque, no RLS gate needed).
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

    // Validate selected sports are actually offered by this coach.
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

    // Don't double-link.
    const existing = await supabase
      .from("coach_athletes")
      .select("id")
      .eq("athlete_id", athleteId)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (existing.error) dbError(existing.error);
    if (existing.data) {
      throw new Error("That coach is already linked to your account.");
    }

    // Insert the roster link under the athlete's own RLS branch.
    const ins = await supabase
      .from("coach_athletes")
      .insert({ athlete_id: athleteId, coach_id: coachId });
    if (ins.error) dbError(ins.error);

    const scopeRows = chosen.map((sport) => ({
      athlete_id: athleteId,
      coach_id: coachId,
      sport,
    }));
    const scopeIns = await supabase.from("coach_athlete_sports").insert(scopeRows);
    if (scopeIns.error) dbError(scopeIns.error);

    return { ok: true, coachId };
  });

/**
 * Returns { hasAthlete, needsOnboarding } for the signed-in adult athlete.
 * needsOnboarding is true when the athlete row hasn't been created yet.
 */
export const getAdultOnboardingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const me = await supabase
      .from("athletes")
      .select("id, self_managed")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (me.error) dbError(me.error);
    return {
      hasAthlete: !!me.data,
      selfManaged: me.data?.self_managed ?? false,
      athleteId: me.data?.id ?? null,
    };
  });

/**
 * Resolve the athlete row owned by the caller's login. RLS
 * (athlete_can_self_connect) is the real gate on every mutator below.
 */
async function requireSelfManagedAthleteId(supabase: Client, userId: string): Promise<string> {
  const me = await supabase
    .from("athletes")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (me.error) dbError(me.error);
  if (!me.data) throw new Error("Finish setting up your athlete profile first.");
  return me.data.id;
}

/**
 * Upsert a goal for the caller's self-managed athlete. Mirrors
 * saveAthleteGoals from parent-signup, but scoped to auth.uid() — the
 * user-scoped supabase client + self_managed RLS branches are the gate.
 * If a linked primary coach for (athlete, sport) exists, stamp coach_id.
 */
export const saveAdultAthleteGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sport: z.string().min(1).max(64),
        currentLevelKey: z.string().min(1).max(64),
        seasonGoalKey: z.string().min(1).max(64),
        longTermGoal: z.string().max(2000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const athleteId = await requireSelfManagedAthleteId(supabase, context.userId);

    // If a primary coach for this sport exists, stamp coach_id so the row
    // matches the coach-visible RLS branch.
    const primary = await supabase
      .from("athlete_primary_coaches")
      .select("coach_id")
      .eq("athlete_id", athleteId)
      .eq("sport", data.sport)
      .maybeSingle();
    if (primary.error) dbError(primary.error);
    const coachId = primary.data?.coach_id ?? null;

    const up = await supabase.from("athlete_goals").upsert(
      {
        athlete_id: athleteId,
        coach_id: coachId,
        sport: data.sport,
        current_level_key: data.currentLevelKey,
        season_goal_key: data.seasonGoalKey,
        long_term_goal: data.longTermGoal,
      },
      { onConflict: "athlete_id,sport" },
    );
    if (up.error) dbError(up.error);

    const { ensureStarterPrograms } = await import("./starter-programs.server");
    await ensureStarterPrograms(athleteId, data.sport, data.currentLevelKey);

    return { ok: true };
  });

/**
 * List the caller's linked coaches (with per-coach sport scoping) for the
 * adult athlete settings screen.
 */
export const listAdultAthleteCoaches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase as Client;
    const me = await supabase
      .from("athletes")
      .select("id, self_managed, birthdate, guardian_email, parent_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (me.error) dbError(me.error);
    if (!me.data) {
      return { hasAthlete: false, canConnectCoach: false, needsGuardianEmail: false, coaches: [] };
    }
    // Minors can connect coaches too, but only with a guardian reachable —
    // either an email on file or a linked parent account.
    const needsGuardianEmail = !athleteCanConnectCoach(me.data);
    const athleteId = me.data.id;

    // RLS lets the athlete read their own coach_athletes rows, but not
    // coach_profiles — a !inner join would silently drop every row. Fetch
    // coach ids under RLS, then resolve names via the admin client (the
    // coach_athletes row already authorized the lookup).
    const links = await supabase
      .from("coach_athletes")
      .select("coach_id")
      .eq("athlete_id", athleteId);
    if (links.error) dbError(links.error);
    const coachIds = Array.from(new Set((links.data ?? []).map((l) => l.coach_id)));
    if (coachIds.length === 0) {
      return { hasAthlete: true, canConnectCoach: !needsGuardianEmail, needsGuardianEmail, coaches: [] };
    }

    const scoped = await supabase
      .from("coach_athlete_sports")
      .select("coach_id, sport")
      .eq("athlete_id", athleteId);
    if (scoped.error) dbError(scoped.error);
    const sportsByCoach = new Map<string, string[]>();
    for (const row of scoped.data ?? []) {
      const arr = sportsByCoach.get(row.coach_id) ?? [];
      arr.push(row.sport);
      sportsByCoach.set(row.coach_id, arr);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const profiles = await supabaseAdmin
      .from("coach_profiles")
      .select("id, first_name, last_name")
      .in("id", coachIds);
    if (profiles.error) dbError(profiles.error);

    const coaches = (profiles.data ?? []).map((cp) => ({
      coachId: cp.id,
      coachName: `${cp.first_name} ${cp.last_name}`.trim(),
      sports: sportsByCoach.get(cp.id) ?? [],
    }));

    return { hasAthlete: true, canConnectCoach: !needsGuardianEmail, needsGuardianEmail, coaches };
  });

/**
 * Unlink one of the caller's coaches. Deletes coach-scoped data so a relink
 * starts fresh (mirrors parent-settings unlinkAthleteFromCoach).
 */
export const unlinkAdultAthleteFromCoach = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ coachId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Client;
    const athleteId = await requireSelfManagedAthleteId(supabase, context.userId);

    await supabase
      .from("athlete_lesson_slots")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", data.coachId);
    await supabase
      .from("athlete_primary_coaches")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", data.coachId);
    await supabase
      .from("athlete_goals")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", data.coachId);

    const del = await supabase
      .from("coach_athletes")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", data.coachId);
    if (del.error) dbError(del.error);
    return { ok: true };
  });

/**
 * Replace the per-coach sport scoping for the caller. Mirrors
 * updateCoachAthleteSports from parent-settings.
 */
export const updateAdultAthleteCoachSports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        coachId: z.string().uuid(),
        sports: z.array(z.string().min(1).max(64)).min(1, "Pick at least one sport").max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = context.supabase as Client;
    const athleteId = await requireSelfManagedAthleteId(supabase, context.userId);

    const link = await supabase
      .from("coach_athletes")
      .select("id")
      .eq("athlete_id", athleteId)
      .eq("coach_id", data.coachId)
      .maybeSingle();
    if (link.error) dbError(link.error);
    if (!link.data) throw new Error("That coach isn't linked to your account.");

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

    const existing = await supabase
      .from("coach_athlete_sports")
      .select("sport")
      .eq("athlete_id", athleteId)
      .eq("coach_id", data.coachId);
    if (existing.error) dbError(existing.error);
    const currentSet = new Set((existing.data ?? []).map((r) => r.sport));
    const chosenSet = new Set(chosen);
    const toAdd = chosen.filter((s) => !currentSet.has(s));
    const toRemove = Array.from(currentSet).filter((s) => !chosenSet.has(s));

    if (toAdd.length > 0) {
      const ins = await supabase.from("coach_athlete_sports").insert(
        toAdd.map((sport) => ({
          athlete_id: athleteId,
          coach_id: data.coachId,
          sport,
        })),
      );
      if (ins.error) dbError(ins.error);
    }
    if (toRemove.length > 0) {
      const del = await supabase
        .from("coach_athlete_sports")
        .delete()
        .eq("athlete_id", athleteId)
        .eq("coach_id", data.coachId)
        .in("sport", toRemove);
      if (del.error) dbError(del.error);

      await supabase
        .from("athlete_primary_coaches")
        .delete()
        .eq("athlete_id", athleteId)
        .eq("coach_id", data.coachId)
        .in("sport", toRemove);
    }
    return { ok: true };
  });

/**
 * Return the coach's full offered sports so settings can offer *adding*
 * sports (not just removing). Only callable by self-managed athletes who
 * actually have the coach linked.
 */
export const getCoachOfferedSportsForAdult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ coachId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = context.supabase as Client;
    const athleteId = await requireSelfManagedAthleteId(supabase, context.userId);

    const link = await supabase
      .from("coach_athletes")
      .select("id")
      .eq("athlete_id", athleteId)
      .eq("coach_id", data.coachId)
      .maybeSingle();
    if (link.error) dbError(link.error);
    if (!link.data) throw new Error("That coach isn't linked to your account.");

    const offered = await supabaseAdmin
      .from("coach_levels")
      .select("sport")
      .eq("coach_id", data.coachId);
    if (offered.error) dbError(offered.error);
    const sports = Array.from(new Set((offered.data ?? []).map((r) => r.sport)));
    return { sports };
  });
