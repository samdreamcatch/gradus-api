import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import type { CoachWeek } from "./club-coach-metrics";
import { addDays, toIso, weekStart } from "./club-lesson-calendar";
import {
  INSIGHT_IDS,
  INSIGHT_QUESTIONS,
  coachComparison,
  practiceVsTarget,
  sessionFeel,
  stuckStudents,
  type InsightId,
  type InsightInput,
  type InsightResult,
} from "./club-insights";

type InsightDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      org_coach_week_stats: { Row: CoachWeek & { organization_id: string }; Insert: never; Update: never; Relationships: [] };
    };
    Functions: Database["public"]["Functions"] & { refresh_club_coaching_metrics: { Args: { p_org: string }; Returns: undefined } };
  };
};

async function authorize(supabase: SupabaseClient<Database>, userId: string, organizationId: string) {
  const permission = await supabase.rpc("has_org_admin", { _user_id: userId, _org_id: organizationId });
  if (permission.error) dbError(permission.error);
  if (!permission.data) throw new Error("Not authorized for this club.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient<InsightDatabase>;
}

/** Every read is scoped to this club's coaches and their linked students. */
async function gather(admin: SupabaseClient<InsightDatabase>, orgId: string, since: string): Promise<InsightInput> {
  const latest = await admin.from("org_coach_week_stats").select("computed_at")
    .eq("organization_id", orgId).order("computed_at", { ascending: false }).limit(1);
  if (latest.error) dbError(latest.error);
  const last = latest.data?.[0]?.computed_at;
  if (!last || Date.now() - new Date(last).getTime() > 10 * 60_000) {
    const refresh = await admin.rpc("refresh_club_coaching_metrics", { p_org: orgId });
    if (refresh.error) dbError(refresh.error);
  }
  const [coaches, weeks] = await Promise.all([
    admin.from("coach_profiles").select("id,first_name,last_name").eq("organization_id", orgId),
    admin.from("org_coach_week_stats")
      .select("coach_id,week_start,students,minors,practice_min,target_min,sessions,students_meeting_target,lessons,computed_at")
      .eq("organization_id", orgId),
  ]);
  if (coaches.error) dbError(coaches.error);
  if (weeks.error) dbError(weeks.error);
  const ids = (coaches.data ?? []).map((c) => c.id);
  const empty: InsightInput = {
    coaches: (coaches.data ?? []).map((c) => ({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Coach" })),
    weeks: (weeks.data ?? []) as CoachWeek[],
    links: [], students: [], plans: [], sessions: [], skills: [],
  };
  if (!ids.length) return empty;
  const links = await admin.from("coach_athletes").select("coach_id,athlete_id").in("coach_id", ids);
  if (links.error) dbError(links.error);
  const athleteIds = [...new Set((links.data ?? []).map((l) => l.athlete_id))];
  if (!athleteIds.length) return { ...empty, links: links.data ?? [] };
  const [students, plans, skills] = await Promise.all([
    admin.from("athletes").select("id,first_name,last_name").in("id", athleteIds).eq("account_state", "active"),
    admin.from("plans").select("id,coach_id,athlete_id,status").eq("kind", "plan").in("coach_id", ids).in("athlete_id", athleteIds),
    admin.from("athlete_skill_events").select("athlete_id,coach_id,kind,occurred_at").in("athlete_id", athleteIds).gte("occurred_at", `${since}T00:00:00Z`),
  ]);
  for (const r of [students, plans, skills]) if (r.error) dbError(r.error);
  const planIds = (plans.data ?? []).map((p) => p.id);
  const sessions = planIds.length
    ? await admin.from("plan_sessions").select("plan_id,athlete_id,duration_seconds,state_index,logged_at")
        .in("plan_id", planIds).gte("logged_at", `${since}T00:00:00Z`)
    : { data: [], error: null };
  if (sessions.error) dbError(sessions.error);
  return {
    ...empty,
    links: links.data ?? [],
    students: (students.data ?? []).map((s) => ({ id: s.id, name: [s.first_name, s.last_name].filter(Boolean).join(" ") })),
    plans: plans.data ?? [],
    sessions: sessions.data ?? [],
    skills: skills.data ?? [],
  };
}

export const runClubInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ organizationId: z.string().uuid(), questionId: z.enum(INSIGHT_IDS) }).parse(input))
  .handler(async ({ data, context }): Promise<InsightResult> => {
    const admin = await authorize(context.supabase, context.userId, data.organizationId);
    const thisWeek = weekStart(toIso(new Date()));
    const lastWeek = addDays(thisWeek, -7);
    const four = [0, 1, 2, 3].map((i) => addDays(lastWeek, -7 * i));
    const since8 = addDays(thisWeek, -56);
    const since4 = addDays(thisWeek, -28);
    const input = await gather(admin, data.organizationId, since8);
    switch (data.questionId) {
      case "practice_vs_target": return practiceVsTarget(input, lastWeek);
      case "session_feel": return sessionFeel(input, `${since4}T00:00:00Z`);
      case "stuck_students": return stuckStudents(input, since8);
      case "coach_comparison": return coachComparison(input, four, since4);
    }
  });

/** Matches a typed question to one governed question. The model never sees club data. */
export const matchClubInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ organizationId: z.string().uuid(), question: z.string().trim().min(3).max(500) }).parse(input))
  .handler(async ({ data, context }): Promise<{ questionId: InsightId | null; reply: string }> => {
    await authorize(context.supabase, context.userId, data.organizationId);
    const { generateResponse, GatewayError } = await import("@lovable.dev/ai-gateway");
    const ids = [...INSIGHT_IDS, "none"];
    let text = "";
    try {
      const res = await generateResponse({
        model: "openai/gpt-6-astra",
        instructions: [
          "You route a sports club administrator's question to ONE report from a fixed list, or to none.",
          "Choose none if no report answers it. Never invent numbers or answers.",
          "reply: one short plain sentence. If none, say briefly what Insights can answer instead.",
          "REPORTS:",
          ...INSIGHT_QUESTIONS.map((q) => `- ${q.id}: ${q.prompt}`),
        ].join("\n"),
        input: data.question,
        text: {
          format: {
            type: "json_schema",
            name: "insight_match",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["questionId", "reply"],
              properties: { questionId: { type: "string", enum: ids }, reply: { type: "string" } },
            },
          },
        },
      });
      for (const item of res.output ?? []) {
        if (item.type !== "message") continue;
        for (const c of item.content) if (c.type === "output_text") text += c.text;
      }
    } catch (e) {
      if (e instanceof GatewayError) {
        console.error("insights match failed", e.code, e.ids);
        throw new Error("Insights couldn't read that question right now. Try one of the suggested questions.");
      }
      throw e;
    }
    const out = z.object({ questionId: z.enum([...INSIGHT_IDS, "none"]), reply: z.string() }).parse(JSON.parse(text));
    return { questionId: out.questionId === "none" ? null : out.questionId, reply: out.reply.slice(0, 300) };
  });
