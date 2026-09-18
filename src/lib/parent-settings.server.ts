/**
 * Parent settings — the settings snapshot, the parent's own name, their
 * athletes (add, edit, remove, password reset), coach links by invite code
 * with per-coach sport scoping, primary coach per sport, goals, and
 * per-coach lesson schedules — the single source of truth for the web
 * server functions (parent-settings.functions.ts) and the
 * `/api/v1/parent/settings`, `/api/v1/parent/profile`, and
 * `/api/v1/parent/athletes*` routes (PRD §7.7, Appendix A "Parent and
 * athlete settings"). Extracted without behavior changes; user-facing
 * messages are kept verbatim and carried on ApiError so the API gets
 * stable codes.
 *
 * Every handler uses the admin client, as on the web: ownership is checked
 * explicitly (`assertOwnsAthlete`) rather than through RLS.
 */
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isMinorBirthdate } from "./athlete-age";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { inviteCodeSchema } from "./invites.server";
import { lessonSlotSchema } from "./parent-signup.server";
import { ensureStarterPrograms } from "./starter-programs.server";
import { guardianAthleteIdsSafe } from "./team.server";

type Admin = typeof supabaseAdmin;

export type ParentSettingsContext = { userId: string; admin: Admin };

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });
const wrongRole = (message: string) => new ApiError({ code: "wrong_role", status: 403, message });
const forbidden = (message: string) => new ApiError({ code: "forbidden", status: 403, message });
const alreadyLinked = (message: string) =>
  new ApiError({ code: "already_linked", status: 409, message });

/**
 * API-only strictness (PRD §6.2 stable codes). The web wrappers leave this
 * off and keep their original behavior, per PRD §4.1 rule 1.
 */
export type ApiContractOptions = {
  /** Refuse with a coded error instead of a silent no-op when the caller has no row to update. */
  apiContract?: boolean;
};

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type ParentSettingsCoachDTO = {
  coachId: string;
  coachName: string;
  sports: string[];
};

export type ParentSettingsSportDTO = {
  sport: string;
  primaryCoachId: string | null;
  primaryCoachName: string | null;
  eligibleCoaches: Array<{ coachId: string; coachName: string }>;
  goals: { currentLevelKey: string; seasonGoalKey: string; longTermGoal: string } | null;
};

export type ParentSettingsSlotDTO = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  frequency: "weekly" | "biweekly" | "twice_monthly" | "monthly";
  weeksOfMonth: number[];
  startsOn: string | null;
};

export type ParentSettingsScheduleDTO = {
  coachId: string;
  coachName: string;
  slots: ParentSettingsSlotDTO[];
};

export type ParentSettingsAthleteDTO = {
  id: string;
  firstName: string;
  lastName: string;
  birthdate: string | null;
  username: string | null;
  hasAccount: boolean;
  inviteCode: string | null;
  coaches: ParentSettingsCoachDTO[];
  sports: ParentSettingsSportDTO[];
  schedulesByCoach: ParentSettingsScheduleDTO[];
};

export type ParentSettingsDTO = {
  profile: { firstName: string; lastName: string };
  athletes: ParentSettingsAthleteDTO[];
};

export type CoachPreviewDTO = {
  coachId: string;
  coachName: string;
  sports: string[];
};

// ---------------------------------------------------------------------------
// Input schemas (same zod, same messages as the web)
// ---------------------------------------------------------------------------

export const parentProfileInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
});

export const newParentAthleteInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const parentAthleteInput = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthdate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Birthdate required (YYYY-MM-DD)")
    .nullable(),
});

export const parentAthleteGoalsInput = z.object({
  sport: z.string().min(1).max(64),
  currentLevelKey: z.string().min(1).max(64),
  seasonGoalKey: z.string().min(1).max(64),
  longTermGoal: z.string().max(2000).default(""),
});

export const athletePasswordInput = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const linkCoachInput = z.object({
  code: inviteCodeSchema,
  sports: z.array(z.string().min(1).max(64)).min(1, "Pick at least one sport").max(20),
});

