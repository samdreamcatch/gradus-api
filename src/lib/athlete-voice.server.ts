/**
 * Voice → plan for an athlete (PRD §6.14 B, decisions #37 and #48): the athlete
 * records a clip, the server transcribes it and structures it into a draft of
 * THEIR OWN plan, and the clip is gone. The audio is read once into the
 * transcription request and nowhere else: no storage write, no copy, and the
 * logs carry counts, never the words. The only thing kept is the transcript
 * text, on the plan (`plans.voice_transcript`), exactly as if the athlete had
 * typed it. Adults only since #48 (2026-10-07): an athlete under 18, or with no
 * birthdate on file, is refused before anything is transcribed
 * (`assertVoiceAllowed`), because the transcription service keeps the audio.
 *
 * Shares the transcription and structuring passes with the coach's
 * `voice.server.ts` (quiet mode on); only the lookup and the apply differ:
 * there is no athlete slot and no roster, the move hints come from the seeded
 * curriculum, and plan moves are plain rows with no library link.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { ATHLETE_SOURCE, loadOwnedPlan, requireAuthor } from "./athlete-authoring.server";
import { assertVoiceAllowed } from "./minor-voice.server";
import {
  assertAudioSize,
  buildDraft,
  didntCatchThat,
  locateQuote,
  mergeAppend,
  transcribeOrFail,
  type ApplyResult,
  type LibraryMove,
  type ParseContext,
  type VoiceBuildData,
} from "./voice.server";
import type { VoicePlanDraft, VoiceTouched } from "./voice-types";

type Client = SupabaseClient<Database>;

/** `admin` (when the caller has it) reads the age check, so RLS can't hide an athlete row. */
export type AthleteVoiceContext = { userId: string; supabase: Client; admin?: Client };

/**
 * What the 24-hour idempotency store keeps of a build result (decision #37:
 * only the transcript on the plan is kept). A retried upload still finds its
 * plan and the field flags, but the words (`transcript`, and the quotes in
 * `touched.sources`, which are slices of it) are dropped. The editor reads
 * the transcript from the plan itself.
 */
export function withoutWords(result: ApplyResult): ApplyResult {
  const { transcript: _t, sources: _s, ...touched } = result.touched;
  return { ...result, transcript: "", touched };
}

const SEED_COLUMNS =
  "id, sport, category, name, description, cue, why, default_target_kind, default_target_value";

async function seedLibrary(supabase: Client, athleteId: string): Promise<LibraryMove[]> {
  const goals = await supabase.from("athlete_goals").select("sport").eq("athlete_id", athleteId);
  if (goals.error) dbError(goals.error);
  const sports = Array.from(new Set((goals.data ?? []).map((g) => g.sport)));
  if (!sports.length) return [];

  const { data, error } = await supabase
    .from("seed_moves")
    .select(SEED_COLUMNS)
    .in("sport", sports)
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (error) dbError(error);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    category: r.category as string,
    description: (r.description as string) ?? "",
    cue: (r.cue as string) ?? "",
    why: (r.why as string) ?? "",
    defaultTargetKind: (r.default_target_kind as "reps" | "mins") ?? "reps",
    defaultTargetValue: Number(r.default_target_value ?? 10),
  }));
}

/**
 * `athleteVoiceBuildPlan`: transcribe with the curriculum's move names as
 * vocabulary hints, structure the words into a draft (create) or into edits
 * of one of the athlete's own plans (edit), and apply. The transcript is kept
 * on the plan even when the structuring step fails (`aiFailed`).
 */
