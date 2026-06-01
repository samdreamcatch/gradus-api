// Server-only module — must never be imported into client bundles.
if (typeof window !== "undefined") {
  throw new Error("voice.functions.ts is server-only and must not be imported in the browser");
}

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, Output } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB hard cap

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

/* ---------------- Types ---------------- */

export type FieldSource = { quote: string; start: number; end: number };

export interface VoiceSources {
  plan?: {
    title?: FieldSource;
    athleteId?: FieldSource;
    notes?: FieldSource;
  };
  moves?: Record<
    string,
    Partial<Record<"name" | "description" | "cue" | "why" | "target", FieldSource>>
  >;
}

export type VoicePlanDraft = {
  title?: string | null;
  athleteId?: string | null;
  unresolvedAthleteName?: string | null;
  notes?: string | null;
  moves: {
    matchExistingMoveId?: string | null;
    /** Resolved library move id (moves.id). When set, plan_move.move_id is linked and library defaults merge with voice. */
    libraryMoveId?: string | null;
    name: string;
    description: string;
    cue: string;
    why: string;
    targetKind: "reps" | "mins";
    targetValue: number;
    /** True when targetKind/targetValue came from the coach's voice (not a default). */
    targetFromVoice?: boolean;
    /** Per-field source quotes from transcript (by tmp index). */
    sources?: Partial<Record<"name" | "description" | "cue" | "why" | "target", string>>;
  }[];
  /** Top-level source quotes from transcript. */
  sources?: {
    title?: string;
    athleteName?: string;
    notes?: string;
  };
};

/* ---------------- Pass 1: Slotting ---------------- */

const slotMoveSchema = z.object({
  matchExistingMoveId: z
    .string()
    .nullish()
    .describe("Existing plan_move id if the coach is modifying it; else null."),
  name: z.string().nullish(),
  nameQuote: z.string().nullish().describe("Verbatim transcript phrase the name came from."),
  description: z.string().nullish(),
  descriptionQuote: z.string().nullish(),
  cue: z.string().nullish().describe("ONE short phrase the athlete can repeat."),
  cueQuote: z.string().nullish(),
  why: z.string().nullish().describe("ONE sentence on why this move matters."),
  whyQuote: z.string().nullish(),
  targetKind: z.enum(["reps", "mins"]).nullish(),
  targetValue: z.number().min(0).max(10000).nullish(),
  targetQuote: z.string().nullish(),
});

const slotSchema = z.object({
  title: z.string().nullish(),
  titleQuote: z.string().nullish(),
  athleteName: z
    .string()
    .nullish()
    .describe("RAW spoken athlete name as the coach said it (no id lookups)."),
  athleteQuote: z.string().nullish(),
  moves: z.array(slotMoveSchema).max(30).nullish(),
  leftover: z
    .string()
    .nullish()
    .describe(
      "Verbatim transcript fragments NOT slotted anywhere — for downstream notes cleanup.",
    ),
});

interface LibraryMove {
  id: string;
  name: string;
  category: string;
  description: string;
  cue: string;
  why: string;
  defaultTargetKind: "reps" | "mins";
  defaultTargetValue: number;
}

interface ParseContext {
  mode: "create" | "edit";
  transcript: string;
  athletes: { id: string; name: string }[];
  library: LibraryMove[];
  currentPlan?: {
    title: string;
    athleteId: string | null;
    notes: string;
    moves: { id: string; name: string; targetKind: string; targetValue: number }[];
  };
}

const FEW_SHOT = `Examples of correct slotting:

TRANSCRIPT: "Okay for Sarah, let's do crosscourt forehands, twenty reps, keep the racquet face closed — this fixes her wristy contact."
SLOTS: athleteName "Sarah"; moves[0].name "Crosscourt forehands", description "Hit 20 crosscourt forehands.", cue "Keep the racquet face closed", why "Fixes wristy contact.", targetKind "reps", targetValue 20.

TRANSCRIPT: "Add a five minute split-step drill — low athletic stance, helps her first step."
SLOTS: moves[0].name "Split-step drill", description "Five-minute split-step practice.", cue "Low athletic stance", why "Helps her first step.", targetKind "mins", targetValue 5.

Cue = ONE short phrase. Why = ONE sentence. Don't lump everything into description.`;

