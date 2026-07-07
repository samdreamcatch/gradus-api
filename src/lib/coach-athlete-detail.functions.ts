import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateObject } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { dbError } from "./db-error";
import { getSportLevel, getSport } from "./coach-sports";
import {
  PROMPT_INJECTION_GUARD,
  sanitizeUserContent,
  wrapUntrusted,
} from "./ai-prompt-safety";
import type { SessionsByState } from "@/components/plans/flow-state-bars";

const ATHLETE_SUMMARY_SYSTEM = `You are a factual reporting assistant for a sports coaching platform. Your only job is to report what is explicitly present in the data you receive. Do not infer, speculate, or add encouraging language that isn't backed by a specific data point in the context. If evidence is thin, acknowledge it — do not pad the summary with generic observations. A shorter, accurate output is always better than a longer, embellished one.`;

const WINDOW_DAYS = 30;

export interface AthleteGoalDTO {
  sport: string;
  sportLabel: string;
  currentLevelLabel: string;
  seasonGoalLabel: string;
  longTermGoal: string;
}

export type PlanStatus = "active" | "benched";

export interface AthletePlanSummaryDTO {
  planId: string;
  title: string;
  status: PlanStatus;
  sessionsByState: SessionsByState;
  sessionsTotal: number;
}

export interface AthleteActivityCountsDTO {
  practiceMinutesMine: number;
  practiceMinutesTotal: number;
  lessonMinutesTotal: number;
}

export interface CoachedSportDTO {
  key: string;
  label: string;
}

export interface CoachAthleteDetailDTO {
  athleteId: string;
  firstName: string;
  lastName: string;
  // Null for self-managed adult athletes.
  parentFirstName: string | null;
  parentLastName: string | null;
  selfManaged: boolean;
  coachedSports: CoachedSportDTO[];
  goals: AthleteGoalDTO[];
  plans: AthletePlanSummaryDTO[];
  activity: AthleteActivityCountsDTO;
  hasAnySignal: boolean;
  windowDays: number;
}


type SlotRow = {
  id: string;
  day_of_week: number;
  start_minute: number;
  end_minute: number;
  frequency: string;
  weeks_of_month: number[];
  starts_on: string | null;
};

type OverrideRow = {
  slot_id: string;
  occurrence_date: string;
  status: string;
  start_minute: number | null;
  end_minute: number | null;
};

// Returns true if a slot fires on the given UTC date based on its
// frequency / weeks_of_month / starts_on configuration. day_of_week match
// is the caller's responsibility (we filter slots by weekday before calling).
function slotFiresOn(slot: SlotRow, date: Date): boolean {
  if (slot.starts_on) {
    const startsOn = new Date(`${slot.starts_on}T00:00:00Z`);
    if (date < startsOn) return false;
  }
  if (slot.frequency === "weekly") return true;
  if (slot.frequency === "biweekly") {
    // Even/odd ISO week alternation anchored at epoch.
    const epochWeek = Math.floor(date.getTime() / (7 * 86400_000));
    return epochWeek % 2 === 0;
  }
  // "twice_monthly" and "monthly" both use weeks_of_month: which Nth
  // occurrence of this weekday in the month the slot fires on.
  if (slot.frequency === "twice_monthly" || slot.frequency === "monthly") {
    const dayOfMonth = date.getUTCDate();
    const nth = Math.floor((dayOfMonth - 1) / 7) + 1;
    return slot.weeks_of_month.includes(nth);
  }
  return false;
}

