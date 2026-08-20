import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateObject } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { PROMPT_INJECTION_GUARD, sanitizeUserContent, wrapUntrusted } from "./ai-prompt-safety";
import type { SessionsByState } from "@/components/plans/flow-state-bars";
import { STATE_LABELS } from "./session-states";

type Client = SupabaseClient<Database>;

// state_index → SessionsByState key. Must match parent feedback modal order.
const STATE_KEYS = [
  "frustrated",
  "pushing",
  "steady",
  "lockedIn",
  "flowing",
] as const satisfies readonly (keyof SessionsByState)[];

export function emptySessionsByState(): SessionsByState {
  return { frustrated: 0, pushing: 0, steady: 0, lockedIn: 0, flowing: 0 };
}

/**
 * Load real session counts for a set of plan ids. Works for both parents
 * and coaches: RLS on plan_sessions restricts what each role can read.
 */
export async function loadSessionsByPlanIds(
  supabase: Client,
  planIds: string[],
): Promise<Map<string, { sessionsByState: SessionsByState; sessionsTotal: number }>> {
  const map = new Map<string, { sessionsByState: SessionsByState; sessionsTotal: number }>();
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

/** Coach + parent detail: counts for a single plan. */
export const getPlanSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;
    const result = await loadSessionsByPlanIds(supabase, [data.planId]);
    const entry = result.get(data.planId) ?? {
      sessionsByState: emptySessionsByState(),
      sessionsTotal: 0,
    };
    return entry;
  });

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

/**
 * Coach + parent + athlete detail: the individual logged sessions for one
 * plan, with who logged each one. RLS scopes what each role can read.
 */
export const listPlanSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }): Promise<PlanSessionLogDTO> => {
    const supabase = context.supabase as Client;

    const { data: plan, error: pErr } = await supabase
      .from("plans")
      .select("id, athlete_id, athletes:athlete_id(first_name)")
      .eq("id", data.planId)
      .maybeSingle();
    if (pErr) dbError(pErr);

    const athleteFirstName =
      (plan as unknown as { athletes: { first_name: string } | null } | null)?.athletes
        ?.first_name ?? "Athlete";

    const empty: PlanSessionLogDTO = {
      sessions: [],
      athleteFirstName,
      loggedByAthlete: 0,
      loggedByParent: 0,
      total: 0,
    };
    if (!plan?.athlete_id) return empty;

    const { data: rows, error } = await supabase
      .from("plan_sessions")
      .select("id, logged_at, duration_seconds, state_index, note, parent_id")
      .eq("plan_id", data.planId)
      .eq("athlete_id", plan.athlete_id)
      .order("logged_at", { ascending: false })
      .limit(100);
    if (error) dbError(error);

    const sessionRows = rows ?? [];
    const parentIds = Array.from(
      new Set(sessionRows.map((r) => r.parent_id).filter((v): v is string => !!v)),
    );

    const parentNames = new Map<string, string>();
    if (parentIds.length > 0) {
      const { data: parents, error: ppErr } = await supabase
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
      loggedByFirstName: r.parent_id
        ? (parentNames.get(r.parent_id) ?? "Parent")
        : athleteFirstName,
    }));

    const loggedByParent = sessions.filter((s) => s.loggedByKind === "parent").length;
    return {
      sessions,
      athleteFirstName,
      loggedByAthlete: sessions.length - loggedByParent,
      loggedByParent,
      total: sessions.length,
    };
  });