async function slotTranscript(ctx: ParseContext) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI not configured");
  const gateway = createLovableAiGatewayProvider(apiKey);
  const model = gateway("google/gemini-3-flash-preview");

  const system = [
    "You convert a tennis/sports coach's spoken instructions into structured slots.",
    "Map every meaningful piece of the transcript into exactly one slot: title, athleteName, or a move field (name/description/cue/why/target).",
    "For EVERY filled field, also fill its *Quote field with the verbatim transcript phrase that produced it (a clean substring of the transcript, not paraphrased).",
    "RULES:",
    "- Do NOT invent drills, names, or numbers the coach did not say.",
    "- athleteName is the RAW name spoken (e.g. 'Sarah'). Do NOT try to resolve IDs.",
    "- Cue = a SINGLE short repeatable phrase. Why = ONE sentence. Description = brief, what the athlete does.",
    "- targetKind: 'reps' for counted reps ('20 reps', 'ten swings'); 'mins' for time ('5 minutes').",
    "- Move target defaults: if unclear, 10 reps.",
    ctx.mode === "edit"
      ? "- EDIT MODE: if the coach clearly modifies an existing plan move (by name/order), set matchExistingMoveId. Otherwise leave null for new moves."
      : "- CREATE MODE: every move is new. Leave matchExistingMoveId null.",
    "- Put everything that is genuinely off-topic, context, encouragement, or rationale that doesn't fit a slot into `leftover` (verbatim).",
    "",
    FEW_SHOT,
  ].join("\n");

  const promptParts: string[] = [
    `TRANSCRIPT:\n"""${ctx.transcript}"""`,
    `KNOWN MOVES (library, name — category):\n${
      ctx.library.length
        ? ctx.library.slice(0, 150).map((m) => `- ${m.name} (${m.category})`).join("\n")
        : "(none)"
    }`,
  ];

  if (ctx.mode === "edit" && ctx.currentPlan) {
    promptParts.push(
      `CURRENT PLAN:\n- title: ${ctx.currentPlan.title || "(untitled)"}\n- notes: ${
        ctx.currentPlan.notes || "(none)"
      }`,
      `CURRENT PLAN MOVES (id — name, target):\n${
        ctx.currentPlan.moves.length
          ? ctx.currentPlan.moves
              .map((m) => `- ${m.id} — ${m.name} (${m.targetValue} ${m.targetKind})`)
              .join("\n")
          : "(none)"
      }`,
    );
  }

  const { experimental_output } = await generateText({
    model,
    system,
    prompt: promptParts.join("\n\n"),
    experimental_output: Output.object({ schema: slotSchema }),
  });
  return experimental_output;
}

/* ---------------- Pass 2: Deterministic resolution ---------------- */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);
  for (let i = 0; i <= b.length; i++) v0[i] = i;
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

function resolveAthlete(
  spoken: string | null | undefined,
  roster: { id: string; name: string }[],
): { id: string | null; unresolved: string | null } {
  if (!spoken || !spoken.trim()) return { id: null, unresolved: null };
  const q = normalize(spoken);
  if (!q) return { id: null, unresolved: null };

  // Exact full-name match
  for (const a of roster) {
    if (normalize(a.name) === q) return { id: a.id, unresolved: null };
  }
  // First-name exact
  const qFirst = q.split(" ")[0];
  for (const a of roster) {
    const first = normalize(a.name).split(" ")[0];
    if (first && first === qFirst) return { id: a.id, unresolved: null };
  }
  // Substring either direction
  for (const a of roster) {
    const n = normalize(a.name);
    if (n.includes(q) || q.includes(n)) return { id: a.id, unresolved: null };
  }
  // Fuzzy on first name (distance ≤ 2)
  let best: { id: string; d: number } | null = null;
  for (const a of roster) {
    const first = normalize(a.name).split(" ")[0];
    if (!first) continue;
    const d = levenshtein(first, qFirst);
    if (d <= 2 && (!best || d < best.d)) best = { id: a.id, d };
  }
  if (best) return { id: best.id, unresolved: null };
  return { id: null, unresolved: spoken.trim() };
}

/** Stop-words ignored when fuzzy-matching move names. */
const MOVE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "with", "drill", "drills", "practice",
]);

function moveTokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((w) => w && !MOVE_STOPWORDS.has(w));
}

/**
 * Resolve a spoken move name against the coach's library.
 * Returns the best library match if confidence is high enough, else null.
 */
