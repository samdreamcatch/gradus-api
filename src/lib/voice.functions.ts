import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, Output } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

type Client = SupabaseClient<Database>;

async function getCoachId(supabase: Client, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw new Error("Coach profile not found");
  return data.id;
}

/* ---------------- Transcription (ElevenLabs Scribe) ---------------- */

async function transcribeWithElevenLabs(audio: Blob): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Voice service not configured");

  const form = new FormData();
  form.append("file", audio, "voice.webm");
  form.append("model_id", "scribe_v2");
  form.append("language_code", "eng");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("ElevenLabs STT failed", res.status, body);
    if (res.status === 401) throw new Error("Voice service unauthorized");
    if (res.status === 429) throw new Error("Voice service is busy — try again in a moment");
    throw new Error("Couldn't transcribe that — please try again");
  }

  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

/* ---------------- LLM parsing (Lovable AI / Gemini) ---------------- */

const moveDraftSchema = z.object({
  matchExistingMoveId: z
    .string()
    .nullable()
    .optional()
    .describe(
      "If the coach is modifying an existing plan_move in the current plan, set to that plan_move id. Otherwise null/omit.",
    ),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  cue: z.string().max(1000).default(""),
  why: z.string().max(1000).default(""),
  targetKind: z.enum(["reps", "mins"]),
  targetValue: z.number().min(0).max(10000),
});

const planDraftSchema = z.object({
  title: z.string().max(160).optional().describe("Plan title if the coach named one."),
  athleteId: z
    .string()
    .nullable()
    .optional()
    .describe("UUID of athlete from the provided roster. Null/omit if none mentioned."),
  unresolvedAthleteName: z
    .string()
    .optional()
    .describe("Set ONLY if the coach said a name that is not in the roster."),
  notes: z.string().max(2000).optional(),
  moves: z.array(moveDraftSchema).max(30),
});

export type VoicePlanDraft = z.infer<typeof planDraftSchema>;

interface ParseContext {
  mode: "create" | "edit";
  transcript: string;
  athletes: { id: string; name: string }[];
  library: { id: string; name: string; category: string }[];
  currentPlan?: {
    title: string;
    athleteId: string | null;
    notes: string;
    moves: { id: string; name: string; targetKind: string; targetValue: number }[];
  };
}

async function parseVoicePlanDraft(ctx: ParseContext): Promise<VoicePlanDraft> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI not configured");
  const gateway = createLovableAiGatewayProvider(apiKey);
  const model = gateway("google/gemini-3-flash-preview");

  const system = [
    "You are a tennis/sports coaching assistant that converts a coach's spoken instructions into a structured practice plan.",
    "Rules:",
    "- Use ONLY athlete IDs from the provided roster. If a name doesn't match, set unresolvedAthleteName and leave athleteId null.",
    "- Infer targetKind: 'reps' for counted repetitions ('20 reps', 'ten swings'), 'mins' for time-based drills ('5 minutes', 'two minute drill'). Default to reps with value 10 if unclear.",
    "- Keep `cue` to a single short phrase (e.g. 'low to high swing path'). Keep `why` to one sentence on the purpose.",
    "- Keep `description` brief — what the athlete does, no fluff.",
    "- Prefer move names that match the coach's library when the coach references a known drill.",
    ctx.mode === "edit"
      ? "- EDIT MODE: For each move the coach mentions that clearly refers to an EXISTING plan move (by name/order), set matchExistingMoveId to that move id and include the updated fields. For new moves, leave matchExistingMoveId null/omitted. Do not duplicate existing moves."
      : "- CREATE MODE: All moves are new. Omit matchExistingMoveId.",
    "- Do not invent athletes, drills, or numbers the coach did not say.",
    "- Output ONLY structured data per the schema.",
  ].join("\n");

  const promptParts = [
    `Coach transcript:\n"""${ctx.transcript}"""`,
    `Athlete roster (id — name):\n${
      ctx.athletes.length ? ctx.athletes.map((a) => `- ${a.id} — ${a.name}`).join("\n") : "(none)"
    }`,
    `Coach's move library (name — category):\n${
      ctx.library.length
        ? ctx.library.slice(0, 200).map((m) => `- ${m.name} (${m.category})`).join("\n")
        : "(none)"
    }`,
  ];

  if (ctx.mode === "edit" && ctx.currentPlan) {
    promptParts.push(
      `Current plan:\n- title: ${ctx.currentPlan.title || "(untitled)"}\n- notes: ${
        ctx.currentPlan.notes || "(none)"
      }`,
      `Current plan moves (id — name, target):\n${
        ctx.currentPlan.moves.length
          ? ctx.currentPlan.moves
              .map((m) => `- ${m.id} — ${m.name} (${m.targetValue} ${m.targetKind})`)
              .join("\n")
          : "(none)"
      }`,
    );
  }

  try {
    const { experimental_output } = await generateText({
      model,
      system,
      prompt: promptParts.join("\n\n"),
      experimental_output: Output.object({ schema: planDraftSchema }),
    });
    return experimental_output;
  } catch (e) {
    const err = e as { statusCode?: number; message?: string };
    console.error("voice parse failed", err);
    if (err.statusCode === 429)
      throw new Error("AI is busy — try again in a moment");
    if (err.statusCode === 402)
      throw new Error("AI credits exhausted — add credits in workspace settings");
    throw new Error("Couldn't organize that — please try again");
  }
}