export const coachSportsInput = z.object({
  sports: z.array(z.string().min(1).max(64)).min(1, "Pick at least one sport").max(20),
});

export const primaryCoachInput = z.object({
  sport: z.string().min(1).max(64),
  coachId: z.string().uuid(),
});

/** Schedules are per coach, so the coach travels in the body (there is no coach path segment on the schedule route). */
export const parentScheduleInput = z.object({
  coachId: z.string().uuid(),
  slots: z.array(lessonSlotSchema).max(20),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 8): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

async function getParentProfile(
  admin: Admin,
  userId: string,
): Promise<{
  id: string;
  first_name: string;
  last_name: string;
  promo_code: string | null;
}> {
  const parent = await admin
    .from("parent_profiles")
    .select("id, first_name, last_name, promo_code")
    .eq("user_id", userId)
    .maybeSingle();
  if (parent.error) dbError(parent.error);
  if (!parent.data) throw wrongRole("Parent profile not found.");
  return {
    id: parent.data.id,
    first_name: parent.data.first_name,
    last_name: parent.data.last_name,
    promo_code: parent.data.promo_code ?? null,
  };
}

/**
 * Deliberately primary-parent-only, unlike the read side (`getParentSettings`
 * via `guardianAthleteIdsSafe`): editing/removing an athlete, linking or
 * unlinking a coach, changing sports, replacing the schedule, setting goals,
 * and resetting the athlete's password are all primary-parent actions. A
 * shared guardian's own goal-editing capability (if any) belongs on a
 * separate, explicitly plan-gated path — not by widening this check.
 */
async function assertOwnsAthlete(admin: Admin, userId: string, athleteId: string) {
  const row = await admin
    .from("athletes")
    .select("id, parent_profiles!inner(user_id)")
    .eq("id", athleteId)
    .maybeSingle();
  if (row.error) dbError(row.error);
  const pp = row.data?.parent_profiles as unknown as { user_id: string } | undefined;
  if (!row.data || pp?.user_id !== userId) throw notFound("Athlete not found.");
}

/** Resolve primary coach for (athlete, sport); auto-pick earliest eligible coach if none. */
async function ensurePrimaryCoach(
  admin: Admin,
  athleteId: string,
  sport: string,
): Promise<string | null> {
  const existing = await admin
    .from("athlete_primary_coaches")
    .select("coach_id")
    .eq("athlete_id", athleteId)
    .eq("sport", sport)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data?.coach_id) return existing.data.coach_id;

  // Find earliest eligible coach who is linked to this athlete and teaches this sport.
  // Done as two queries since there is no direct FK between coach_athletes and coach_levels.
  const linked = await admin
    .from("coach_athletes")
    .select("coach_id, created_at")
    .eq("athlete_id", athleteId)
    .order("created_at", { ascending: true });
  if (linked.error) dbError(linked.error);
  const linkedCoachIds = (linked.data ?? []).map((r) => r.coach_id as string);
  if (linkedCoachIds.length === 0) return null;
  const teaching = await admin
    .from("coach_levels")
    .select("coach_id")
    .eq("sport", sport)
    .in("coach_id", linkedCoachIds);
  if (teaching.error) dbError(teaching.error);
  const teachingSet = new Set((teaching.data ?? []).map((r) => r.coach_id as string));
  const coachId = linkedCoachIds.find((id) => teachingSet.has(id));
  if (!coachId) return null;

  const ins = await admin
    .from("athlete_primary_coaches")
    .insert({ athlete_id: athleteId, sport, coach_id: coachId })
    .select("coach_id")
    .maybeSingle();
  if (ins.error) {
    // Race: another request inserted; re-read.
    const reread = await admin
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

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** `getParentSettings`: full settings snapshot for the parent. */
export async function getParentSettings(ctx: ParentSettingsContext): Promise<ParentSettingsDTO> {
  const { admin, userId } = ctx;
  const parent = await getParentProfile(admin, userId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accessibleAthleteIds = await guardianAthleteIdsSafe(admin as any, parent.id);
  const athletesRes = await admin
    .from("athletes")
    .select("id, first_name, last_name, birthdate, username, user_id, parent_id")
    .in("id", accessibleAthleteIds)
    .order("created_at", { ascending: true });
  if (athletesRes.error) dbError(athletesRes.error);
  const athletes = athletesRes.data ?? [];
  const athleteIds = athletes.map((a) => a.id);
  const safeIds = athleteIds.length ? athleteIds : ["00000000-0000-0000-0000-000000000000"];

  const [linksRes, sportsScopeRes, goalsRes, slotsRes, primaryRes, codesRes] = await Promise.all([
    admin
      .from("coach_athletes")
      .select("athlete_id, coach_id, created_at, coach_profiles!inner(first_name, last_name)")
      .in("athlete_id", safeIds)
      .order("created_at", { ascending: true }),
    admin
      .from("coach_athlete_sports")
      .select("athlete_id, coach_id, sport")
      .in("athlete_id", safeIds),
    admin
      .from("athlete_goals")
      .select("athlete_id, sport, current_level_key, season_goal_key, long_term_goal, coach_id")
      .in("athlete_id", safeIds),
    admin
      .from("athlete_lesson_slots")
      .select(
        "id, athlete_id, coach_id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on",
      )
      .in("athlete_id", safeIds),
    admin
      .from("athlete_primary_coaches")
      .select("athlete_id, sport, coach_id")
      .in("athlete_id", safeIds),
    admin.from("athlete_invite_codes").select("athlete_id, code").in("athlete_id", safeIds),
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
    // Only the primary parent mints invite codes; co-guardians just read them.
    if ((a as { parent_id: string | null }).parent_id !== parent.id) continue;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genCode(8);
      const ins = await admin
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
      const coaches: ParentSettingsCoachDTO[] = myLinks.map((l) => {
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

      const sports: ParentSettingsSportDTO[] = Array.from(sportSet)
        .sort()
        .map((sport) => {
          const eligibleCoaches = coaches
            .filter((c) => c.sports.includes(sport))
            .map((c) => ({ coachId: c.coachId, coachName: c.coachName }));
          const primaryCoachId = myPrimary.get(sport) ?? eligibleCoaches[0]?.coachId ?? null;
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

      const schedulesByCoach: ParentSettingsScheduleDTO[] = coaches.map((c) => {
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
}

/**
 * `updateParentProfile`: the parent's own name. With `apiContract`, a caller
 * without a parent profile is 403 `wrong_role` (the web layout already
 * guarantees one, so its update is never a no-op).
 */
export async function updateParentProfile(
  ctx: ParentSettingsContext,
  data: z.infer<typeof parentProfileInput>,
  opts: ApiContractOptions = {},
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  if (opts.apiContract) await getParentProfile(admin, userId);
  const upd = await admin
    .from("parent_profiles")
    .update({ first_name: data.firstName, last_name: data.lastName })
    .eq("user_id", userId);
  if (upd.error) dbError(upd.error);
  return { ok: true };
}

/** `updateAthlete`: name and birthdate of one of the parent's athletes. */
export async function updateParentAthlete(
  ctx: ParentSettingsContext,
  athleteId: string,
  data: z.infer<typeof parentAthleteInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  await assertOwnsAthlete(admin, userId, athleteId);
  const upd = await admin
    .from("athletes")
    .update({
      first_name: data.firstName,
      last_name: data.lastName,
      birthdate: data.birthdate,
    })
    .eq("id", athleteId);
  if (upd.error) dbError(upd.error);
  return { ok: true };
}

/** `updateAthleteGoals`: upsert the goal for (athlete, sport), stamped with the primary coach; seeds starter programs. */
export async function setParentAthleteGoals(
  ctx: ParentSettingsContext,
  athleteId: string,
  data: z.infer<typeof parentAthleteGoalsInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  await assertOwnsAthlete(admin, userId, athleteId);
  const coachId = await ensurePrimaryCoach(admin, athleteId, data.sport);
  if (!coachId) {
    throw unprocessable("Link a coach who teaches this sport before setting goals.");
  }
  const up = await admin.from("athlete_goals").upsert(
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

  await ensureStarterPrograms(athleteId, data.sport, data.currentLevelKey);

  return { ok: true };
}

/**
 * `previewCoachByInviteCode`: look up a coach by invite code so the parent
 * can pick which sports apply to their athlete before linking. Does not
 * mutate anything.
 */
export async function previewCoachByInviteCode(
  ctx: Pick<ParentSettingsContext, "admin">,
  code: string,
): Promise<CoachPreviewDTO> {
  const { admin } = ctx;
  const codeLookup = await admin
    .from("coach_invite_codes")
    .select("coach_id")
    .eq("code", code)
    .maybeSingle();
  if (codeLookup.error) dbError(codeLookup.error);
  if (!codeLookup.data) {
    throw notFound("That invite code isn't valid. Double-check with the coach.");
  }
  const coachId = codeLookup.data.coach_id;
  const [profile, levels] = await Promise.all([
    admin.from("coach_profiles").select("first_name, last_name").eq("id", coachId).single(),
    admin.from("coach_levels").select("sport").eq("coach_id", coachId),
  ]);
  if (profile.error) dbError(profile.error);
  const sports = Array.from(new Set((levels.data ?? []).map((l) => l.sport)));
  return {
    coachId,
    coachName: `${profile.data.first_name} ${profile.data.last_name}`.trim(),
    sports,
  };
}

/** `linkAthleteToCoach`: link an athlete to the coach behind an invite code, scoped to the chosen sports. */
export async function linkParentAthleteToCoach(
  ctx: ParentSettingsContext,
  athleteId: string,
  data: z.infer<typeof linkCoachInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  await assertOwnsAthlete(admin, userId, athleteId);

  const codeLookup = await admin
    .from("coach_invite_codes")
    .select("coach_id")
    .eq("code", data.code)
    .maybeSingle();
  if (codeLookup.error) dbError(codeLookup.error);
  if (!codeLookup.data) {
    throw notFound("That invite code isn't valid. Double-check with the coach.");
  }
  const coachId = codeLookup.data.coach_id;

  // Validate selected sports are actually offered by this coach
  const offered = await admin.from("coach_levels").select("sport").eq("coach_id", coachId);
  if (offered.error) dbError(offered.error);
  const offeredSet = new Set((offered.data ?? []).map((r) => r.sport));
  const chosen = Array.from(new Set(data.sports));
  for (const s of chosen) {
    if (!offeredSet.has(s)) throw unprocessable(`Coach doesn't offer ${s}.`);
  }

  const existing = await admin
    .from("coach_athletes")
    .select("id")
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (existing.error) dbError(existing.error);
  if (existing.data) {
    throw alreadyLinked("That coach is already linked to this athlete.");
  }

  const ins = await admin
    .from("coach_athletes")
    .insert({ athlete_id: athleteId, coach_id: coachId });
  if (ins.error) dbError(ins.error);

  const scopeRows = chosen.map((sport) => ({
    athlete_id: athleteId,
    coach_id: coachId,
    sport,
  }));
  const scopeIns = await admin.from("coach_athlete_sports").insert(scopeRows);
  if (scopeIns.error) dbError(scopeIns.error);

  return { ok: true };
}

/**
 * `updateCoachAthleteSports`: replace the set of sports an athlete does with
 * a coach. If a sport is removed and that coach was the primary for it,
 * clear the primary row.
 */
export async function setParentAthleteCoachSports(
  ctx: ParentSettingsContext,
  athleteId: string,
  coachId: string,
  data: z.infer<typeof coachSportsInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  await assertOwnsAthlete(admin, userId, athleteId);

  const link = await admin
    .from("coach_athletes")
    .select("id")
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId)
    .maybeSingle();
  if (link.error) dbError(link.error);
  if (!link.data) throw notFound("That coach isn't linked to this athlete.");

  const offered = await admin.from("coach_levels").select("sport").eq("coach_id", coachId);
  if (offered.error) dbError(offered.error);
  const offeredSet = new Set((offered.data ?? []).map((r) => r.sport));
  const chosen = Array.from(new Set(data.sports));
  for (const s of chosen) {
    if (!offeredSet.has(s)) throw unprocessable(`Coach doesn't offer ${s}.`);
  }

  const existing = await admin
    .from("coach_athlete_sports")
    .select("sport")
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId);
  if (existing.error) dbError(existing.error);
  const currentSet = new Set((existing.data ?? []).map((r) => r.sport));
  const chosenSet = new Set(chosen);

  const toAdd = chosen.filter((s) => !currentSet.has(s));
  const toRemove = Array.from(currentSet).filter((s) => !chosenSet.has(s));

  if (toAdd.length > 0) {
    const ins = await admin.from("coach_athlete_sports").insert(
      toAdd.map((sport) => ({
        athlete_id: athleteId,
        coach_id: coachId,
        sport,
      })),
    );
    if (ins.error) dbError(ins.error);
  }
  if (toRemove.length > 0) {
    const del = await admin
      .from("coach_athlete_sports")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", coachId)
      .in("sport", toRemove);
    if (del.error) dbError(del.error);

    // If this coach was primary for any removed sport, clear it so it can
    // re-resolve (or vanish if no other eligible coaches remain).
    await admin
      .from("athlete_primary_coaches")
      .delete()
      .eq("athlete_id", athleteId)
      .eq("coach_id", coachId)
      .in("sport", toRemove);
  }

  return { ok: true };
}

/** `unlinkAthleteFromCoach`: drop a coach and their coach-scoped data so a relink starts fresh. */
export async function unlinkParentAthleteFromCoach(
  ctx: ParentSettingsContext,
  athleteId: string,
  coachId: string,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  await assertOwnsAthlete(admin, userId, athleteId);

  // Clean up coach-scoped data so a relink starts fresh
  await admin
    .from("athlete_lesson_slots")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId);
  await admin
    .from("athlete_primary_coaches")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId);
  await admin.from("athlete_goals").delete().eq("athlete_id", athleteId).eq("coach_id", coachId);

  const del = await admin
    .from("coach_athletes")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("coach_id", coachId);
  if (del.error) dbError(del.error);
  return { ok: true };
}

/** `setPrimaryCoach`: the primary coach for (athlete, sport); the DB trigger enforces link + sport. */
export async function setParentPrimaryCoach(
  ctx: ParentSettingsContext,
  athleteId: string,
  data: z.infer<typeof primaryCoachInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  await assertOwnsAthlete(admin, userId, athleteId);
  // The DB trigger enforces that coach is linked to athlete and offers sport.
  const up = await admin
    .from("athlete_primary_coaches")
    .upsert(
      { athlete_id: athleteId, sport: data.sport, coach_id: data.coachId },
      { onConflict: "athlete_id,sport" },
    );
  if (up.error) dbError(up.error);

  // Re-stamp coach_id on any matching goal record so it tracks the current primary.
  await admin
    .from("athlete_goals")
    .update({ coach_id: data.coachId })
    .eq("athlete_id", athleteId)
    .eq("sport", data.sport);
  return { ok: true };
}

/** `replaceAthleteSchedule`: replace the athlete's lesson slots with one coach. */
export async function replaceParentAthleteSchedule(
  ctx: ParentSettingsContext,
  athleteId: string,
  data: z.infer<typeof parentScheduleInput>,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  await assertOwnsAthlete(admin, userId, athleteId);
  // Validate the coach is actually linked to this athlete
  const link = await admin
    .from("coach_athletes")
    .select("id")
    .eq("athlete_id", athleteId)
    .eq("coach_id", data.coachId)
    .maybeSingle();
  if (link.error) dbError(link.error);
  if (!link.data) throw notFound("That coach isn't linked to this athlete.");

  for (const s of data.slots) {
    if (s.endMinute <= s.startMinute) throw unprocessable("End time must be after start time.");
  }

  const del = await admin
    .from("athlete_lesson_slots")
    .delete()
    .eq("athlete_id", athleteId)
    .eq("coach_id", data.coachId);
  if (del.error) dbError(del.error);

  if (data.slots.length > 0) {
    const ins = await admin.from("athlete_lesson_slots").insert(
      data.slots.map((s) => ({
        athlete_id: athleteId,
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
}

/** `addAthlete`: a new athlete under the parent, with a best-effort invite code. */
export async function addParentAthlete(
  ctx: ParentSettingsContext,
  data: z.infer<typeof newParentAthleteInput>,
): Promise<{ ok: true; athleteId: string }> {
  const { admin, userId } = ctx;
  const parent = await getParentProfile(admin, userId);

  const ins = await admin
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
    const c = await admin.from("athlete_invite_codes").insert({
      parent_id: parent.id,
      athlete_id: ins.data.id,
      code,
      promo_code: parent.promo_code,
    });
    if (!c.error) break;
  }

  return { ok: true, athleteId: ins.data.id };
}

/** `removeAthlete`: delete one of the parent's athletes (never the last one) and their dependent rows. */
export async function removeParentAthlete(
  ctx: ParentSettingsContext,
  athleteId: string,
): Promise<{ ok: true }> {
  const { admin, userId } = ctx;
  await assertOwnsAthlete(admin, userId, athleteId);
  const parent = await getParentProfile(admin, userId);

  // Refuse to remove the only athlete
  const count = await admin
    .from("athletes")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", parent.id);
  if (count.error) dbError(count.error);
  if ((count.count ?? 0) <= 1) {
    throw unprocessable("You need at least one athlete on your account.");
  }

  // Delete dependents first in case FKs aren't cascading
  await admin.from("athlete_lesson_slots").delete().eq("athlete_id", athleteId);
  await admin.from("athlete_goals").delete().eq("athlete_id", athleteId);
  await admin.from("athlete_primary_coaches").delete().eq("athlete_id", athleteId);
  await admin.from("athlete_invite_codes").delete().eq("athlete_id", athleteId);
  await admin.from("coach_athletes").delete().eq("athlete_id", athleteId);

  const del = await admin.from("athletes").delete().eq("id", athleteId);
  if (del.error) dbError(del.error);
  return { ok: true };
}

/**
 * `resetAthletePassword`: reset (or set) the password for one of the
 * parent's athletes. Only works for athletes that have an account (user_id
 * is set); username-only athletes have no email-based recovery.
 *
 * Confirmed minors only: a self-managed athlete (their own login) or an
 * athlete who is 18 or older — or whose birthdate isn't on file, so age
 * can't be confirmed — is refused (403 `forbidden`) instead of having their
 * login taken over. This is a deliberate behavior change for the web too
 * (Mariah's call, 2026-09-07), not just the API: a parent-managed athlete
 * who has turned 18 still signs in with a synthetic email and has no
 * self-service recovery path, so they'll need another way to reset a
 * forgotten password (a support-assisted flow, or the athlete setting a
 * password before their birthday) — that gap is a known follow-up, not
 * solved here.
 */
export async function resetParentAthletePassword(
  ctx: ParentSettingsContext,
  athleteId: string,
  data: z.infer<typeof athletePasswordInput>,
): Promise<{ ok: true; username: string | null }> {
  const { admin, userId } = ctx;
  await assertOwnsAthlete(admin, userId, athleteId);
  const row = await admin
    .from("athletes")
    .select("user_id, username, birthdate, self_managed")
    .eq("id", athleteId)
    .single();
  if (row.error) dbError(row.error);
  if (!row.data.user_id) {
    throw unprocessable("This athlete hasn't created their account yet.");
  }
  const confirmedMinor =
    !row.data.self_managed && isMinorBirthdate(row.data.birthdate as string | null);
  if (!confirmedMinor) {
    throw forbidden("Only a minor athlete's password can be reset from here.");
  }
  const upd = await admin.auth.admin.updateUserById(row.data.user_id, {
    password: data.password,
  });
  if (upd.error) throw unprocessable(upd.error.message);
  return { ok: true, username: row.data.username as string | null };
}