function resolveLibraryMove(
  spoken: string | null | undefined,
  library: LibraryMove[],
): LibraryMove | null {
  if (!spoken || !spoken.trim() || library.length === 0) return null;
  const q = normalize(spoken);
  if (!q) return null;

  // Exact name match
  for (const m of library) {
    if (normalize(m.name) === q) return m;
  }
  // Containment either direction (e.g. "two-foot glide" ⊂ "two-foot glide forward")
  for (const m of library) {
    const n = normalize(m.name);
    if (n === q) return m;
    if (n.includes(q) || q.includes(n)) return m;
  }
  // Token-overlap with Jaccard similarity ≥ 0.6 on content words
  const qTokens = new Set(moveTokens(spoken));
  if (qTokens.size === 0) return null;
  let best: { move: LibraryMove; score: number } | null = null;
  for (const m of library) {
    const nTokens = new Set(moveTokens(m.name));
    if (nTokens.size === 0) continue;
    let overlap = 0;
    for (const t of qTokens) if (nTokens.has(t)) overlap++;
    const union = qTokens.size + nTokens.size - overlap;
    const score = union === 0 ? 0 : overlap / union;
    if (score >= 0.6 && (!best || score > best.score)) {
      best = { move: m, score };
    }
  }
  return best?.move ?? null;
}

/** Append voice content to a library default without overwriting. */
function mergeAppend(libraryValue: string, voiceValue: string): string {
  const lib = (libraryValue ?? "").trim();
  const voice = (voiceValue ?? "").trim();
  if (!voice) return lib;
  if (!lib) return voice;
  // Skip append if voice is already substantively contained in library text.
  if (lib.toLowerCase().includes(voice.toLowerCase())) return lib;
  // Ensure terminal punctuation on library segment.
  const libClean = /[.!?]$/.test(lib) ? lib : `${lib}.`;
  return `${libClean} ${voice}`;
}

/* ---------------- Quote location ---------------- */

function locateQuote(transcript: string, quote: string | null | undefined): FieldSource | null {
  if (!quote) return null;
  const q = quote.trim();
  if (!q) return null;
  // Try exact substring first
  const lower = transcript.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx >= 0) {
    return { quote: transcript.slice(idx, idx + q.length), start: idx, end: idx + q.length };
  }
  // Fall back to whitespace-collapsed match
  const tCollapsed = transcript.replace(/\s+/g, " ");
  const qCollapsed = q.replace(/\s+/g, " ");
  const cIdx = tCollapsed.toLowerCase().indexOf(qCollapsed.toLowerCase());
  if (cIdx >= 0) {
    // Approximate offset back into the original; close enough for display.
    return { quote: q, start: cIdx, end: cIdx + qCollapsed.length };
  }
  // Last resort: just return the quote with no anchored offset.
  return { quote: q, start: -1, end: -1 };
}

/* ---------------- Pass 3: Notes cleanup ---------------- */

async function cleanupNotes(opts: {
  leftover: string;
  existingNotes: string;
  mode: "create" | "edit";
  athleteFirstName: string | null;
}): Promise<string> {
  const { leftover, existingNotes, mode, athleteFirstName } = opts;
  const trimmedLeftover = leftover.trim();

  // If there's nothing new to add, keep existing notes as-is.
  if (!trimmedLeftover && mode === "edit") return existingNotes;
  if (!trimmedLeftover) return "";

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return existingNotes;
  const gateway = createLovableAiGatewayProvider(apiKey);
  const model = gateway("google/gemini-3-flash-preview");

  const system = [
    "You rewrite messy coaching dictation into clean, athlete- and parent-facing notes.",
    "STRICT RULES:",
    "- NO prefix or label. Do NOT write 'Notes:', 'AI noted:', 'Summary:', or quote marks.",
    "- Strip filler: 'um', 'uh', 'like', 'you know', 'okay so', 'I mean', false starts, self-corrections.",
    "- Convert first-person coach speech to neutral instruction. 'I want her to focus on X' → 'Focus on X.'",
    athleteFirstName
      ? `- The athlete is ${athleteFirstName}. Use their name only if it adds clarity; otherwise speak directly to them.`
      : "- Speak directly to the athlete (second person).",
    "- Tight: one short paragraph OR up to 3 short bullets (use '- ' for bullets).",
    "- Merge new content with existing notes. No duplication. No contradiction. If everything is already covered, return the existing notes unchanged.",
    "- If the new content is purely filler with nothing meaningful, return the existing notes unchanged.",
    "- Output ONLY the final notes text. No preamble, no explanations.",
  ].join("\n");

  const prompt = [
    `EXISTING NOTES:\n"""${existingNotes || "(none)"}"""`,
    `NEW SPOKEN CONTENT (raw):\n"""${trimmedLeftover}"""`,
    "Write the final clean notes now.",
  ].join("\n\n");

  try {
    const { text } = await generateText({ model, system, prompt });
    return (text ?? "").trim();
  } catch (e) {
    console.error("notes cleanup failed", e);
    return existingNotes;
  }
}