function computeLessonMinutes(
  slots: SlotRow[],
  overridesBySlot: Map<string, OverrideRow[]>,
  windowStart: Date,
  windowEnd: Date,
): number {
  let total = 0;
  // Iterate day-by-day over the window, then slots that match that weekday.
  const slotsByWeekday = new Map<number, SlotRow[]>();
  for (const s of slots) {
    const arr = slotsByWeekday.get(s.day_of_week) ?? [];
    arr.push(s);
    slotsByWeekday.set(s.day_of_week, arr);
  }
  const cursor = new Date(Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth(),
    windowStart.getUTCDate(),
  ));
  const end = new Date(Date.UTC(
    windowEnd.getUTCFullYear(),
    windowEnd.getUTCMonth(),
    windowEnd.getUTCDate(),
  ));
  while (cursor <= end) {
    const weekday = cursor.getUTCDay();
    const todays = slotsByWeekday.get(weekday) ?? [];
    const dateStr = cursor.toISOString().slice(0, 10);
    for (const slot of todays) {
      if (!slotFiresOn(slot, cursor)) continue;
      const override = (overridesBySlot.get(slot.id) ?? []).find(
        (o) => o.occurrence_date === dateStr,
      );
      if (override?.status === "canceled") continue;
      const startM = override?.start_minute ?? slot.start_minute;
      const endM = override?.end_minute ?? slot.end_minute;
      total += Math.max(0, endM - startM);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}


async function getAdmin() {
  const m = await import("@/integrations/supabase/client.server");
  return m.supabaseAdmin;
}

async function getCoachId(userId: string): Promise<string | null> {
  const supabaseAdmin = await getAdmin();
  const { data, error } = await supabaseAdmin
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  return data?.id ?? null;
}

async function assertCoachOwnsAthlete(coachId: string, athleteId: string) {
  const supabaseAdmin = await getAdmin();
  const { data, error } = await supabaseAdmin
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new Error("Athlete is not on your roster");
}

// Sports this coach offers for this athlete — drives which goals/data the
// coach is allowed to see. Goals are owned by the parent (one row per
// athlete+sport); coach_id on athlete_goals is just bookkeeping for the
// first coach who claimed the invite and MUST NOT be used to gate
// visibility for other coaches who also offer that sport.
async function getCoachAthleteSports(coachId: string, athleteId: string): Promise<string[]> {
  const supabaseAdmin = await getAdmin();
  const { data, error } = await supabaseAdmin
    .from("coach_athlete_sports")
    .select("sport")
    .eq("coach_id", coachId)
    .eq("athlete_id", athleteId);
  if (error) dbError(error);
  return Array.from(new Set((data ?? []).map((r) => r.sport)));
}


function labelLevel(sport: string, levelKey: string): string {
  return getSportLevel(sport, levelKey)?.label ?? levelKey;
}

function sportLabel(sport: string): string {
  return getSport(sport)?.label ?? sport;
}

export const getCoachAthleteDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ athleteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<CoachAthleteDetailDTO> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const coachId = await getCoachId(context.userId);
    if (!coachId) throw new Error("Coach profile not found");
    await assertCoachOwnsAthlete(coachId, data.athleteId);

    const windowStart = new Date(Date.now() - WINDOW_DAYS * 86400_000);
    const since = windowStart.toISOString();

    const coachSports = await getCoachAthleteSports(coachId, data.athleteId);

    const [athleteRes, goalsRes, planRes, sessionsRes, roomRes, slotsRes] = await Promise.all([
      supabaseAdmin
        .from("athletes")
        .select(
          "id, first_name, last_name, self_managed, parent_profiles(first_name, last_name)",
        )
        .eq("id", data.athleteId)
        .single(),
      coachSports.length === 0
        ? Promise.resolve({ data: [], error: null } as const)
        : supabaseAdmin
            .from("athlete_goals")
            .select("sport, current_level_key, season_goal_key, long_term_goal")
            .eq("athlete_id", data.athleteId)
            .in("sport", coachSports),
      supabaseAdmin
        .from("plans")
        .select("id, title, status, updated_at")
        .eq("coach_id", coachId)
        .eq("athlete_id", data.athleteId)
        .eq("kind", "plan")
        .in("status", ["active", "benched"])
        .order("status", { ascending: true }) // active < benched alphabetically
        .order("updated_at", { ascending: false }),
      supabaseAdmin
        .from("plan_sessions")
        .select("plan_id, state_index, duration_seconds, logged_at, parent_id")
        .eq("athlete_id", data.athleteId)
        .gte("logged_at", since),
      supabaseAdmin
        .from("message_rooms")
        .select("id")
        .eq("coach_id", coachId)
        .eq("athlete_id", data.athleteId)
        .maybeSingle(),
      // All lesson slots for this athlete across every coach — load
      // balancing view. Caller is already authorized via assertCoachOwnsAthlete.
      supabaseAdmin
        .from("athlete_lesson_slots")
        .select("id, day_of_week, start_minute, end_minute, frequency, weeks_of_month, starts_on")
        .eq("athlete_id", data.athleteId),
    ]);
    if (athleteRes.error) dbError(athleteRes.error);
    if (goalsRes.error) dbError(goalsRes.error);
    if (planRes.error) dbError(planRes.error);
    if (sessionsRes.error) dbError(sessionsRes.error);
    if (roomRes.error) dbError(roomRes.error);
    if (slotsRes.error) dbError(slotsRes.error);

    const athlete = athleteRes.data as unknown as {
      first_name: string;
      last_name: string;
      self_managed: boolean | null;
      parent_profiles: { first_name: string; last_name: string } | null;
    };


    const goals: AthleteGoalDTO[] = (goalsRes.data ?? []).map((g) => ({
      sport: g.sport,
      sportLabel: sportLabel(g.sport),
      currentLevelLabel: labelLevel(g.sport, g.current_level_key),
      seasonGoalLabel: labelLevel(g.sport, g.season_goal_key),
      longTermGoal: g.long_term_goal ?? "",
    }));

    // Build per-plan summaries for every active OR benched plan.
    const stateKeys: (keyof SessionsByState)[] = [
      "frustrated",
      "pushing",
      "steady",
      "lockedIn",
      "flowing",
    ];
    type SessionRow = {
      plan_id: string;
      state_index: number | null;
      duration_seconds: number | null;
      logged_at: string;
      parent_id: string | null;
    };
    const sessions30d = (sessionsRes.data ?? []) as SessionRow[];

    // Map plan_id -> coach_id for every plan referenced by these sessions,
    // so we can attribute practice to "mine" vs other coaches'.
    const planIds = Array.from(new Set(sessions30d.map((s) => s.plan_id)));
    const planCoachMap = new Map<string, string>();
    if (planIds.length > 0) {
      const planCoachRes = await supabaseAdmin
        .from("plans")
        .select("id, coach_id")
        .in("id", planIds);
      if (planCoachRes.error) dbError(planCoachRes.error);
      for (const p of planCoachRes.data ?? []) {
        planCoachMap.set(p.id as string, p.coach_id as string);
      }
    }
    const plans: AthletePlanSummaryDTO[] = (planRes.data ?? []).map((p) => {
      const planSessions = sessions30d.filter((s) => s.plan_id === p.id);
      const sessionsByState: SessionsByState = {
        frustrated: 0,
        pushing: 0,
        steady: 0,
        lockedIn: 0,
        flowing: 0,
      };
      for (const s of planSessions) {
        const idx = Math.max(0, Math.min(4, s.state_index ?? 0));
        sessionsByState[stateKeys[idx]] += 1;
      }
      return {
        planId: p.id,
        title: p.title || "Untitled plan",
        status: p.status as PlanStatus,
        sessionsByState,
        sessionsTotal: planSessions.length,
      };
    });

    const practiceSecondsTotal = sessions30d.reduce(
      (sum, s) => sum + (s.duration_seconds ?? 0),
      0,
    );
    const practiceSecondsMine = sessions30d
      .filter((s) => planCoachMap.get(s.plan_id) === coachId)
      .reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0);
    const practiceMinutesTotal = Math.round(practiceSecondsTotal / 60);
    const practiceMinutesMine = Math.round(practiceSecondsMine / 60);

    // Lesson minutes across all coaches in the window.
    const slots = (slotsRes.data ?? []) as SlotRow[];
    const slotIds = slots.map((s) => s.id);
    let overridesBySlot = new Map<string, OverrideRow[]>();
    if (slotIds.length > 0) {
      const overridesRes = await supabaseAdmin
        .from("lesson_slot_overrides")
        .select("slot_id, occurrence_date, status, start_minute, end_minute")
        .in("slot_id", slotIds)
        .gte("occurrence_date", windowStart.toISOString().slice(0, 10));
      if (overridesRes.error) dbError(overridesRes.error);
      for (const o of (overridesRes.data ?? []) as OverrideRow[]) {
        const arr = overridesBySlot.get(o.slot_id) ?? [];
        arr.push(o);
        overridesBySlot.set(o.slot_id, arr);
      }
    }
    const lessonMinutesTotal = computeLessonMinutes(
      slots,
      overridesBySlot,
      windowStart,
      new Date(),
    );

    let msgCount = 0;
    if (roomRes.data) {
      const msgRes = await supabaseAdmin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("room_id", roomRes.data.id)
        .in("sender_role", ["athlete", "parent"])
        .gte("created_at", since);
      if (msgRes.error) dbError(msgRes.error);
      msgCount = msgRes.count ?? 0;
    }

    // Messages still feed the AI summary; gate auto-run on either signal.
    const hasAnySignal = sessions30d.length > 0 || msgCount > 0;

    return {
      athleteId: data.athleteId,
      firstName: athlete.first_name,
      lastName: athlete.last_name,
      parentFirstName: athlete.parent_profiles?.first_name ?? null,
      parentLastName: athlete.parent_profiles?.last_name ?? null,
      selfManaged: athlete.self_managed === true,
      goals,

      plans,
      activity: {
        practiceMinutesMine,
        practiceMinutesTotal,
        lessonMinutesTotal,
      },
      hasAnySignal,
      windowDays: WINDOW_DAYS,
    };
  });