/* ---------------- Apply draft to DB ---------------- */

export interface VoiceTouched {
  plan: { title?: boolean; athleteId?: boolean; notes?: boolean };
  /** plan_move id -> list of field names touched */
  moves: Record<string, string[]>;
  /** plan_move ids that were newly created by voice */
  newMoveIds: string[];
}

interface ApplyResult {
  planId: string;
  transcript: string;
  touched: VoiceTouched;
  unresolvedAthleteName: string | null;
  appliedMoveCount: number;
}

async function applyDraft(
  supabase: Client,
  coachId: string,
  mode: "create" | "edit",
  planId: string | undefined,
  draft: VoicePlanDraft,
  transcript: string,
): Promise<ApplyResult> {
  const touched: VoiceTouched = { plan: {}, moves: {}, newMoveIds: [] };
  let workingPlanId = planId ?? "";

  /* Create plan if needed */
  if (mode === "create") {
    const { data: created, error } = await supabase
      .from("plans")
      .insert({
        coach_id: coachId,
        title: draft.title || "Untitled plan",
        notes: draft.notes ?? "",
        kind: "plan",
        athlete_id: draft.athleteId ?? null,
        status: "draft",
      })
      .select("id")
      .single();
    if (error) dbError(error);
    workingPlanId = created.id;
    if (draft.title) touched.plan.title = true;
    if (draft.athleteId) touched.plan.athleteId = true;
    if (draft.notes) touched.plan.notes = true;
  } else {
    // verify ownership
    const { data: plan, error } = await supabase
      .from("plans")
      .select("id, kind")
      .eq("id", workingPlanId)
      .eq("coach_id", coachId)
      .maybeSingle();
    if (error) dbError(error);
    if (!plan) throw new Error("Plan not found");

    const patch: {
      updated_at: string;
      title?: string;
      notes?: string;
      athlete_id?: string | null;
    } = { updated_at: new Date().toISOString() };
    if (draft.title) {
      patch.title = draft.title;
      touched.plan.title = true;
    }
    if (draft.notes) {
      patch.notes = draft.notes;
      touched.plan.notes = true;
    }
    if (draft.athleteId && plan.kind === "plan") {
      patch.athlete_id = draft.athleteId;
      touched.plan.athleteId = true;
    }
    const { error: upErr } = await supabase
      .from("plans")
      .update(patch)
      .eq("id", workingPlanId)
      .eq("coach_id", coachId);
    if (upErr) dbError(upErr);
  }

  /* Apply moves */
  // Get current max position
  const { data: lastPos } = await supabase
    .from("plan_moves")
    .select("position")
    .eq("plan_id", workingPlanId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextPos = (lastPos?.position ?? -1) + 1;

  let appliedMoveCount = 0;
  for (const m of draft.moves) {
    const isUpdate = mode === "edit" && m.matchExistingMoveId;
    if (isUpdate) {
      // verify the plan_move belongs to this plan
      const { data: pm } = await supabase
        .from("plan_moves")
        .select("id, plan_id")
        .eq("id", m.matchExistingMoveId!)
        .eq("plan_id", workingPlanId)
        .maybeSingle();
      if (!pm) continue;
      const { error } = await supabase
        .from("plan_moves")
        .update({
          name: m.name,
          description: m.description,
          cue: m.cue,
          why: m.why,
          target_kind: m.targetKind,
          target_value: m.targetValue,
        })
        .eq("id", pm.id)
        .eq("plan_id", workingPlanId);
      if (error) dbError(error);
      touched.moves[pm.id] = ["name", "description", "cue", "why", "target"];
      appliedMoveCount++;
    } else {
      const { data: ins, error } = await supabase
        .from("plan_moves")
        .insert({
          plan_id: workingPlanId,
          move_id: null,
          position: nextPos++,
          name: m.name,
          description: m.description,
          cue: m.cue,
          why: m.why,
          target_kind: m.targetKind,
          target_value: m.targetValue,
        })
        .select("id")
        .single();
      if (error) dbError(error);
      touched.newMoveIds.push(ins.id);
      touched.moves[ins.id] = ["name", "description", "cue", "why", "target"];
      appliedMoveCount++;
    }
  }

  // Bump updated_at if we touched moves
  if (draft.moves.length) {
    await supabase
      .from("plans")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", workingPlanId);
  }

  return {
    planId: workingPlanId,
    transcript,
    touched,
    unresolvedAthleteName: draft.unresolvedAthleteName ?? null,
    appliedMoveCount,
  };
}

/* ---------------- The public server function ---------------- */

export const voiceBuildPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!(input instanceof FormData)) {
      throw new Error("Expected FormData");
    }
    const audio = input.get("audio");
    const mode = input.get("mode");
    const planId = input.get("planId");
    if (!(audio instanceof Blob)) throw new Error("Missing audio");
    if (mode !== "create" && mode !== "edit") throw new Error("Invalid mode");
    if (mode === "edit" && typeof planId !== "string") throw new Error("Missing planId for edit");
    return {
      audio,
      mode: mode as "create" | "edit",
      planId: typeof planId === "string" ? planId : undefined,
    };
  })
  .handler(async ({ context, data }): Promise<ApplyResult> => {
    const supabase = context.supabase as Client;
    const coachId = await getCoachId(supabase, context.userId);

    // 1. Transcribe
    const transcript = await transcribeWithElevenLabs(data.audio);
    if (!transcript || transcript.length < 2) {
      throw new Error("Didn't catch that — try again");
    }

    // 2. Load context (roster + library + optional current plan)
    const [{ data: rosterRows }, { data: libRows }] = await Promise.all([
      supabase
        .from("coach_athletes")
        .select("athlete_id, athletes!inner(id, first_name, last_name)")
        .eq("coach_id", coachId),
      supabase
        .from("moves")
        .select("id, name, category")
        .eq("coach_id", coachId)
        .is("archived_at", null),
    ]);

    const athletes = (rosterRows ?? []).map((row) => {
      const a = (row as unknown as {
        athletes: { id: string; first_name: string; last_name: string };
      }).athletes;
      return { id: a.id, name: `${a.first_name} ${a.last_name}`.trim() };
    });
    const library = (libRows ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      category: r.category as string,
    }));

    let currentPlan: ParseContext["currentPlan"];
    if (data.mode === "edit" && data.planId) {
      const { data: plan, error } = await supabase
        .from("plans")
        .select("title, notes, athlete_id")
        .eq("id", data.planId)
        .eq("coach_id", coachId)
        .maybeSingle();
      if (error) dbError(error);
      if (!plan) throw new Error("Plan not found");
      const { data: pm } = await supabase
        .from("plan_moves")
        .select("id, name, target_kind, target_value")
        .eq("plan_id", data.planId)
        .order("position", { ascending: true });
      currentPlan = {
        title: plan.title,
        athleteId: plan.athlete_id,
        notes: plan.notes,
        moves: (pm ?? []).map((m) => ({
          id: m.id as string,
          name: m.name as string,
          targetKind: m.target_kind as string,
          targetValue: Number(m.target_value),
        })),
      };
    }

    // 3. Parse
    const draft = await parseVoicePlanDraft({
      mode: data.mode,
      transcript,
      athletes,
      library,
      currentPlan,
    });

    // 4. Apply
    return applyDraft(supabase, coachId, data.mode, data.planId, draft, transcript);
  });
