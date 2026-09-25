/**
 * Admin panel server functions for the App Review demo accounts (PRD
 * decision #26, 2026-09-24): a coach, a parent and a minor athlete under
 * that parent, created and seeded on demand so the set is repeatable for
 * reviews and screenshots. Internal admins only (`has_role(admin)`).
 *
 * Everything goes through the service-role client. Passwords are supplied
 * by the admin at run time and never stored here; the athlete signs in
 * with a username (synthetic email, like `signupAthleteWithUsername`).
 * Every seeded row is `is_test = true` so reports can exclude it. Names are
 * invented: nothing here refers to a real person.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import { getSport } from "./coach-sports";
import { syntheticEmailForAthlete } from "./api/auth-broker";
import { deleteAccountForUser } from "./account-deletion.server";
import { grantGuardianConsent, markParentVerifiedByAdmin } from "./guardian-verification.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

async function assertAdmin(context: { userId: string; supabase: AnyClient }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) dbError(error);
  if (!data) throw new Error("Forbidden");
  return context.userId;
}

async function adminClient(): Promise<AnyClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as AnyClient;
}

/** The invented identities. Change here, nowhere else. */
export const DEMO_PEOPLE = {
  coach: { firstName: "Jordan", lastName: "Vale" },
  parent: { firstName: "Casey", lastName: "Rowan" },
  athlete: { firstName: "Sam", lastName: "Rowan", ageYears: 12 },
  sport: "figure_skating" as const,
  currentLevelKey: "juvenile",
  seasonGoalKey: "intermediate",
  longTermGoal: "Pass the Intermediate free skate test this season.",
  motivation: "Landing a clean double axel before regionals.",
} as const;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export const demoAccountsInput = z.object({
  coachEmail: z.string().trim().email(),
  parentEmail: z.string().trim().email(),
  athleteUsername: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,24}$/, "3–24 letters, digits, dots or underscores"),
  /** One password for all three; the admin enters it in App Store Connect. */
  password: z.string().min(12, "At least 12 characters"),
  /** Delete any existing demo accounts with these emails first. */
  reset: z.boolean().default(false),
});

export type DemoAccountsStatus = {
  coach: {
    email: string;
    userId: string | null;
    coachId: string | null;
    inviteCode: string | null;
  };
  parent: { email: string; userId: string | null; parentId: string | null };
  athlete: { username: string; userId: string | null; athleteId: string | null };
};

export type DemoAccountsResult = DemoAccountsStatus & {
  seeded: { plans: number; sessions: number; messages: number; lessons: number };
};

async function findUserIdByEmail(admin: AnyClient, email: string): Promise<string | null> {
  // The admin API has no lookup by email; the user base is small enough to page.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 500 });
    if (error) throw new Error(error.message);
    const hit = (data?.users ?? []).find(
      (u: { email?: string | null }) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (hit) return hit.id as string;
    if ((data?.users ?? []).length < 500) break;
  }
  return null;
}

async function status(
  admin: AnyClient,
  input: { coachEmail: string; parentEmail: string; athleteUsername: string },
): Promise<DemoAccountsStatus> {
  const [coachUserId, parentUserId] = await Promise.all([
    findUserIdByEmail(admin, input.coachEmail),
    findUserIdByEmail(admin, input.parentEmail),
  ]);
  const coach = coachUserId
    ? await admin
        .from("coach_profiles")
        .select("id, coach_invite_codes(code)")
        .eq("user_id", coachUserId)
        .maybeSingle()
    : { data: null };
  const parent = parentUserId
    ? await admin.from("parent_profiles").select("id").eq("user_id", parentUserId).maybeSingle()
    : { data: null };
  const athlete = await admin
    .from("athletes")
    .select("id, user_id")
    .eq("username", input.athleteUsername)
    .maybeSingle();
  const codes = (coach.data?.coach_invite_codes ?? null) as
    | { code: string }[]
    | { code: string }
    | null;
  const inviteCode = Array.isArray(codes) ? (codes[0]?.code ?? null) : (codes?.code ?? null);
  return {
    coach: {
      email: input.coachEmail,
      userId: coachUserId,
      coachId: coach.data?.id ?? null,
      inviteCode,
    },
    parent: { email: input.parentEmail, userId: parentUserId, parentId: parent.data?.id ?? null },
    athlete: {
      username: input.athleteUsername,
      userId: athlete.data?.user_id ?? null,
      athleteId: athlete.data?.id ?? null,
    },
  };
}

