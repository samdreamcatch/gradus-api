/**
 * Logged practice sessions on a plan (PRD §7.3 "practice log", §7.6):
 * per-state counts, the session log with who logged each one, the AI
 * summary, and submitting a session as a parent or an athlete. Single source
 * of truth for plan-sessions.functions.ts and `/api/v1/plans/{id}/sessions`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateObject } from "ai";
import type { Database } from "@/integrations/supabase/types";
import type { SessionsByState } from "@/components/plans/flow-state-bars";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { PROMPT_INJECTION_GUARD, sanitizeUserContent, wrapUntrusted } from "./ai-prompt-safety";
import { NAME_PLACEHOLDER_NOTE, type NameMask } from "./ai-names";
import { loadAthleteNameMask } from "./ai-names.server";
import { STATE_LABELS } from "./session-states";

type Client = SupabaseClient<Database>;

export type SessionsContext = { userId: string; supabase: Client; admin: Client };

// state_index → SessionsByState key. Must match parent feedback modal order.
const STATE_KEYS = [
  "frustrated",
  "pushing",
  "steady",
  "lockedIn",
  "flowing",
] as const satisfies readonly (keyof SessionsByState)[];

const notFound = (message: string) => new ApiError({ code: "not_found", status: 404, message });

export function emptySessionsByState(): SessionsByState {
  return { frustrated: 0, pushing: 0, steady: 0, lockedIn: 0, flowing: 0 };
}

export interface SessionCounts {
  sessionsByState: SessionsByState;
  sessionsTotal: number;
}

/**
 * Load real session counts for a set of plan ids. Works for both parents
 * and coaches: RLS on plan_sessions restricts what each role can read.
 */
export async function loadSessionsByPlanIds(
  supabase: Client,
  planIds: string[],
): Promise<Map<string, SessionCounts>> {
  const map = new Map<string, SessionCounts>();
  for (const id of planIds) {
    map.set(id, { sessionsByState: emptySessionsByState(), sessionsTotal: 0 });
  }
  if (planIds.length === 0) return map;

  // Fetch each plan's current athlete_id so we can exclude sessions left over
  // from a previous athlete after the plan was reassigned.
  const { data: plans, error: pErr } = await supabase
    .from("plans")
    .select("id, athlete_id")
    .in("id", planIds);
  if (pErr) dbError(pErr);
  const planAthlete = new Map<string, string | null>(
    (plans ?? []).map((p) => [p.id, p.athlete_id]),
  );

  const { data, error } = await supabase
    .from("plan_sessions")
    .select("plan_id, athlete_id, state_index")
    .in("plan_id", planIds);
  if (error) dbError(error);

  for (const row of data ?? []) {
    if (planAthlete.get(row.plan_id) !== row.athlete_id) continue;
    const entry = map.get(row.plan_id);
    if (!entry) continue;
    const key = STATE_KEYS[row.state_index];
    if (!key) continue;
    entry.sessionsByState[key] += 1;
    entry.sessionsTotal += 1;
  }
  return map;
}

/** Counts for a single plan (the flow-state bars). */
export async function getPlanSessionCounts(
  supabase: Client,
  planId: string,
): Promise<SessionCounts> {
  const result = await loadSessionsByPlanIds(supabase, [planId]);
  return result.get(planId) ?? { sessionsByState: emptySessionsByState(), sessionsTotal: 0 };
}

export interface PlanSessionEntry {
  id: string;
  loggedAt: string;
  durationSeconds: number;
  stateIndex: number;
  note: string;
  /** Who logged it. */
  loggedByKind: "parent" | "athlete";
  loggedByFirstName: string;
}

export interface PlanSessionLogDTO {
  sessions: PlanSessionEntry[];
  athleteFirstName: string;
  loggedByAthlete: number;
  loggedByParent: number;
  total: number;
}

export const listPlanSessionsQuery = z.object({
  /** Page size; the web reads the latest 100. */
  limit: z.coerce.number().int().min(1).max(200).default(100),
  /** Sessions logged strictly before this instant (ISO 8601), for the next page. */
  before: z.string().datetime({ offset: true }).optional(),
});

/**
 * The individual logged sessions for one plan, newest first, with who logged
 * each one. RLS scopes what each role can read; the logger's first name is
 * read with the admin client because profile visibility would hide
 * co-guardians from each other.
 */