export async function buildAthletePlanFromVoice(
  ctx: AthleteVoiceContext,
  data: VoiceBuildData,
): Promise<ApplyResult> {
  assertAudioSize(data.audio);
  const { supabase } = ctx;
  const athlete = await requireAuthor(supabase, ctx.userId);
  // Under 18 (or no birthdate): refused before the clip goes anywhere (#48).
  await assertVoiceAllowed(ctx.admin ?? supabase, ctx.userId);

  // Fail before any transcription cost when the plan to edit is not theirs.
  const owned =
    data.mode === "edit" && data.planId
      ? await loadOwnedPlan(supabase, athlete.id, data.planId)
      : null;

  const library = await seedLibrary(supabase, athlete.id);
  const transcript = await transcribeOrFail(
    data.audio,
    library.map((m) => m.name),
    { quiet: true },
  );
  if (!transcript || transcript.length < 2) throw didntCatchThat();

  let currentPlan: ParseContext["currentPlan"];
  if (owned && data.planId) {
    const { data: pm, error } = await supabase
      .from("plan_moves")
      .select("id, name, target_kind, target_value")
      .eq("plan_id", data.planId)
      .order("position", { ascending: true });
    if (error) dbError(error);
    currentPlan = {
      title: owned.title,
      athleteId: athlete.id,
      notes: owned.notes,
      moves: (pm ?? []).map((m) => ({
        id: m.id as string,
        name: m.name as string,
        targetKind: m.target_kind as string,
        targetValue: Number(m.target_value),
      })),
    };
  }

  const draft = await buildDraft({
    mode: data.mode,
    speaker: "athlete",
    quiet: true,
    transcript,
    athletes: [],
    library,
    currentPlan,
  });

  return applyAthleteDraft(
    supabase,
    athlete.id,
    data.mode,
    data.planId,
    draft,
    transcript,
    library,
  );
}

/**
 * Writes the draft as the athlete's own plan. Never assigns (there is no
 * athlete slot to honor: whatever name the athlete spoke is ignored), never
 * touches a plan that is not theirs, and links no library move.
 */
