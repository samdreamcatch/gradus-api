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
  sessions: number;
  practiceMinutes: number;
  messagesFromAthleteOrParent: number;
}

export interface CoachAthleteDetailDTO {
  athleteId: string;
  firstName: string;
  lastName: string;
  parentFirstName: string;
  parentLastName: string;
  goals: AthleteGoalDTO[];
  plans: AthletePlanSummaryDTO[];
  activity: AthleteActivityCountsDTO;
  hasAnySignal: boolean;
  windowDays: number;
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

    const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();

    const [athleteRes, goalsRes, planRes, sessionsRes, roomRes] = await Promise.all([
      supabaseAdmin
        .from("athletes")
        .select(
          "id, first_name, last_name, parent_profiles!inner(first_name, last_name)",
        )
        .eq("id", data.athleteId)
        .single(),
      supabaseAdmin
        .from("athlete_goals")
        .select("sport, current_level_key, season_goal_key, long_term_goal")
        .eq("athlete_id", data.athleteId)
        .eq("coach_id", coachId),
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
    ]);
    if (athleteRes.error) dbError(athleteRes.error);
    if (goalsRes.error) dbError(goalsRes.error);
    if (planRes.error) dbError(planRes.error);
    if (sessionsRes.error) dbError(sessionsRes.error);
    if (roomRes.error) dbError(roomRes.error);

    const athlete = athleteRes.data as unknown as {
      first_name: string;
      last_name: string;
      parent_profiles: { first_name: string; last_name: string };
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
    const sessions30d = sessionsRes.data ?? [];
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
    const practiceMinutes = Math.round(
      sessions30d.reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0) / 60,
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

    const hasAnySignal = sessions30d.length > 0 || msgCount > 0;

    return {
      athleteId: data.athleteId,
      firstName: athlete.first_name,
      lastName: athlete.last_name,
      parentFirstName: athlete.parent_profiles.first_name,
      parentLastName: athlete.parent_profiles.last_name,
      goals,
      plans,
      activity: {
        sessions: sessions30d.length,
        practiceMinutes,
        messagesFromAthleteOrParent: msgCount,
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

    const [athleteRes, goalsRes, plansRes, sessionsRes, roomRes] = await Promise.all([
      supabaseAdmin
        .from("athletes")
        .select("first_name")
        .eq("id", data.athleteId)
        .single(),
      supabaseAdmin
        .from("athlete_goals")
        .select("sport, current_level_key, season_goal_key, long_term_goal")
        .eq("athlete_id", data.athleteId)
        .eq("coach_id", coachId),
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
        const note = (s.note ?? "").trim();
        const planMeta = s.plan_id ? planById.get(s.plan_id) : null;
        const planTag = planMeta ? ` plan="${planMeta.title}" (${planMeta.status})` : "";
        return `- ${date} (${who}, ${mins}m, "${state}"${planTag})${note ? `: ${note}` : ""}`;
      })
      .join("\n");

    const messageLines = messages
      .map((m) => {
        const date = new Date(m.created_at).toISOString().slice(0, 10);
        const body =
          m.kind === "voice"
            ? `[voice note, ${m.duration_seconds ?? 0}s]`
            : (m.body ?? "").slice(0, 280);
        return `- ${date} (${m.sender_role}): ${body}`;
      })
      .join("\n");

    const prompt = `You are summarizing the last ${WINDOW_DAYS} days for a coach about their athlete ${firstName}.

GOALS:
${goalLines || "- (no goals on file)"}

PLANS (active and benched):
${planLines || "- (no plans on file)"}

PRACTICE LOGS (most recent first; each tagged with the plan it was logged against):
${sessionLines || "- (none)"}

MESSAGES FROM ATHLETE OR PARENT (most recent first):
${messageLines || "- (none)"}

Write a 2-3 sentence summary that captures what ${firstName} has been working on across all of their plans (active and benched), how it's going, and any signal from messages. Call out specific plans by name when a pattern is clearly tied to one. Be specific — name moves, themes, or moods you actually see. Don't invent details.

Then decide a verdict:
- "increase": athlete is showing mastery, asking for more, or breezing through
- "hold": progress is steady; keep current challenge level
- "reduce": athlete is struggling, frustrated, missing sessions, or overwhelmed

Provide a single-sentence rationale tied to specific evidence above.`;

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
