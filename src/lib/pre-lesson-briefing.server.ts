/**
 * Pre-lesson briefing (PRD §7.2 "Pre-lesson briefing"): an AI narrative per
 * athlete per lesson date, built from plans, practice logs, and messages
 * since the last lesson, cached by a hash of those inputs. Single source of
 * truth for pre-lesson-briefing.functions.ts and
 * `GET /api/v1/coach/athletes/{id}/briefing`. Extracted without behavior
 * changes; user-facing messages are kept verbatim on ApiError.
 */
import { generateText } from "ai";
import { createHash } from "crypto";
import { z } from "zod";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { PROMPT_INJECTION_GUARD, sanitizeUserContent, wrapUntrusted } from "./ai-prompt-safety";
import { ApiError } from "./api/errors";
import { loadCoachAthleteProfile, type LoadCoachAthleteProfile } from "./athlete-profile.server";
import { dbError } from "./db-error";

type Admin = typeof supabaseAdmin;

export type BriefingContext = { userId: string; admin: Admin };

/** Seams for tests: the model call and the athlete profile (L3). */
export interface BriefingDeps {
  generate?: (args: { system: string; prompt: string; apiKey: string }) => Promise<string>;
  loadProfile?: LoadCoachAthleteProfile;
}

const defaultGenerate: NonNullable<BriefingDeps["generate"]> = async ({
  system,
  prompt,
  apiKey,
}) => {
  const gateway = createLovableAiGatewayProvider(apiKey);
  const result = await generateText({
    model: gateway("google/gemini-3-flash-preview"),
    system,
    prompt,
  });
  return result.text;
};

const PRE_LESSON_BRIEFING_SYSTEM = `You are a factual reporting assistant for a sports coaching platform. Your only job is to report what is explicitly present in the data you receive. You do not infer, speculate, add encouragement, or use generic coaching language to fill gaps. If a section has no data, skip it — do not write around it. A one-sentence output is always better than three vague ones.`;

export type PreLessonBriefing = {
  narrative: string;
  generatedAt: string;
  fromCache: boolean;
};

export const briefingInput = z.object({
  lessonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "lessonDate must be YYYY-MM-DD"),
  /** Bypass the cache and regenerate (query strings arrive as text). */
  refresh: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .optional()
    .transform((v) => v === true || v === "true" || v === "1"),
});

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const aiUnavailable = (message: string) =>
  new ApiError({ code: "ai_unavailable", status: 503, message });

function stableHash(obj: unknown): string {
  const json = JSON.stringify(obj, Object.keys(obj as object).sort());
  return createHash("sha256").update(json).digest("hex").slice(0, 32);
}