/** Parent-only: submit a session from the feedback modal. */
export const submitPlanSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        stateIndex: z.number().int().min(0).max(4),
        note: z.string().max(2000).default(""),
        durationSeconds: z.number().int().min(0).max(86_400).default(0),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;

    // Look up plan → athlete; parent_id comes from the caller's parent_profile.
    const [{ data: plan, error: pErr }, { data: parent, error: ppErr }] = await Promise.all([
      supabase.from("plans").select("id, athlete_id").eq("id", data.planId).maybeSingle(),
      supabase.from("parent_profiles").select("id").eq("user_id", context.userId).maybeSingle(),
    ]);
    if (pErr) dbError(pErr);
    if (ppErr) dbError(ppErr);
    if (!plan?.athlete_id) throw new Error("Plan not found");
    if (!parent) throw new Error("Parent profile not found");

    const { error } = await supabase.from("plan_sessions").insert({
      plan_id: data.planId,
      athlete_id: plan.athlete_id,
      parent_id: parent.id,
      state_index: data.stateIndex,
      note: data.note,
      duration_seconds: data.durationSeconds,
    });
    if (error) dbError(error);
    return { ok: true as const };
  });

/** Athlete-only: submit a session for one of the signed-in athlete's plans. */
export const submitAthletePlanSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        stateIndex: z.number().int().min(0).max(4),
        note: z.string().max(2000).default(""),
        durationSeconds: z.number().int().min(0).max(86_400).default(0),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as Client;

    const [{ data: athlete, error: aErr }, { data: plan, error: pErr }] = await Promise.all([
      supabase.from("athletes").select("id").eq("user_id", context.userId).maybeSingle(),
      supabase.from("plans").select("id, athlete_id").eq("id", data.planId).maybeSingle(),
    ]);
    if (aErr) dbError(aErr);
    if (pErr) dbError(pErr);
    if (!athlete) throw new Error("Athlete profile not found");
    if (!plan || plan.athlete_id !== athlete.id) throw new Error("Plan not found");

    const { error } = await supabase.from("plan_sessions").insert({
      plan_id: data.planId,
      athlete_id: athlete.id,
      parent_id: null,
      state_index: data.stateIndex,
      note: data.note,
      duration_seconds: data.durationSeconds,
    });
    if (error) dbError(error);
    return { ok: true as const };
  });

// --- AI summary of logged sessions for a single plan ---

// Mood labels are shared with the admin drill-downs (src/lib/session-states.ts).

export interface PlanSessionsSummaryDTO {
  summary: string;
  generatedAt: string;
  empty: boolean;
  sessionsTotal: number;
}

export const getPlanSessionsSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }): Promise<PlanSessionsSummaryDTO> => {
    const supabase = context.supabase as Client;

    // Load plan + athlete (RLS limits this to plans the caller can read).
    const { data: plan, error: pErr } = await supabase
      .from("plans")
      .select("id, title, athlete_id, athletes:athlete_id(first_name)")
      .eq("id", data.planId)
      .maybeSingle();
    if (pErr) dbError(pErr);
    if (!plan) throw new Error("Plan not found");

    const athleteFirstName =
      (plan as unknown as { athletes: { first_name: string } | null }).athletes?.first_name ??
      "the athlete";

    const { data: rows, error } = await supabase
      .from("plan_sessions")
      .select("state_index, duration_seconds, note, logged_at, parent_id")
      .eq("plan_id", data.planId)
      .eq("athlete_id", plan.athlete_id!)
      .order("logged_at", { ascending: false })
      .limit(80);
    if (error) dbError(error);

    const sessions = rows ?? [];
    if (sessions.length === 0) {
      return {
        summary: `No sessions logged for this plan yet.`,
        generatedAt: new Date().toISOString(),
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

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      console.error("[plan-sessions] LOVABLE_API_KEY not set");
      throw new Error("AI service is unavailable. Please try again later.");
    }
    const gateway = createLovableAiGatewayProvider(apiKey);

    const schema = z.object({
      summary: z.string().min(1).max(600),
    });

    try {
      const { object } = await generateObject({
        model: gateway("google/gemini-2.5-flash"),
        schema,
        prompt,
      });
      return {
        summary: object.summary,
        generatedAt: new Date().toISOString(),
        empty: false,
        sessionsTotal: sessions.length,
      };
    } catch (err) {
      console.error("[plan sessions summary]", err);
      throw new Error("Could not generate summary. Please try again later.");
    }
  });