export const adminGetDemoAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    demoAccountsInput.pick({ coachEmail: true, parentEmail: true, athleteUsername: true }).parse(d),
  )
  .handler(async ({ context, data }): Promise<DemoAccountsStatus> => {
    await assertAdmin(context);
    return status(await adminClient(), data);
  });

function iso(daysAgo: number, hour = 19, minute = 30): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

function birthdateYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCMonth(2, 14);
  return d.toISOString().slice(0, 10);
}

/**
 * Create (or reset and recreate) the three accounts and seed them with a
 * roster link, sport scope, goals, a weekly lesson, the coach's starter
 * move library, one active plan with three moves, four logged sessions
 * and a short conversation. Idempotent per email/username when `reset` is
 * false: existing accounts are refused rather than duplicated.
 */
export const adminSeedDemoAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => demoAccountsInput.parse(d))
  .handler(async ({ context, data }): Promise<DemoAccountsResult> => {
    await assertAdmin(context);
    const admin = await adminClient();

    const before = await status(admin, data);
    const existing = [before.coach.userId, before.parent.userId, before.athlete.userId].filter(
      Boolean,
    ) as string[];
    if (existing.length && !data.reset) {
      throw new Error(
        "Demo accounts already exist for these emails or username. Tick “Reset” to delete and recreate them.",
      );
    }
    if (existing.length) {
      // Athlete first (a parent deletion would otherwise have to decide the
      // minor's fate), then parent, then coach. Each call cascades its own rows.
      for (const [userId, email] of [
        [before.athlete.userId, null],
        [before.parent.userId, before.parent.email],
        [before.coach.userId, before.coach.email],
      ] as [string | null, string | null][]) {
        if (userId) await deleteAccountForUser(userId, email, "admin", []);
      }
      if (before.athlete.athleteId) {
        await admin.from("athletes").delete().eq("id", before.athlete.athleteId);
      }
    }

    const sport = getSport(DEMO_PEOPLE.sport);
    if (!sport) throw new Error("Demo sport missing from the catalog");
    const nowIso = new Date().toISOString();

    // ---- Coach ----
    const coachUser = await admin.auth.admin.createUser({
      email: data.coachEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        given_name: DEMO_PEOPLE.coach.firstName,
        family_name: DEMO_PEOPLE.coach.lastName,
        full_name: `${DEMO_PEOPLE.coach.firstName} ${DEMO_PEOPLE.coach.lastName}`,
        demo_account: true,
      },
    });
    if (coachUser.error || !coachUser.data?.user) {
      throw new Error(coachUser.error?.message ?? "Couldn't create the coach user");
    }
    const coachUserId = coachUser.data.user.id as string;
    const coachProfile = await admin
      .from("coach_profiles")
      .insert({
        user_id: coachUserId,
        first_name: DEMO_PEOPLE.coach.firstName,
        last_name: DEMO_PEOPLE.coach.lastName,
        onboarded_at: nowIso,
        entitlement: "promo_free",
        founding_coach: true,
        is_test: true,
      })
      .select("id")
      .single();
    if (coachProfile.error) dbError(coachProfile.error);
    const coachId = coachProfile.data.id as string;

    const levels = await admin.from("coach_levels").insert(
      sport.levels.map((l) => ({
        coach_id: coachId,
        sport: sport.key,
        level_key: l.key,
        practice_hours_per_week: l.suggestedHours,
      })),
    );
    if (levels.error) dbError(levels.error);
    const seedLib = await admin.rpc("seed_coach_library", { _coach_id: coachId });
    if (seedLib.error) dbError(seedLib.error);

    let coachCode = "";
    for (let attempt = 0; attempt < 5 && !coachCode; attempt++) {
      const code = genCode(8);
      const ins = await admin.from("coach_invite_codes").insert({ coach_id: coachId, code });
      if (!ins.error) coachCode = code;
    }

    // ---- Parent ----
    const parentUser = await admin.auth.admin.createUser({
      email: data.parentEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        given_name: DEMO_PEOPLE.parent.firstName,
        family_name: DEMO_PEOPLE.parent.lastName,
        full_name: `${DEMO_PEOPLE.parent.firstName} ${DEMO_PEOPLE.parent.lastName}`,
        demo_account: true,
      },
    });
    if (parentUser.error || !parentUser.data?.user) {
      throw new Error(parentUser.error?.message ?? "Couldn't create the parent user");
    }
    const parentUserId = parentUser.data.user.id as string;
    const parentProfile = await admin
      .from("parent_profiles")
      .insert({
        user_id: parentUserId,
        first_name: DEMO_PEOPLE.parent.firstName,
        last_name: DEMO_PEOPLE.parent.lastName,
        coach_id: coachId,
        is_test: true,
      })
      .select("id")
      .single();
    if (parentProfile.error) dbError(parentProfile.error);
    const parentId = parentProfile.data.id as string;
    // App Review cannot pass a card check (PRD §6.13 A2, risk #24): the demo
    // parent is verified by the admin tool, method `admin`.
    await markParentVerifiedByAdmin(admin, parentId, "admin-demo-accounts");

    // ---- Athlete (minor, username login) ----
    const athleteRow = await admin
      .from("athletes")
      .insert({
        first_name: DEMO_PEOPLE.athlete.firstName,
        last_name: DEMO_PEOPLE.athlete.lastName,
        birthdate: birthdateYearsAgo(DEMO_PEOPLE.athlete.ageYears),
        parent_id: parentId,
        added_by_coach_id: coachId,
        motivation: DEMO_PEOPLE.motivation,
        is_test: true,
      })
      .select("id")
      .single();
    if (athleteRow.error) dbError(athleteRow.error);
    const athleteId = athleteRow.data.id as string;
    await grantGuardianConsent(admin, {
      athleteId,
      parentId,
      method: "admin",
      evidence: { seeder: "admin-demo-accounts" },
    });

    const athleteUser = await admin.auth.admin.createUser({
      email: syntheticEmailForAthlete(athleteId),
      password: data.password,
      email_confirm: true,
      user_metadata: { athlete_id: athleteId, username: data.athleteUsername, demo_account: true },
    });
    if (athleteUser.error || !athleteUser.data?.user) {
      throw new Error(athleteUser.error?.message ?? "Couldn't create the athlete user");
    }
    const athleteUserId = athleteUser.data.user.id as string;
    const bind = await admin
      .from("athletes")
      .update({ user_id: athleteUserId, username: data.athleteUsername })
      .eq("id", athleteId);
    if (bind.error) dbError(bind.error);
    const athleteCode = await admin.from("athlete_invite_codes").insert({
      parent_id: parentId,
      athlete_id: athleteId,
      code: genCode(8),
      used_at: nowIso,
      claimed_by: athleteUserId,
      claimed_at: nowIso,
    });
    if (athleteCode.error) dbError(athleteCode.error);

    // ---- Roster link, sport scope, goals, lesson ----
    const link = await admin.from("coach_athletes").insert({
      coach_id: coachId,
      athlete_id: athleteId,
      coach_ack_at: nowIso,
      other_ack_at: nowIso,
    });
    if (link.error) dbError(link.error);
    const scope = await admin
      .from("coach_athlete_sports")
      .insert({ coach_id: coachId, athlete_id: athleteId, sport: sport.key });
    if (scope.error) dbError(scope.error);
    const primary = await admin
      .from("athlete_primary_coaches")
      .upsert(
        { athlete_id: athleteId, sport: sport.key, coach_id: coachId },
        { onConflict: "athlete_id,sport" },
      );
    if (primary.error) dbError(primary.error);
    const goals = await admin.from("athlete_goals").upsert(
      {
        athlete_id: athleteId,
        coach_id: coachId,
        sport: sport.key,
        current_level_key: DEMO_PEOPLE.currentLevelKey,
        season_goal_key: DEMO_PEOPLE.seasonGoalKey,
        long_term_goal: DEMO_PEOPLE.longTermGoal,
      },
      { onConflict: "athlete_id,sport" },
    );
    if (goals.error) dbError(goals.error);
    const lesson = await admin.from("athlete_lesson_slots").insert({
      athlete_id: athleteId,
      coach_id: coachId,
      day_of_week: 2,
      start_minute: 16 * 60,
      end_minute: 17 * 60,
      frequency: "weekly",
      weeks_of_month: [],
      starts_on: null,
    });
    if (lesson.error) dbError(lesson.error);

    // ---- One active plan from the seeded library, four sessions ----
    const libMoves = await admin
      .from("moves")
      .select("id, name, description, cue, why, default_target_kind, default_target_value")
      .eq("coach_id", coachId)
      .eq("sport", sport.key)
      .is("archived_at", null)
      .order("name", { ascending: true })
      .limit(40);
    if (libMoves.error) dbError(libMoves.error);
    type LibMove = {
      id: string;
      name: string;
      description: string | null;
      cue: string | null;
      why: string | null;
      default_target_kind: string | null;
      default_target_value: number | null;
    };
    const library = (libMoves.data ?? []) as LibMove[];
    const pick = (needle: string) =>
      library.find((m) => m.name.toLowerCase().includes(needle)) ?? null;
    const chosen = [pick("waltz"), pick("salchow"), pick("spin")].filter(Boolean) as LibMove[];
    const moves: LibMove[] = chosen.length >= 2 ? chosen : library.slice(0, 3);

    const plan = await admin
      .from("plans")
      .insert({
        coach_id: coachId,
        athlete_id: athleteId,
        title: "Juvenile — Free Skate",
        notes: "Two weeks to the test. Keep the program run-throughs clean before adding speed.",
        kind: "plan",
        status: "active",
        updated_at: iso(1, 18, 10),
      })
      .select("id")
      .single();
    if (plan.error) dbError(plan.error);
    const planId = plan.data.id as string;
    if (moves.length) {
      const pm = await admin.from("plan_moves").insert(
        moves.map((m, i) => ({
          plan_id: planId,
          move_id: m.id,
          position: i,
          name: m.name,
          description: m.description ?? "",
          cue: m.cue ?? "",
          why: m.why ?? "",
          target_kind: m.default_target_kind ?? "reps",
          target_value: m.default_target_value ?? 10,
        })),
      );
      if (pm.error) dbError(pm.error);
    }
    const sessionRows = [
      { daysAgo: 2, state: 3, note: "Salchow landed 6 of 8." },
      { daysAgo: 5, state: 2, note: "Tired after school." },
      { daysAgo: 9, state: 2, note: "" },
      { daysAgo: 13, state: 1, note: "" },
    ].map((s) => ({
      plan_id: planId,
      athlete_id: athleteId,
      parent_id: null,
      duration_seconds: 1500,
      logged_at: iso(s.daysAgo, 22, 10),
      state_index: s.state,
      note: s.note,
    }));
    const sessions = await admin.from("plan_sessions").insert(sessionRows);
    if (sessions.error) dbError(sessions.error);

    // ---- A short conversation ----
    const room = await admin
      .from("message_rooms")
      .insert({ coach_id: coachId, athlete_id: athleteId })
      .select("id")
      .single();
    if (room.error) dbError(room.error);
    const messageRows = [
      {
        sender_user_id: coachUserId,
        sender_role: "coach",
        body: "Welcome to Gradus! Your first plan is up — three moves, about eight minutes. Log a session after each practice.",
        created_at: iso(6, 15, 0),
      },
      {
        sender_user_id: parentUserId,
        sender_role: "parent",
        body: "Thanks Jordan. Sam practised Tuesday and Thursday this week.",
        created_at: iso(5, 20, 30),
      },
      {
        sender_user_id: athleteUserId,
        sender_role: "athlete",
        body: "The salchow felt way better today!",
        created_at: iso(2, 22, 15),
      },
    ].map((m) => ({
      ...m,
      kind: "text",
      room_id: room.data.id,
      direct_room_id: null,
      plan_id: null,
      audio_url: null,
      duration_seconds: null,
    }));
    const messages = await admin.from("messages").insert(messageRows);
    if (messages.error) dbError(messages.error);

    return {
      coach: {
        email: data.coachEmail,
        userId: coachUserId,
        coachId,
        inviteCode: coachCode || null,
      },
      parent: { email: data.parentEmail, userId: parentUserId, parentId },
      athlete: { username: data.athleteUsername, userId: athleteUserId, athleteId },
      seeded: { plans: 1, sessions: sessionRows.length, messages: messageRows.length, lessons: 1 },
    };
  });