/** `getPreLessonBriefing`: the cached narrative when its inputs are unchanged, else a fresh one. */
export async function getPreLessonBriefing(
  ctx: BriefingContext,
  athleteId: string,
  data: z.infer<typeof briefingInput>,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
  deps: BriefingDeps = {},
): Promise<PreLessonBriefing> {
  const { admin, userId } = ctx;
  const input = { athleteId, lessonDate: data.lessonDate, refresh: !!data.refresh };
  const generate = deps.generate ?? defaultGenerate;
  const loadProfile = deps.loadProfile ?? loadCoachAthleteProfile;
  // 1) Resolve coach
  const coachRes = await admin
    .from("coach_profiles")
    .select("id, first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (coachRes.error) dbError(coachRes.error);
  if (!coachRes.data) throw unprocessable("Coach profile not found");
  const coachId = coachRes.data.id as string;
  const coachName =
    `${coachRes.data.first_name ?? ""} ${coachRes.data.last_name ?? ""}`.trim() || "Coach";

  // 2) Confirm coach-athlete link
  const link = await admin
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", coachId)
    .eq("athlete_id", input.athleteId)
    .maybeSingle();
  if (link.error) dbError(link.error);
  if (!link.data) throw unprocessable("Athlete is not on your roster");

  // The athlete profile (PRD §6.7 item 6) loads alongside the reads below;
  // never throws.
  const profilePromise = loadProfile(admin, coachId, input.athleteId, now);

  // 3) Find previous lesson date (most recent wrap-up before this lesson_date)
  const prevWrap = await admin
    .from("lesson_wrap_ups")
    .select("lesson_date")
    .eq("coach_id", coachId)
    .eq("athlete_id", input.athleteId)
    .lt("lesson_date", input.lessonDate)
    .order("lesson_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sinceDate = prevWrap.data?.lesson_date
    ? new Date(prevWrap.data.lesson_date as string)
    : new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString();

  // 4) Athlete name
  const athlete = await admin
    .from("athletes")
    .select("first_name, last_name")
    .eq("id", input.athleteId)
    .maybeSingle();
  const athleteFirstName = (athlete.data?.first_name as string) || "the athlete";

  // 5) This coach's active plan + plan_moves updated since last lesson
  const myPlan = await admin
    .from("plans")
    .select("id, title, status, updated_at")
    .eq("coach_id", coachId)
    .eq("athlete_id", input.athleteId)
    .eq("kind", "plan")
    .eq("status", "active")
    .maybeSingle();

  let myPlanMoves: Array<{ name: string; created_at: string }> = [];
  if (myPlan.data?.id) {
    const pm = await admin
      .from("plan_moves")
      .select("name, created_at")
      .eq("plan_id", myPlan.data.id as string)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(10);
    myPlanMoves = (pm.data ?? []) as typeof myPlanMoves;
  }

  // 6) Other coaches linked to this athlete and their active plans
  const otherLinks = await admin
    .from("coach_athletes")
    .select("coach_id")
    .eq("athlete_id", input.athleteId)
    .neq("coach_id", coachId);
  const otherCoachIds = (otherLinks.data ?? []).map((r) => r.coach_id as string);

  let otherPlans: Array<{
    title: string;
    status: string;
    updated_at: string;
    coachName: string;
  }> = [];
  if (otherCoachIds.length > 0) {
    const op = await admin
      .from("plans")
      .select("title, status, updated_at, coach_id")
      .eq("athlete_id", input.athleteId)
      .eq("kind", "plan")
      .eq("status", "active")
      .in("coach_id", otherCoachIds);
    const otherCoaches = await admin
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
  const allPlansRes = await admin
    .from("plans")
    .select("id, coach_id")
    .eq("athlete_id", input.athleteId)
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
    const lg = await admin
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
  const room = await admin
    .from("message_rooms")
    .select("id")
    .eq("coach_id", coachId)
    .eq("athlete_id", input.athleteId)
    .maybeSingle();
  let recentMessages: Array<{ sender_role: string; body: string | null; created_at: string }> = [];
  if (room.data?.id) {
    const msgs = await admin
      .from("messages")
      .select("sender_role, body, created_at")
      .eq("room_id", room.data.id as string)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(10);
    recentMessages = (msgs.data ?? []) as typeof recentMessages;
  }

  // 9) The athlete profile: pace, seasonal dips, level changes, results
  // history, for this coach's sports.
  const athleteProfile = await profilePromise;

  // 10) Build hash of inputs (the profile's own hash changes only when it does)
  const sourceHash = stableHash({
    profile: athleteProfile.profile.hash,
    sinceDate: sinceIso,
    myPlanId: myPlan.data?.id ?? null,
    myPlanUpdated: myPlan.data?.updated_at ?? null,
    myPlanMoves: myPlanMoves.map((m) => `${m.name}@${m.created_at}`),
    otherPlans: otherPlans.map((p) => `${p.title}/${p.coachName}@${p.updated_at}`),
    logs: logs.map((l) => l.id),
    messages: recentMessages.map((m) => `${m.sender_role}@${m.created_at}`),
  });

  // 11) Check cache
  if (!input.refresh) {
    const cached = await admin
      .from("pre_lesson_briefings")
      .select("narrative, generated_at, source_hash")
      .eq("coach_id", coachId)
      .eq("athlete_id", input.athleteId)
      .eq("lesson_date", input.lessonDate)
      .maybeSingle();
    if (cached.data && cached.data.source_hash === sourceHash) {
      return {
        narrative: cached.data.narrative as string,
        generatedAt: cached.data.generated_at as string,
        fromCache: true,
      };
    }
  }

  // 12) Generate via Lovable AI
  const apiKey = env.LOVABLE_API_KEY;
  if (!apiKey)
    throw new ApiError({ code: "internal", status: 500, message: "Missing LOVABLE_API_KEY" });

  const sinceLabel = sinceDate.toISOString().slice(0, 10);
  const recentNote = logs.find((l) => l.note)?.note ?? "";
  const safeRecentNote = sanitizeUserContent(recentNote, 400);
  const context_lines: string[] = [
    `Coach: ${sanitizeUserContent(coachName, 80)}`,
    `Athlete: ${sanitizeUserContent(athleteFirstName, 80)}`,
    `Last lesson: ${sinceLabel}`,
    `Upcoming lesson date: ${input.lessonDate}`,
    "",
    "## Your active plan with this athlete",
    myPlan.data
      ? `Plan "${sanitizeUserContent(myPlan.data.title ?? "(untitled)", 120)}", last updated ${(myPlan.data.updated_at as string).slice(0, 10)}.`
      : "No active plan with this athlete yet.",
    myPlanMoves.length
      ? `New/updated moves in your plan since last lesson: ${myPlanMoves
          .map((m) => sanitizeUserContent(m.name, 80))
          .join(", ")}.`
      : "No new moves in your plan since last lesson.",
    "",
    "## Active plans from other coaches",
    otherPlans.length
      ? otherPlans
          .map(
            (p) =>
              `- ${sanitizeUserContent(p.coachName, 80)}: "${sanitizeUserContent(p.title, 120)}" (last updated ${p.updated_at.slice(0, 10)})`,
          )
          .join("\n")
      : "None.",
    "",
    "## Practice logs since last lesson (across all coaches)",
    logs.length
      ? `${logs.length} session${logs.length === 1 ? "" : "s"} totaling ~${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}. ` +
        `Most recent: ${lastLoggedAt?.slice(0, 10)}. Recent flow states (newest first): ${stateSummary.join(", ")}.`
      : "No practice logs in this window.",
    safeRecentNote ? `Recent practice note: ${wrapUntrusted("practice_note", safeRecentNote)}` : "",
    "",
    "## Recent messages between you and this family",
    recentMessages.length
      ? recentMessages
          .slice(0, 6)
          .map(
            (m) =>
              `- ${m.sender_role}: ${wrapUntrusted("message_body", sanitizeUserContent(m.body ?? "(voice note)", 200))}`,
          )
          .join("\n")
      : "No recent messages.",
    ...(athleteProfile.text
      ? [
          "",
          "## Longer-term picture (use only if it bears on this lesson; never repeat it wholesale)",
          athleteProfile.text,
        ]
      : []),
  ];

  const prompt = `${PROMPT_INJECTION_GUARD}

Write a terse pre-lesson briefing for the coach based strictly on the data below. 1–3 short sentences, under 50 words. Only include what is explicitly present in the data — do not infer, interpret, or pad.

Rules:
- Lead with the most actionable signal. If there is no signal, say so in one sentence and stop.
- If data is sparse (few or no sessions, no notes, no messages), write fewer sentences — do not fill the gap with generic observations.
- Reference specific plans, moves, flow states, or messages only when they appear in the data below. Do not name anything you have not seen.
- If no practice notes exist, do not describe what practice was like. State only observable facts (session count, flow states, dates).
- No coaching advice. No suggestions. No filler phrases like "keep up the great work" or "stay focused."
- Second person ("you", "your athlete"). Plain language.

${context_lines.filter(Boolean).join("\n")}`;

  let narrative = "";
  try {
    narrative = (await generate({ system: PRE_LESSON_BRIEFING_SYSTEM, prompt, apiKey })).trim();
  } catch (err) {
    console.error("[pre-lesson-briefing] AI error", err);
    throw aiUnavailable("Couldn't generate the briefing right now. Please try again.");
  }
  if (!narrative) {
    throw aiUnavailable("AI returned an empty briefing.");
  }

  // 13) Upsert cache
  const up = await admin
    .from("pre_lesson_briefings")
    .upsert(
      {
        coach_id: coachId,
        athlete_id: input.athleteId,
        lesson_date: input.lessonDate,
        narrative,
        source_hash: sourceHash,
        generated_at: now.toISOString(),
      },
      { onConflict: "coach_id,athlete_id,lesson_date" },
    )
    .select("generated_at")
    .single();
  if (up.error) dbError(up.error);

  return {
    narrative,
    generatedAt: (up.data?.generated_at as string) ?? now.toISOString(),
    fromCache: false,
  };
}