export async function listPlanSessions(
  ctx: SessionsContext,
  planId: string,
  page: z.infer<typeof listPlanSessionsQuery> = { limit: 100 },
): Promise<PlanSessionLogDTO> {
  const supabase = ctx.supabase;

  const { data: plan, error: pErr } = await supabase
    .from("plans")
    .select("id, athlete_id, athletes:athlete_id(first_name)")
    .eq("id", planId)
    .maybeSingle();
  if (pErr) dbError(pErr);

  const athleteFirstName =
    (plan as unknown as { athletes: { first_name: string } | null } | null)?.athletes?.first_name ??
    "Athlete";

  const empty: PlanSessionLogDTO = {
    sessions: [],
    athleteFirstName,
    loggedByAthlete: 0,
    loggedByParent: 0,
    total: 0,
  };
  if (!plan?.athlete_id) return empty;

  let q = supabase
    .from("plan_sessions")
    .select("id, logged_at, duration_seconds, state_index, note, parent_id")
    .eq("plan_id", planId)
    .eq("athlete_id", plan.athlete_id)
    .order("logged_at", { ascending: false })
    .limit(page.limit);
  if (page.before) q = q.lt("logged_at", page.before);
  const { data: rows, error } = await q;
  if (error) dbError(error);

  const sessionRows = rows ?? [];
  const parentIds = Array.from(
    new Set(sessionRows.map((r) => r.parent_id).filter((v): v is string => !!v)),
  );

  const parentNames = new Map<string, string>();
  if (parentIds.length > 0) {
    // Profile visibility only lets a parent read their own row, so co-guardians and
    // athletes can't resolve the logger's name via RLS. Read just the first name of the
    // parents that already appear on this plan's authorized session rows.
    const { data: parents, error: ppErr } = await ctx.admin
      .from("parent_profiles")
      .select("id, first_name")
      .in("id", parentIds);
    if (ppErr) dbError(ppErr);
    for (const p of parents ?? []) parentNames.set(p.id, p.first_name);
  }

  const sessions: PlanSessionEntry[] = sessionRows.map((r) => ({
    id: r.id,
    loggedAt: r.logged_at,
    durationSeconds: r.duration_seconds ?? 0,
    stateIndex: r.state_index ?? 0,
    note: r.note ?? "",
    loggedByKind: r.parent_id ? "parent" : "athlete",
    loggedByFirstName: r.parent_id ? (parentNames.get(r.parent_id) ?? "Parent") : athleteFirstName,
  }));

  const loggedByParent = sessions.filter((s) => s.loggedByKind === "parent").length;
  return {
    sessions,
    athleteFirstName,
    loggedByAthlete: sessions.length - loggedByParent,
    loggedByParent,
    total: sessions.length,
  };
}

/* ---------------- submit ---------------- */

export const submitSessionInput = z.object({
  stateIndex: z.number().int().min(0).max(4),
  note: z.string().max(2000).default(""),
  durationSeconds: z.number().int().min(0).max(86_400).default(0),
});

/** Parent: log a session for the plan's athlete from the feedback modal. */
export async function submitPlanSessionAsParent(
  ctx: Pick<SessionsContext, "userId" | "supabase">,
  planId: string,
  data: z.infer<typeof submitSessionInput>,
): Promise<{ ok: true }> {
  const supabase = ctx.supabase;

  // Look up plan → athlete; parent_id comes from the caller's parent_profile.
  const [{ data: plan, error: pErr }, { data: parent, error: ppErr }] = await Promise.all([
    supabase.from("plans").select("id, athlete_id").eq("id", planId).maybeSingle(),
    supabase.from("parent_profiles").select("id").eq("user_id", ctx.userId).maybeSingle(),
  ]);
  if (pErr) dbError(pErr);
  if (ppErr) dbError(ppErr);
  if (!plan?.athlete_id) throw notFound("Plan not found");
  if (!parent) {
    throw new ApiError({ code: "wrong_role", status: 403, message: "Parent profile not found" });
  }

  const { error } = await supabase.from("plan_sessions").insert({
    plan_id: planId,
    athlete_id: plan.athlete_id,
    parent_id: parent.id,
    state_index: data.stateIndex,
    note: data.note,
    duration_seconds: data.durationSeconds,
  });
  if (error) dbError(error);
  return { ok: true };
}

/** Athlete: log a session for one of the signed-in athlete's own plans. */
export async function submitPlanSessionAsAthlete(
  ctx: Pick<SessionsContext, "userId" | "supabase">,
  planId: string,
  data: z.infer<typeof submitSessionInput>,
): Promise<{ ok: true }> {
  const supabase = ctx.supabase;

  const [{ data: athlete, error: aErr }, { data: plan, error: pErr }] = await Promise.all([
    supabase.from("athletes").select("id").eq("user_id", ctx.userId).maybeSingle(),
    supabase.from("plans").select("id, athlete_id").eq("id", planId).maybeSingle(),
  ]);
  if (aErr) dbError(aErr);
  if (pErr) dbError(pErr);
  if (!athlete) {
    throw new ApiError({ code: "wrong_role", status: 403, message: "Athlete profile not found" });
  }
  if (!plan || plan.athlete_id !== athlete.id) throw notFound("Plan not found");

  const { error } = await supabase.from("plan_sessions").insert({
    plan_id: planId,
    athlete_id: athlete.id,
    parent_id: null,
    state_index: data.stateIndex,
    note: data.note,
    duration_seconds: data.durationSeconds,
  });
  if (error) dbError(error);
  return { ok: true };
}