/* ---------------- Orchestrator: build draft ---------------- */

async function buildDraft(ctx: ParseContext): Promise<VoicePlanDraft> {
  let slotted;
  try {
    slotted = await slotTranscript(ctx);
  } catch (e) {
    const err = e as { statusCode?: number; message?: string };
    console.error("voice slot failed", err);
    if (err.statusCode === 429) throw new Error("AI is busy — try again in a moment");
    if (err.statusCode === 402)
      throw new Error("AI credits exhausted — add credits in workspace settings");
    // Hard failure: do NOT dump the raw transcript into notes.
    return { moves: [] };
  }

  // Resolve athlete deterministically.
  const { id: athleteId, unresolved } = resolveAthlete(slotted.athleteName, ctx.athletes);
  const resolvedAthlete = athleteId
    ? ctx.athletes.find((a) => a.id === athleteId) ?? null
    : null;
  const athleteFirstName = resolvedAthlete
    ? resolvedAthlete.name.split(" ")[0] ?? null
    : null;

  // Notes cleanup pass.
  const cleanedNotes = await cleanupNotes({
    leftover: slotted.leftover ?? "",
    existingNotes: ctx.currentPlan?.notes ?? "",
    mode: ctx.mode,
    athleteFirstName,
  });

  // Build moves, dropping empty. For new moves, try to resolve to a library move
  // so we can link via move_id and merge library defaults with voice notes.
  const moves = (slotted.moves ?? [])
    .filter((m) => m && (m.name?.trim() || m.matchExistingMoveId))
    .map((m) => {
      const targetFromVoice =
        typeof m.targetValue === "number" || Boolean(m.targetQuote?.trim());
      const lib = m.matchExistingMoveId
        ? null
        : resolveLibraryMove(m.name, ctx.library);

      return {
        matchExistingMoveId: m.matchExistingMoveId ?? undefined,
        libraryMoveId: lib?.id,
        // Prefer the library's canonical name when matched.
        name: (lib?.name ?? m.name ?? "").trim(),
        description: (m.description ?? "").trim(),
        cue: (m.cue ?? "").trim(),
        why: (m.why ?? "").trim(),
        targetKind: (m.targetKind ?? lib?.defaultTargetKind ?? "reps") as "reps" | "mins",
        targetValue:
          typeof m.targetValue === "number" && m.targetValue >= 0
            ? m.targetValue
            : lib?.defaultTargetValue ?? 10,
        targetFromVoice,
        sources: {
          name: m.nameQuote ?? undefined,
          description: m.descriptionQuote ?? undefined,
          cue: m.cueQuote ?? undefined,
          why: m.whyQuote ?? undefined,
          target: m.targetQuote ?? undefined,
        },
      };
    });

  // Notes existed before? Only mark "notes" as touched if cleanup actually changed it.
  const notesChanged = cleanedNotes !== (ctx.currentPlan?.notes ?? "");
  const notes = notesChanged ? cleanedNotes : undefined;

  return {
    title: slotted.title?.trim() || undefined,
    athleteId: athleteId ?? undefined,
    unresolvedAthleteName: unresolved,
    notes,
    moves,
    sources: {
      title: slotted.titleQuote ?? undefined,
      athleteName: slotted.athleteQuote ?? undefined,
      notes: notesChanged ? slotted.leftover ?? undefined : undefined,
    },
  };
}

/* ---------------- Apply draft to DB ---------------- */

export interface VoiceTouched {
  plan: { title?: boolean; athleteId?: boolean; notes?: boolean };
  /** plan_move id -> list of field names touched */
  moves: Record<string, string[]>;
  /** plan_move ids that were newly created by voice */
  newMoveIds: string[];
  /** verbatim transcript */
  transcript?: string;
  /** per-field source quotes from transcript */
  sources?: VoiceSources;
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
  const touched: VoiceTouched = {
    plan: {},
    moves: {},
    newMoveIds: [],
    transcript,
    sources: { plan: {}, moves: {} },
  };
  let workingPlanId = planId ?? "";

