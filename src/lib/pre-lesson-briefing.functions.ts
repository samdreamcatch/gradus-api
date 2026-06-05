import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { createHash } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { dbError } from "./db-error";

export type PreLessonBriefing = {
  narrative: string;
  generatedAt: string;
  fromCache: boolean;
};

type Input = {
  athleteId: string;
  lessonDate: string; // YYYY-MM-DD
  refresh?: boolean;
};

function stableHash(obj: unknown): string {
  const json = JSON.stringify(obj, Object.keys(obj as object).sort());
  return createHash("sha256").update(json).digest("hex").slice(0, 32);
}

export const getPreLessonBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Input) => {
    if (!data?.athleteId || !data?.lessonDate) {
      throw new Error("athleteId and lessonDate are required");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.lessonDate)) {
      throw new Error("lessonDate must be YYYY-MM-DD");
    }
    return { athleteId: data.athleteId, lessonDate: data.lessonDate, refresh: !!data.refresh };
  })
  .handler(async ({ data, context }): Promise<PreLessonBriefing> => {
    // 1) Resolve coach
    const coachRes = await supabaseAdmin
      .from("coach_profiles")
      .select("id, first_name, last_name")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (coachRes.error) dbError(coachRes.error);
    if (!coachRes.data) throw new Error("Coach profile not found");
    const coachId = coachRes.data.id as string;
    const coachName = `${coachRes.data.first_name ?? ""} ${coachRes.data.last_name ?? ""}`.trim() || "Coach";

    // 2) Confirm coach-athlete link
    const link = await supabaseAdmin
      .from("coach_athletes")
      .select("athlete_id")
      .eq("coach_id", coachId)
      .eq("athlete_id", data.athleteId)
      .maybeSingle();
    if (link.error) dbError(link.error);
    if (!link.data) throw new Error("Athlete is not on your roster");

    // 3) Find previous lesson date (most recent wrap-up before this lesson_date)
    const prevWrap = await supabaseAdmin
      .from("lesson_wrap_ups")
      .select("lesson_date")
      .eq("coach_id", coachId)
      .eq("athlete_id", data.athleteId)
      .lt("lesson_date", data.lessonDate)
      .order("lesson_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sinceDate = prevWrap.data?.lesson_date
      ? new Date(prevWrap.data.lesson_date as string)
      : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const sinceIso = sinceDate.toISOString();

    // 4) Athlete name
    const athlete = await supabaseAdmin
      .from("athletes")
      .select("first_name, last_name")
      .eq("id", data.athleteId)
      .maybeSingle();
    const athleteFirstName = (athlete.data?.first_name as string) || "the athlete";

    // 5) This coach's active plan + plan_moves updated since last lesson
    const myPlan = await supabaseAdmin
      .from("plans")
      .select("id, title, status, updated_at")
      .eq("coach_id", coachId)
      .eq("athlete_id", data.athleteId)
      .eq("kind", "plan")
      .eq("status", "active")
      .maybeSingle();

    let myPlanMoves: Array<{ name: string; created_at: string }> = [];
    if (myPlan.data?.id) {
      const pm = await supabaseAdmin
        .from("plan_moves")
        .select("name, created_at")
        .eq("plan_id", myPlan.data.id as string)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(10);
      myPlanMoves = (pm.data ?? []) as typeof myPlanMoves;
    }

    // 6) Other coaches linked to this athlete and their active plans
    const otherLinks = await supabaseAdmin
      .from("coach_athletes")
      .select("coach_id")
      .eq("athlete_id", data.athleteId)
      .neq("coach_id", coachId);
    const otherCoachIds = (otherLinks.data ?? []).map((r) => r.coach_id as string);

    let otherPlans: Array<{ title: string; status: string; updated_at: string; coachName: string }> = [];
    if (otherCoachIds.length > 0) {
      const op = await supabaseAdmin
        .from("plans")
        .select("title, status, updated_at, coach_id")
        .eq("athlete_id", data.athleteId)
        .eq("kind", "plan")
        .eq("status", "active")
        .in("coach_id", otherCoachIds);
      const otherCoaches = await supabaseAdmin
        .from("coach_profiles")
        .select("id, first_name, last_name")
        .in("id", otherCoachIds);
      const nameById = new Map<string, string>();
      for (const c of otherCoaches.data ?? []) {
        nameById.set(
          c.id as string,
          `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "another coach",
        );
      }
      otherPlans = (op.data ?? []).map((p) => ({
        title: (p.title as string) ?? "Untitled plan",
        status: p.status as string,
        updated_at: p.updated_at as string,
        coachName: nameById.get(p.coach_id as string) ?? "another coach",
      }));
    }

    // 7) Practice logs across all coaches since last lesson
    const allCoachIds = [coachId, ...otherCoachIds];
    const allPlansRes = await supabaseAdmin
      .from("plans")
      .select("id, coach_id")
      .eq("athlete_id", data.athleteId)
      .in("coach_id", allCoachIds);
    const allPlanIds = (allPlansRes.data ?? []).map((p) => p.id as string);

    let logs: Array<{
      id: string;
      plan_id: string;
      duration_seconds: number;
      state_index: number;
      logged_at: string;
      note: string | null;
    }> = [];
    if (allPlanIds.length > 0) {
      const lg = await supabaseAdmin
        .from("plan_sessions")
        .select("id, plan_id, duration_seconds, state_index, logged_at, note")
        .in("plan_id", allPlanIds)
        .gte("logged_at", sinceIso)
        .order("logged_at", { ascending: false })
        .limit(40);
      logs = (lg.data ?? []) as typeof logs;
    }
    const totalMinutes = Math.round(logs.reduce((s, l) => s + (l.duration_seconds || 0), 0) / 60);
    const lastLoggedAt = logs[0]?.logged_at ?? null;
    const stateLabels = ["frustrated", "pushing", "steady", "locked in", "flowing"];
    const stateSummary = logs.slice(0, 8).map((l) => stateLabels[l.state_index] ?? "unknown");

    // 8) Recent messages in this coach's room with this athlete
    const room = await supabaseAdmin
      .from("message_rooms")
      .select("id")
      .eq("coach_id", coachId)
      .eq("athlete_id", data.athleteId)
      .maybeSingle();
    let recentMessages: Array<{ sender_role: string; body: string | null; created_at: string }> = [];
    if (room.data?.id) {
      const msgs = await supabaseAdmin
        .from("messages")
        .select("sender_role, body, created_at")
        .eq("room_id", room.data.id as string)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(10);
      recentMessages = (msgs.data ?? []) as typeof recentMessages;
    }

    // 9) Build hash of inputs
    const sourceHash = stableHash({
      sinceDate: sinceIso,
      myPlanId: myPlan.data?.id ?? null,
      myPlanUpdated: myPlan.data?.updated_at ?? null,
      myPlanMoves: myPlanMoves.map((m) => `${m.name}@${m.created_at}`),
      otherPlans: otherPlans.map((p) => `${p.title}/${p.coachName}@${p.updated_at}`),
      logs: logs.map((l) => l.id),
      messages: recentMessages.map((m) => `${m.sender_role}@${m.created_at}`),
    });

    // 10) Check cache
    if (!data.refresh) {
      const cached = await supabaseAdmin
        .from("pre_lesson_briefings")
        .select("narrative, generated_at, source_hash")
        .eq("coach_id", coachId)
        .eq("athlete_id", data.athleteId)
        .eq("lesson_date", data.lessonDate)
        .maybeSingle();
      if (cached.data && cached.data.source_hash === sourceHash) {
        return {
          narrative: cached.data.narrative as string,
          generatedAt: cached.data.generated_at as string,
          fromCache: true,
        };
      }
    }

    // 11) Generate via Lovable AI
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const sinceLabel = sinceDate.toISOString().slice(0, 10);
    const context_lines: string[] = [
      `Coach: ${coachName}`,
      `Athlete: ${athleteFirstName}`,
      `Last lesson: ${sinceLabel}`,
      `Upcoming lesson date: ${data.lessonDate}`,
      "",
      "## Your active plan with this athlete",
      myPlan.data
        ? `Plan "${myPlan.data.title ?? "(untitled)"}", last updated ${(myPlan.data.updated_at as string).slice(0, 10)}.`
        : "No active plan with this athlete yet.",
      myPlanMoves.length
        ? `New/updated moves in your plan since last lesson: ${myPlanMoves.map((m) => m.name).join(", ")}.`
        : "No new moves in your plan since last lesson.",
      "",
      "## Active plans from other coaches",
      otherPlans.length
        ? otherPlans
            .map(
              (p) =>
                `- ${p.coachName}: "${p.title}" (last updated ${p.updated_at.slice(0, 10)})`,
            )
            .join("\n")
        : "None.",
      "",
      "## Practice logs since last lesson (across all coaches)",
      logs.length
        ? `${logs.length} session${logs.length === 1 ? "" : "s"} totaling ~${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}. ` +
          `Most recent: ${lastLoggedAt?.slice(0, 10)}. Recent flow states (newest first): ${stateSummary.join(", ")}.`
        : "No practice logs in this window.",
      logs.find((l) => l.note)?.note
        ? `Recent practice note: "${logs.find((l) => l.note)!.note}"`
        : "",
      "",
      "## Recent messages between you and this family",
      recentMessages.length
        ? recentMessages
            .slice(0, 6)
            .map((m) => `- ${m.sender_role}: ${(m.body ?? "(voice note)").slice(0, 200)}`)
            .join("\n")
        : "No recent messages.",
    ];

    const prompt = `You are writing a short pre-lesson briefing for a coach who is about to teach an upcoming lesson. Use the data below to write 2–4 plain-language sentences for the coach. Be specific: name moves, plans, or notable signals from messages or practice logs. Reference what other coaches are working on if it's relevant. Do not invent facts. If a section is empty, simply omit it instead of saying "nothing happened". Address the coach in second person ("you", "your athlete"). Keep it under 80 words.

${context_lines.filter(Boolean).join("\n")}`;

    let narrative = "";
    try {
      const gateway = createLovableAiGatewayProvider(apiKey);
      const result = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        prompt,
      });
      narrative = result.text.trim();
    } catch (err) {
      console.error("[pre-lesson-briefing] AI error", err);
      throw new Error("Couldn't generate the briefing right now. Please try again.");
    }
    if (!narrative) {
      throw new Error("AI returned an empty briefing.");
    }

    // 12) Upsert cache
    const up = await supabaseAdmin
      .from("pre_lesson_briefings")
      .upsert(
        {
          coach_id: coachId,
          athlete_id: data.athleteId,
          lesson_date: data.lessonDate,
          narrative,
          source_hash: sourceHash,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "coach_id,athlete_id,lesson_date" },
      )
      .select("generated_at")
      .single();
    if (up.error) dbError(up.error);

    return {
      narrative,
      generatedAt: (up.data?.generated_at as string) ?? new Date().toISOString(),
      fromCache: false,
    };
  });
