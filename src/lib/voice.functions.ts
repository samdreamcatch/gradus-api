import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";
import {
  MAX_AUDIO_BYTES,
  applyDraft,
  buildDraft,
  getCoachId,
  transcribeWithElevenLabs,
  type ApplyResult,
  type Client,
  type LibraryMove,
  type ParseContext,
} from "./voice.server";

// Re-export types so existing callers keep working.
export type {
  FieldSource,
  VoicePlanDraft,
  VoiceSources,
  VoiceTouched,
} from "./voice-types";

export const voiceTranscribe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error("Expected FormData");
    const audio = input.get("audio");
    if (!(audio instanceof Blob)) throw new Error("Missing audio");
    if (audio.size > MAX_AUDIO_BYTES) {
      throw new Error("Recording too long — please keep voice notes under 90 seconds");
    }
    return { audio };
  })
  .handler(async ({ data }): Promise<{ text: string }> => {
    const transcript = await transcribeWithElevenLabs(data.audio);
    if (!transcript || transcript.length < 1) {
      throw new Error("Didn't catch that — try again");
    }
    return { text: transcript };
  });

export const voiceBuildPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error("Expected FormData");
    const audio = input.get("audio");
    const mode = input.get("mode");
    const planId = input.get("planId");
    if (!(audio instanceof Blob)) throw new Error("Missing audio");
    if (audio.size > MAX_AUDIO_BYTES) {
      throw new Error("Recording too long — please keep voice notes under 90 seconds");
    }
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

    const { data: libRows } = await supabase
      .from("moves")
      .select(
        "id, name, category, description, cue, why, default_target_kind, default_target_value",
      )
      .eq("coach_id", coachId)
      .is("archived_at", null);

    const library: LibraryMove[] = (libRows ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      category: r.category as string,
      description: (r.description as string) ?? "",
      cue: (r.cue as string) ?? "",
      why: (r.why as string) ?? "",
      defaultTargetKind: (r.default_target_kind as "reps" | "mins") ?? "reps",
      defaultTargetValue: Number(r.default_target_value ?? 10),
    }));

    const [transcript, { data: rosterRows }] = await Promise.all([
      transcribeWithElevenLabs(data.audio, library.map((m) => m.name)),
      supabase
        .from("coach_athletes")
        .select("athlete_id, athletes!inner(id, first_name, last_name)")
        .eq("coach_id", coachId),
    ]);
    if (!transcript || transcript.length < 2) throw new Error("Didn't catch that — try again");

    const athletes = (rosterRows ?? []).map((row) => {
      const a = (row as unknown as {
        athletes: { id: string; first_name: string; last_name: string };
      }).athletes;
      return { id: a.id, name: `${a.first_name} ${a.last_name}`.trim() };
    });

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

    const draft = await buildDraft({
      mode: data.mode,
      transcript,
      athletes,
      library,
      currentPlan,
    });

    return applyDraft(supabase, coachId, data.mode, data.planId, draft, transcript);
  });