// --- AI summary ---

export type Verdict = "increase" | "hold" | "reduce";

export interface CoachAthleteAiSummaryDTO {
  summary: string;
  verdict: Verdict;
  rationale: string;
  generatedAt: string;
  empty: boolean;
}

const STATE_LABELS = ["Just learning", "Getting it", "Comfortable", "Flowing", "Mastered"];

export const getCoachAthleteAiSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ athleteId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<CoachAthleteAiSummaryDTO> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const coachId = await getCoachId(context.userId);
    if (!coachId) throw new Error("Coach profile not found");
    await assertCoachOwnsAthlete(coachId, data.athleteId);

    const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

    const coachSports = await getCoachAthleteSports(coachId, data.athleteId);

    const [athleteRes, goalsRes, plansRes, sessionsRes, roomRes] = await Promise.all([
      supabaseAdmin
        .from("athletes")
        .select("first_name")
        .eq("id", data.athleteId)
        .single(),
      coachSports.length === 0
        ? Promise.resolve({ data: [], error: null } as const)
        : supabaseAdmin
            .from("athlete_goals")
            .select("sport, current_level_key, season_goal_key, long_term_goal")
            .eq("athlete_id", data.athleteId)
            .in("sport", coachSports),
      supabaseAdmin
        .from("plans")
        .select("id, title, status")
        .eq("coach_id", coachId)
        .eq("athlete_id", data.athleteId)
        .eq("kind", "plan")
        .in("status", ["active", "benched"]),
      supabaseAdmin
        .from("plan_sessions")
        .select("plan_id, state_index, duration_seconds, note, logged_at, parent_id")
        .eq("athlete_id", data.athleteId)
        .gte("logged_at", since)
        .order("logged_at", { ascending: false })
        .limit(60),
      supabaseAdmin
        .from("message_rooms")
        .select("id")
        .eq("coach_id", coachId)
        .eq("athlete_id", data.athleteId)
        .maybeSingle(),
    ]);
    if (athleteRes.error) dbError(athleteRes.error);
    if (goalsRes.error) dbError(goalsRes.error);
    if (plansRes.error) dbError(plansRes.error);
    if (sessionsRes.error) dbError(sessionsRes.error);
    if (roomRes.error) dbError(roomRes.error);

    const firstName = athleteRes.data?.first_name ?? "the athlete";
    const sessions = sessionsRes.data ?? [];
    const planById = new Map<string, { title: string; status: string }>();
    for (const p of plansRes.data ?? []) {
      planById.set(p.id, { title: p.title || "Untitled plan", status: p.status });
    }

    type MsgRow = { sender_role: string; kind: string; body: string; duration_seconds: number | null; created_at: string };
    let messages: MsgRow[] = [];
    if (roomRes.data) {
      const mRes = await supabaseAdmin
        .from("messages")
        .select("sender_role, kind, body, duration_seconds, created_at")
        .eq("room_id", roomRes.data.id)
        .in("sender_role", ["athlete", "parent"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(60);
      if (mRes.error) dbError(mRes.error);
      messages = (mRes.data ?? []) as MsgRow[];
    }

    if (sessions.length === 0 && messages.length === 0) {
      return {
        summary: `No practice logs or messages from ${firstName} or their parent in the last ${WINDOW_DAYS} days.`,
        verdict: "hold",
        rationale: "Not enough recent activity to recommend a change.",
        generatedAt: new Date().toISOString(),
        empty: true,
      };
    }

    const goalLines = (goalsRes.data ?? [])
      .map((g) => {
        const sport = sportLabel(g.sport);
        const cur = labelLevel(g.sport, g.current_level_key);
        const tgt = labelLevel(g.sport, g.season_goal_key);
        const long = g.long_term_goal ? ` Long-term: ${g.long_term_goal}.` : "";
        return `- ${sport}: at ${cur}, season goal ${tgt}.${long}`;
      })
      .join("\n");

    const planLines = (plansRes.data ?? [])
      .map((p) => `- "${p.title || "Untitled plan"}" (${p.status})`)
      .join("\n");

    const sessionLines = sessions
      .map((s) => {
        const date = new Date(s.logged_at).toISOString().slice(0, 10);
        const mins = Math.round((s.duration_seconds ?? 0) / 60);
        const state = STATE_LABELS[Math.max(0, Math.min(4, s.state_index ?? 0))];
        const who = s.parent_id ? "parent-logged" : "athlete-logged";
        const note = sanitizeUserContent(s.note, 400);
        const planMeta = s.plan_id ? planById.get(s.plan_id) : null;
        const planTag = planMeta
          ? ` plan="${sanitizeUserContent(planMeta.title, 120)}" (${planMeta.status})`
          : "";
        const noteBlock = note ? `: ${wrapUntrusted("session_note", note)}` : "";
        return `- ${date} (${who}, ${mins}m, "${state}"${planTag})${noteBlock}`;
      })
      .join("\n");

    const messageLines = messages
      .map((m) => {
        const date = new Date(m.created_at).toISOString().slice(0, 10);
        const body =
          m.kind === "voice"
            ? `[voice note, ${m.duration_seconds ?? 0}s]`
            : wrapUntrusted("message_body", sanitizeUserContent(m.body, 280));
        return `- ${date} (${m.sender_role}): ${body}`;
      })
      .join("\n");

    const safeName = sanitizeUserContent(firstName, 80);

    const prompt = `${PROMPT_INJECTION_GUARD}

You are summarizing the last ${WINDOW_DAYS} days for a coach about their athlete ${safeName}.

GOALS:
${goalLines || "- (no goals on file)"}

PLANS (active and benched):
${planLines || "- (no plans on file)"}

PRACTICE LOGS (most recent first; each tagged with the plan it was logged against):
${sessionLines || "- (none)"}

MESSAGES FROM ATHLETE OR PARENT (most recent first):
${messageLines || "- (none)"}

Write a 2–3 sentence summary of what ${safeName} has been doing based strictly on the data above. Reference only plans, flow states, session notes, and messages that appear explicitly in the context. Do not use hedging language ("appears to," "seems like") as cover for inference — if you cannot point to a specific data entry, do not include it. If data is sparse, write fewer sentences and say so plainly rather than filling in gaps.

Then decide a verdict:
- "increase": athlete is clearly showing mastery, explicitly asking for more, or consistently breezing through sessions — you must be able to cite a specific session note or message that supports this
- "hold": progress is steady, or evidence is insufficient to recommend a change — when in doubt, use hold
- "reduce": athlete is clearly struggling, frustrated, missing sessions, or overwhelmed — you must be able to cite a specific session note, flow state, or message that supports this

Provide a single-sentence rationale that cites a specific data point (a session note, flow state label, or message). If you cannot cite specific evidence, default to "hold" and state that the data is insufficient to make a stronger call.`;

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(apiKey);

    const schema = z.object({
      summary: z.string().min(1).max(600),
      verdict: z.enum(["increase", "hold", "reduce"]),
      rationale: z.string().min(1).max(280),
    });

    try {
      const { object } = await generateObject({
        model: gateway("google/gemini-2.5-flash"),
        system: ATHLETE_SUMMARY_SYSTEM,
        schema,
        prompt,
      });
      return {
        summary: object.summary,
        verdict: object.verdict,
        rationale: object.rationale,
        generatedAt: new Date().toISOString(),
        empty: false,
      };
    } catch (err) {
      console.error("[AI summary]", err);
      throw new Error("Could not generate summary. Please try again later.");
    }
  });