export async function applyAthleteDraft(
  supabase: Client,
  athleteId: string,
  mode: "create" | "edit",
  planId: string | undefined,
  draft: VoicePlanDraft,
  transcript: string,
  library: LibraryMove[],
): Promise<ApplyResult> {
  const touched: VoiceTouched = {
    plan: {},
    moves: {},
    newMoveIds: [],
    transcript,
    sources: { plan: {}, moves: {} },
  };
  let workingPlanId = planId ?? "";

  const setPlanSource = (key: "title" | "notes", quote?: string) => {
    if (!quote) return;
    const loc = locateQuote(transcript, quote);
    if (loc) touched.sources!.plan![key] = loc;
  };
  const setMoveSource = (
    moveId: string,
    field: "name" | "description" | "cue" | "why" | "target",
    quote?: string,
  ) => {
    if (!quote) return;
    const loc = locateQuote(transcript, quote);
    if (!loc) return;
    if (!touched.sources!.moves![moveId]) touched.sources!.moves![moveId] = {};
    touched.sources!.moves![moveId][field] = loc;
  };

  if (mode === "create") {
    const { data: created, error } = await supabase
      .from("plans")
      .insert({
        athlete_id: athleteId,
        kind: "plan",
        source: ATHLETE_SOURCE,
        status: "draft",
        title: draft.title || "Untitled plan",
        notes: draft.notes ?? "",
        voice_transcript: transcript,
      })
      .select("id")
      .single();
    if (error) dbError(error);
    workingPlanId = created.id;
    if (draft.title) {
      touched.plan.title = true;
      setPlanSource("title", draft.sources?.title);
    }
    if (draft.notes) {
      touched.plan.notes = true;
      setPlanSource("notes", draft.sources?.notes);
    }
  } else {
    const plan = await loadOwnedPlan(supabase, athleteId, workingPlanId);
    const patch: { updated_at: string; title?: string; notes?: string; voice_transcript: string } =
      { updated_at: new Date().toISOString(), voice_transcript: transcript };
    if (draft.title) {
      patch.title = draft.title;
      touched.plan.title = true;
      setPlanSource("title", draft.sources?.title);
    }
    if (draft.notes != null) {
      patch.notes = draft.notes;
      touched.plan.notes = true;
      setPlanSource("notes", draft.sources?.notes);
    }
    const { error } = await supabase
      .from("plans")
      .update(patch)
      .eq("id", plan.id)
      .eq("athlete_id", athleteId)
      .eq("source", ATHLETE_SOURCE);
    if (error) dbError(error);
  }

  const { data: lastPos } = await supabase
    .from("plan_moves")
    .select("position")
    .eq("plan_id", workingPlanId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextPos = (lastPos?.position ?? -1) + 1;

  const seedById = new Map(library.map((m) => [m.id, m]));
  let appliedMoveCount = 0;
  for (const m of draft.moves) {
    const isUpdate = mode === "edit" && m.matchExistingMoveId;
    if (isUpdate) {
      const { data: pm } = await supabase
        .from("plan_moves")
        .select("id")
        .eq("id", m.matchExistingMoveId!)
        .eq("plan_id", workingPlanId)
        .maybeSingle();
      if (!pm) continue;

      const patch: {
        name?: string;
        description?: string;
        cue?: string;
        why?: string;
        target_kind?: "reps" | "mins";
        target_value?: number;
      } = {};
      const fieldsTouched: string[] = [];
      if (m.name) {
        patch.name = m.name;
        fieldsTouched.push("name");
        setMoveSource(pm.id, "name", m.sources?.name);
      }
      if (m.description) {
        patch.description = m.description;
        fieldsTouched.push("description");
        setMoveSource(pm.id, "description", m.sources?.description);
      }
      if (m.cue) {
        patch.cue = m.cue;
        fieldsTouched.push("cue");
        setMoveSource(pm.id, "cue", m.sources?.cue);
      }
      if (m.why) {
        patch.why = m.why;
        fieldsTouched.push("why");
        setMoveSource(pm.id, "why", m.sources?.why);
      }
      if (m.sources?.target || m.targetValue !== 10) {
        patch.target_kind = m.targetKind;
        patch.target_value = m.targetValue;
        fieldsTouched.push("targetKind", "targetValue");
        setMoveSource(pm.id, "target", m.sources?.target);
      }
      if (Object.keys(patch).length === 0) continue;

      const { error } = await supabase
        .from("plan_moves")
        .update(patch)
        .eq("id", pm.id)
        .eq("plan_id", workingPlanId);
      if (error) dbError(error);
      touched.moves[pm.id] = fieldsTouched;
      appliedMoveCount++;
    } else {
      // A spoken name that matched a curriculum move starts from its wording;
      // the plan row is a plain copy either way (no `move_id`).
      const seed = m.libraryMoveId ? (seedById.get(m.libraryMoveId) ?? null) : null;
      const finalDescription = seed ? mergeAppend(seed.description, m.description) : m.description;
      const finalCue = seed ? mergeAppend(seed.cue, m.cue) : m.cue;
      const finalWhy = seed ? mergeAppend(seed.why, m.why) : m.why;
      const finalTargetKind = seed && !m.targetFromVoice ? seed.defaultTargetKind : m.targetKind;
      const finalTargetValue = seed && !m.targetFromVoice ? seed.defaultTargetValue : m.targetValue;

      const { data: ins, error } = await supabase
        .from("plan_moves")
        .insert({
          plan_id: workingPlanId,
          move_id: null,
          position: nextPos++,
          name: m.name,
          description: finalDescription,
          cue: finalCue,
          why: finalWhy,
          target_kind: finalTargetKind,
          target_value: finalTargetValue,
        })
        .select("id")
        .single();
      if (error) dbError(error);
      touched.newMoveIds.push(ins.id);
      const touchedFields: string[] = ["name"];
      if (m.description) touchedFields.push("description");
      if (m.cue) touchedFields.push("cue");
      if (m.why) touchedFields.push("why");
      if (m.targetFromVoice || !seed) touchedFields.push("target");
      touched.moves[ins.id] = touchedFields;
      setMoveSource(ins.id, "name", m.sources?.name);
      setMoveSource(ins.id, "description", m.sources?.description);
      setMoveSource(ins.id, "cue", m.sources?.cue);
      setMoveSource(ins.id, "why", m.sources?.why);
      setMoveSource(ins.id, "target", m.sources?.target);
      appliedMoveCount++;
    }
  }

  if (draft.moves.length) {
    await supabase
      .from("plans")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", workingPlanId)
      .eq("athlete_id", athleteId)
      .eq("source", ATHLETE_SOURCE);
  }

  // Counts only: nothing the athlete said reaches the logs.
  console.info(
    "[voice] applied (athlete)",
    JSON.stringify({
      mode,
      planId: workingPlanId,
      appliedMoveCount,
      draftMoveCount: draft.moves.length,
    }),
  );

  return {
    planId: workingPlanId,
    transcript,
    touched,
    // There is no athlete slot on this route: a spoken name is dropped, never resolved.
    unresolvedAthleteName: null,
    appliedMoveCount,
    droppedMoveCount: draft.droppedMoveCount ?? 0,
    aiFailed: Boolean(draft.aiFailed),
  };
}