/** The API's role-aware submit: a parent logs for their athlete, an athlete for themselves. */
export async function submitPlanSession(
  ctx: Pick<SessionsContext, "userId" | "supabase">,
  planId: string,
  data: z.infer<typeof submitSessionInput>,
): Promise<{ ok: true; loggedAs: "parent" | "athlete" }> {
  const { data: parent, error } = await ctx.supabase
    .from("parent_profiles")
    .select("id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) dbError(error);
  if (parent) {
    await submitPlanSessionAsParent(ctx, planId, data);
    return { ok: true, loggedAs: "parent" };
  }
  await submitPlanSessionAsAthlete(ctx, planId, data);
  return { ok: true, loggedAs: "athlete" };
}

/* ---------------- AI summary ---------------- */

export interface PlanSessionsSummaryDTO {
  summary: string;
  generatedAt: string;
  empty: boolean;
  sessionsTotal: number;
}

export interface SummaryEnv {
  LOVABLE_API_KEY?: string;
}

/** A 2–3 sentence read of how the plan has been going, from the logged sessions. 503 `ai_unavailable` when the model is down. */
export async function getPlanSessionsSummary(
  ctx: Pick<SessionsContext, "supabase">,
  planId: string,
  env: SummaryEnv = process.env,
  now: Date = new Date(),
  /** Tests: the names kept out of the prompt (read with the service-role client by default). */
  loadMask: (athleteId: string) => Promise<NameMask> = async (athleteId) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadAthleteNameMask(supabaseAdmin, athleteId);
  },
): Promise<PlanSessionsSummaryDTO> {
  const supabase = ctx.supabase;

  // Load plan + athlete (RLS limits this to plans the caller can read).
  const { data: plan, error: pErr } = await supabase
    .from("plans")
    .select("id, title, athlete_id, athletes:athlete_id(first_name)")
    .eq("id", planId)
    .maybeSingle();
  if (pErr) dbError(pErr);
  if (!plan) throw notFound("Plan not found");

  const athleteFirstName =
    (plan as unknown as { athletes: { first_name: string } | null }).athletes?.first_name ??
    "the athlete";

  const { data: rows, error } = await supabase
    .from("plan_sessions")
    .select("state_index, duration_seconds, note, logged_at, parent_id")
    .eq("plan_id", planId)
    .eq("athlete_id", plan.athlete_id!)
    .order("logged_at", { ascending: false })
    .limit(80);
  if (error) dbError(error);

  const sessions = rows ?? [];
  if (sessions.length === 0) {
    return {
      summary: `No sessions logged for this plan yet.`,
      generatedAt: now.toISOString(),
      empty: true,
      sessionsTotal: 0,
    };
  }

  const sessionLines = sessions
    .map((s) => {
      const date = new Date(s.logged_at).toISOString().slice(0, 10);
      const mins = Math.round((s.duration_seconds ?? 0) / 60);
      const state = STATE_LABELS[Math.max(0, Math.min(4, s.state_index ?? 0))];
      const who = s.parent_id ? "parent-logged" : "athlete-logged";
      const note = sanitizeUserContent(s.note, 400);
      const noteBlock = note ? `: ${wrapUntrusted("session_note", note)}` : "";
      return `- ${date} (${who}, ${mins}m, "${state}")${noteBlock}`;
    })
    .join("\n");

  const safeTitle = sanitizeUserContent(plan.title || "Untitled plan", 120);
  const safeName = sanitizeUserContent(athleteFirstName, 80);

  const prompt = `${PROMPT_INJECTION_GUARD}

You are summarizing the logged sessions for one practice plan titled "${safeTitle}" by ${safeName}.

LOGGED SESSIONS (most recent first):
${sessionLines}

Write a concise 2-3 sentence summary that captures how it's been going on this plan: overall mood/flow trend, total volume, and any specific themes from the notes. Be specific — reference moods, moves, or notes you actually see. Don't invent details. Address ${athleteFirstName} in the third person.`;

  const apiKey = env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.error("[plan-sessions] LOVABLE_API_KEY not set");
    throw new ApiError({
      code: "ai_unavailable",
      status: 503,
      message: "AI service is unavailable. Please try again later.",
    });
  }
  const gateway = createLovableAiGatewayProvider(apiKey);

  const schema = z.object({
    summary: z.string().min(1).max(600),
  });

  // No names reach the model: the athlete's, their parents' (src/lib/ai-names.ts).
  const names = await loadMask(plan.athlete_id!);

  try {
    const { object } = await generateObject({
      model: gateway("google/gemini-2.5-flash"),
      schema,
      prompt: `${names.mask(prompt)}\n\n${NAME_PLACEHOLDER_NOTE}`,
    });
    return {
      summary: names.unmask(object.summary),
      generatedAt: new Date().toISOString(),
      empty: false,
      sessionsTotal: sessions.length,
    };
  } catch (err) {
    console.error("[plan sessions summary]", err);
    throw new ApiError({
      code: "ai_unavailable",
      status: 503,
      message: "Could not generate summary. Please try again later.",
    });
  }
}