  const setPlanSource = (key: "title" | "athleteId" | "notes", quote?: string) => {
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
    if (draft.title) {
      touched.plan.title = true;
      setPlanSource("title", draft.sources?.title);
    }
    if (draft.athleteId) {
      touched.plan.athleteId = true;
      setPlanSource("athleteId", draft.sources?.athleteName);
    }
    if (draft.notes) {
      touched.plan.notes = true;
      setPlanSource("notes", draft.sources?.notes);
    }
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
      setPlanSource("title", draft.sources?.title);
    }
    if (draft.notes != null) {
      patch.notes = draft.notes;
      touched.plan.notes = true;
      setPlanSource("notes", draft.sources?.notes);
    }

    if (draft.athleteId && plan.kind === "plan") {
      patch.athlete_id = draft.athleteId;
      touched.plan.athleteId = true;
      setPlanSource("athleteId", draft.sources?.athleteName);
    }
    const { error: upErr } = await supabase
      .from("plans")
      .update(patch)
      .eq("id", workingPlanId)
      .eq("coach_id", coachId);
    if (upErr) dbError(upErr);
  }

  /* Apply moves */
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
      const { data: pm } = await supabase
        .from("plan_moves")
        .select("id, plan_id")
        .eq("id", m.matchExistingMoveId!)
        .eq("plan_id", workingPlanId)
        .maybeSingle();
      if (!pm) continue;

      // Non-destructive: only overwrite fields the slot pass actually filled.
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
      // For library-matched moves, fetch the canonical defaults and append voice content.
      let libRow: {
        description: string;
        cue: string;
        why: string;
        default_target_kind: "reps" | "mins";
        default_target_value: number;
      } | null = null;
      if (m.libraryMoveId) {
        const { data: lib } = await supabase
          .from("moves")
          .select("description, cue, why, default_target_kind, default_target_value")
          .eq("id", m.libraryMoveId)
          .eq("coach_id", coachId)
          .maybeSingle();
        if (lib) {
          libRow = {
            description: (lib.description as string) ?? "",
            cue: (lib.cue as string) ?? "",
            why: (lib.why as string) ?? "",
            default_target_kind: (lib.default_target_kind as "reps" | "mins") ?? "reps",
            default_target_value: Number(lib.default_target_value ?? 10),
          };
        }
      }

      const finalDescription = libRow
        ? mergeAppend(libRow.description, m.description)
        : m.description;
      const finalCue = libRow ? mergeAppend(libRow.cue, m.cue) : m.cue;
      const finalWhy = libRow ? mergeAppend(libRow.why, m.why) : m.why;
      const finalTargetKind = libRow && !m.targetFromVoice ? libRow.default_target_kind : m.targetKind;
      const finalTargetValue =
        libRow && !m.targetFromVoice ? libRow.default_target_value : m.targetValue;

      const { data: ins, error } = await supabase
        .from("plan_moves")
        .insert({
          plan_id: workingPlanId,
          move_id: m.libraryMoveId ?? null,
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
      // Only flag voice-touched fields as highlighted — library defaults shouldn't glow.
      const touchedFields: string[] = ["name"];
      if (m.description) touchedFields.push("description");
      if (m.cue) touchedFields.push("cue");
      if (m.why) touchedFields.push("why");
      if (m.targetFromVoice || !libRow) touchedFields.push("target");
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


/* ---------------- Public server function ---------------- */

export const voiceBuildPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error("Expected FormData");
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

    const transcript = await transcribeWithElevenLabs(data.audio);
    if (!transcript || transcript.length < 2) throw new Error("Didn't catch that — try again");

    const [{ data: rosterRows }, { data: libRows }] = await Promise.all([
      supabase
        .from("coach_athletes")
        .select("athlete_id, athletes!inner(id, first_name, last_name)")
        .eq("coach_id", coachId),
      supabase
        .from("moves")
        .select(
          "id, name, category, description, cue, why, default_target_kind, default_target_value",
        )
        .eq("coach_id", coachId)
        .is("archived_at", null),
    ]);

    const athletes = (rosterRows ?? []).map((row) => {
      const a = (row as unknown as {
        athletes: { id: string; first_name: string; last_name: string };
      }).athletes;
      return { id: a.id, name: `${a.first_name} ${a.last_name}`.trim() };
    });
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
