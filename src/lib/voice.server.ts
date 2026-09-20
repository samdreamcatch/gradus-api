import { z } from "zod";
import { doubleMetaphone } from "double-metaphone";
import { generateText, Output } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { dbError } from "./db-error";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import type { FieldSource, VoicePlanDraft, VoiceSources, VoiceTouched } from "./voice-types";

export const MAX_AUDIO_BYTES = 18 * 1024 * 1024; // 18 MB hard cap (~180s)
export const MAX_AUDIO_SECONDS = 180;

export type Client = SupabaseClient<Database>;

export async function getCoachId(supabase: Client, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) {
    throw new ApiError({ code: "unprocessable", status: 422, message: "Coach profile not found" });
  }
  return data.id;
}

/* ---------------- Transcription (ElevenLabs Scribe) ---------------- */

/**
 * The upload's filename, from its MIME type: browsers record WebM/Opus and
 * iOS records M4A/AAC (PRD §6.7), and the transcription service reads the
 * container from the name. Unknown or empty types keep the historical name.
 */
const AUDIO_FILENAMES: Record<string, string> = {
  "audio/mp4": "voice.m4a",
  "audio/x-m4a": "voice.m4a",
  "audio/m4a": "voice.m4a",
  "audio/aac": "voice.aac",
  "audio/mpeg": "voice.mp3",
  "audio/wav": "voice.wav",
  "audio/x-wav": "voice.wav",
  "audio/ogg": "voice.ogg",
  "audio/webm": "voice.webm",
};

export function audioFilename(audio: Blob): string {
  // A multipart part that arrived as a File keeps its filename; trust a known extension first.
  const named = (audio as { name?: unknown }).name;
  if (typeof named === "string") {
    const ext = named.split(".").pop()?.toLowerCase();
    if (ext && ["m4a", "mp4", "aac", "mp3", "wav", "ogg", "webm"].includes(ext)) {
      return `voice.${ext === "mp4" ? "m4a" : ext}`;
    }
  }
  const type = (audio.type || "").split(";")[0].trim().toLowerCase();
  return AUDIO_FILENAMES[type] ?? "voice.webm";
}

export async function transcribeWithElevenLabs(
  audio: Blob,
  vocabularyHints?: string[],
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Voice service not configured");

  const form = new FormData();
  form.append("file", audio, audioFilename(audio));
  form.append("model_id", "scribe_v2");
  form.append("language_code", "eng");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");

  if (vocabularyHints && vocabularyHints.length > 0) {
    form.append(
      "custom_vocabulary",
      JSON.stringify(vocabularyHints.map((content) => ({ content }))),
    );
  }

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
  const text = (json.text ?? "").trim();
  console.info(
    "[voice] transcript",
    JSON.stringify({ length: text.length, preview: text.slice(0, 200) }),
  );
  return text;
}

/* ---------------- Pass 1: Slotting ---------------- */

/*
 * Strict-compatible shapes: every property is declared and *nullable* rather
 * than optional, so the gateway can enforce the schema with a real
 * `json_schema` response format instead of hoping the model returns the right
 * shape. `.nullish()` here would serialize to an optional property, which
 * strict mode rejects.
 */
const slotMoveSchema = z.object({
  matchExistingMoveId: z
    .string()
    .nullable()
    .describe("Existing plan_move id if the coach is modifying it; else null."),
  name: z.string().nullable(),
  nameQuote: z.string().nullable().describe("Verbatim transcript phrase the name came from."),
  description: z.string().nullable(),
  descriptionQuote: z.string().nullable(),
  cue: z.string().nullable().describe("ONE short phrase the athlete can repeat."),
  cueQuote: z.string().nullable(),
  why: z.string().nullable().describe("ONE sentence on why this move matters."),
  whyQuote: z.string().nullable(),
  targetKind: z.enum(["reps", "mins"]).nullable(),
  targetValue: z.number().min(0).max(10000).nullable(),
  targetQuote: z.string().nullable(),
});

/** Retry shape: the same slots without the per-field source quotes. */
const slotMoveSchemaSimple = z.object({
  matchExistingMoveId: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  cue: z.string().nullable(),
  why: z.string().nullable(),
  targetKind: z.enum(["reps", "mins"]).nullable(),
  targetValue: z.number().min(0).max(10000).nullable(),
});

const slotSchema = z.object({
  title: z.string().nullable(),
  titleQuote: z.string().nullable(),
  athleteName: z
    .string()
    .nullable()
    .describe("RAW spoken athlete name as the coach said it (no id lookups)."),
  athleteQuote: z.string().nullable(),
  // Plain, unbounded array: Gemini's strict json_schema rejects a nullable
  // array that also carries `maxItems`, which fails the whole request with
  // "Request contains an invalid argument". Length is capped after salvage.
  moves: z.array(slotMoveSchema),
  leftover: z
    .string()
    .nullable()
    .describe("Verbatim transcript fragments NOT slotted anywhere — for downstream notes cleanup."),
});

const slotSchemaSimple = z.object({
  title: z.string().nullable(),
  athleteName: z.string().nullable(),
  moves: z.array(slotMoveSchemaSimple),
  leftover: z.string().nullable(),
});

export type SlotMove = z.infer<typeof slotMoveSchema>;
export type Slots = z.infer<typeof slotSchema>;

/* ---------------- Lenient salvage ---------------- */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
};

/**
 * Pull the first balanced JSON object out of a model answer that may be
 * wrapped in prose or a code fence.
 */
export function extractJsonObject(raw: string | undefined | null): unknown {
  if (!raw) return null;
  const text = raw.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Coerce whatever the model returned into our slot shape, field by field.
 * A malformed move is dropped on its own; it never discards the dictation.
 */
export function salvageSlots(value: unknown): Slots | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const rawMoves = Array.isArray(o.moves) ? o.moves : [];
  const moves: SlotMove[] = [];
  for (const entry of rawMoves.slice(0, 30)) {
    if (!entry || typeof entry !== "object") continue;
    const m = entry as Record<string, unknown>;
    const name = str(m.name);
    const matchExistingMoveId = str(m.matchExistingMoveId);
    if (!name && !matchExistingMoveId) continue;
    const kind = str(m.targetKind);
    moves.push({
      matchExistingMoveId,
      name,
      nameQuote: str(m.nameQuote),
      description: str(m.description),
      descriptionQuote: str(m.descriptionQuote),
      cue: str(m.cue),
      cueQuote: str(m.cueQuote),
      why: str(m.why),
      whyQuote: str(m.whyQuote),
      targetKind: kind === "mins" || kind === "reps" ? kind : null,
      targetValue: num(m.targetValue),
      targetQuote: str(m.targetQuote),
    });
  }
  const title = str(o.title);
  const athleteName = str(o.athleteName);
  const leftover = str(o.leftover);
  if (!title && !athleteName && !leftover && moves.length === 0) return null;
  return {
    title,
    titleQuote: str(o.titleQuote),
    athleteName,
    athleteQuote: str(o.athleteQuote),
    moves,
    leftover,
  };
}

export interface LibraryMove {
  id: string;
  name: string;
  category: string;
  description: string;
  cue: string;
  why: string;
  defaultTargetKind: "reps" | "mins";
  defaultTargetValue: number;
}

export interface ParseContext {
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

TRANSCRIPT: "Plan for Leon. He needs single axel landings about five times every session, then double salchow eight or so times working on the tempo of the entry, and his double toe four or five times — don't twist too early on the ice."
SLOTS: athleteName "Leon"; moves[0].name "Single axel landings", description "Land single axels cleanly.", targetKind "reps", targetValue 5; moves[1].name "Double salchow", description "Work on tempo of the entry.", cue "Hold the entry tempo", targetKind "reps", targetValue 8; moves[2].name "Double toe", description "Double toe loop reps.", cue "Don't twist too early", targetKind "reps", targetValue 5.

Cue = ONE short phrase. Why = ONE sentence. Don't lump everything into description. Every move needs a name.`;

export async function slotTranscript(
  ctx: ParseContext,
  variant: "full" | "simple" = "full",
  modelId = "google/gemini-3-flash-preview",
) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI not configured");
  const gateway = createLovableAiGatewayProvider(apiKey, { structuredOutputs: true });
  const model = gateway(modelId);

  const system = [
    "You convert a sports coach's spoken instructions into structured slots.",
    "Map every meaningful piece of the transcript into exactly one slot: title, athleteName, or a move field (name/description/cue/why/target).",
    variant === "full"
      ? "For EVERY filled field, also fill its *Quote field with the verbatim transcript phrase that produced it (a clean substring of the transcript, not paraphrased)."
      : "Keep it simple: fill the slots only. There are no quote fields in this shape.",
    "RULES:",
    "- Do NOT invent drills, names, or numbers the coach did not say.",
    "- athleteName is the RAW name spoken (e.g. 'Sarah'). Do NOT try to resolve IDs.",
    "- Cue = a SINGLE short repeatable phrase. Why = ONE sentence. Description = brief, what the athlete does.",
    "- targetKind: 'reps' for counted reps ('20 reps', 'ten swings'); 'mins' for time ('5 minutes').",
    "- Move target defaults: if unclear, 10 reps.",
    "- EVERY move MUST have a non-empty `name` — a short noun phrase (2-5 words) for the drill or skill, even if the coach didn't name it explicitly. Derive it from what they said (e.g. 'Double salchow reps', 'Single loop combination', 'Three-turn waltz pacing'). Never leave `name` null or empty.",
    "- Move name: if the spoken move name clearly matches a name in KNOWN MOVES, copy that KNOWN MOVES name exactly into the `name` field — do not paraphrase, pluralize, or reword it. Otherwise create a name from the coach's words.",
    "- Be generous: if the coach mentions a skill they want the athlete to practice (even briefly), create a move for it. A long dictation typically has 3-8 moves.",
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
        ? ctx.library
            .slice(0, 150)
            .map((m) => `- ${m.name} (${m.category})`)
            .join("\n")
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

  let slots: Slots | null = null;
  let rawText = "";
  let shapeError: string | null = null;

  try {
    const result = await generateText({
      model,
      system,
      prompt: promptParts.join("\n\n"),
      experimental_output: Output.object({
        schema: variant === "full" ? slotSchema : slotSchemaSimple,
      }),
    });
    rawText = result.text ?? "";
    try {
      slots = salvageSlots(result.experimental_output);
    } catch (e) {
      shapeError = (e as Error)?.message ?? "output did not match the schema";
    }
  } catch (e) {
    const err = e as { statusCode?: number; message?: string; text?: string };
    // A transport/quota failure has to bubble; only a shape failure is salvageable.
    if (typeof err.statusCode === "number") throw e;
    shapeError = err.message ?? "output did not match the schema";
    rawText = err.text ?? "";
  }

  // Last resort: read the raw answer ourselves, keeping every usable move.
  if (!slots) slots = salvageSlots(extractJsonObject(rawText));

  if (!slots) {
    console.error(
      "[voice] slot unusable",
      JSON.stringify({
        mode: ctx.mode,
        variant,
        transcriptLen: ctx.transcript.length,
        shapeError,
        rawPreview: rawText.slice(0, 600),
      }),
    );
    throw new Error("Couldn't structure that dictation");
  }

  console.info(
    "[voice] slot",
    JSON.stringify({
      mode: ctx.mode,
      variant,
      salvaged: Boolean(shapeError),
      title: slots.title,
      athleteName: slots.athleteName,
      moveCount: slots.moves?.length ?? 0,
      moveNames: (slots.moves ?? []).map((m) => m.name),
      leftoverLen: (slots.leftover ?? "").length,
    }),
  );
  return slots;
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

  for (const a of roster) {
    if (normalize(a.name) === q) return { id: a.id, unresolved: null };
  }
  const qFirst = q.split(" ")[0];
  for (const a of roster) {
    const first = normalize(a.name).split(" ")[0];
    if (first && first === qFirst) return { id: a.id, unresolved: null };
  }
  for (const a of roster) {
    const n = normalize(a.name);
    if (n.includes(q) || q.includes(n)) return { id: a.id, unresolved: null };
  }
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

const MOVE_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "for",
  "with",
  "drill",
  "drills",
  "practice",
]);

function moveTokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((w) => w && !MOVE_STOPWORDS.has(w))
    .map((w) => (w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w));
}

function resolveLibraryMove(
  spoken: string | null | undefined,
  library: LibraryMove[],
): LibraryMove | null {
  if (!spoken || !spoken.trim() || library.length === 0) return null;
  const q = normalize(spoken);
  if (!q) return null;

  // Pass 1: exact normalized name.
  for (const m of library) {
    if (normalize(m.name) === q) return m;
  }

  // Pass 2: substring containment either direction.
  for (const m of library) {
    const n = normalize(m.name);
    if (n.includes(q) || q.includes(n)) return m;
  }

  // Pass 3: Jaccard token overlap on non-stopword tokens; threshold ≥ 0.6.
  // Good for word-order variations: "crosscourt forehand" matches "forehand crosscourt".
  const qTokens = new Set(moveTokens(spoken));
  if (qTokens.size > 0) {
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
    if (best) return best.move;
  }

  // Pass 4: normalized Levenshtein distance on the full normalized name.
  // Catches accent-driven mishearings and single-character transcription errors.
  // e.g. "forhand" matches "forehand" (1 edit out of 8 chars = 0.875 score, above threshold).
  // Threshold: score ≥ 0.75 means at most 25% of characters may differ.
  let bestLev: { move: LibraryMove; score: number } | null = null;
  for (const m of library) {
    const n = normalize(m.name);
    const maxLen = Math.max(q.length, n.length);
    if (maxLen === 0) continue;
    const dist = levenshtein(q, n);
    const score = 1 - dist / maxLen;
    if (score >= 0.75 && (!bestLev || score > bestLev.score)) {
      bestLev = { move: m, score };
    }
  }
  if (bestLev) return bestLev.move;

  // Pass 5: Phonetic matching via Double Metaphone.
  const qWords = moveTokens(spoken);
  if (qWords.length > 0) {
    const qCodes = qWords.map((w) => doubleMetaphone(w));
    let bestPhonetic: { move: LibraryMove; score: number } | null = null;
    for (const m of library) {
      const mWords = moveTokens(m.name);
      if (mWords.length === 0) continue;
      const mCodes = mWords.map((w) => doubleMetaphone(w));
      let matched = 0;
      for (const [qPrimary, qSecondary] of qCodes) {
        for (const [mPrimary, mSecondary] of mCodes) {
          const hit =
            (qPrimary && mPrimary && qPrimary === mPrimary) ||
            (qPrimary && mSecondary && qPrimary === mSecondary) ||
            (qSecondary && mPrimary && qSecondary === mPrimary) ||
            (qSecondary && mSecondary && qSecondary === mSecondary);
          if (hit) {
            matched++;
            break;
          }
        }
      }
      const total = Math.max(qCodes.length, mCodes.length);
      const score = total === 0 ? 0 : matched / total;
      if (score >= 0.6 && (!bestPhonetic || score > bestPhonetic.score)) {
        bestPhonetic = { move: m, score };
      }
    }
    if (bestPhonetic) return bestPhonetic.move;
  }
  return null;
}

function mergeAppend(libraryValue: string, voiceValue: string): string {
  const lib = (libraryValue ?? "").trim();
  const voice = (voiceValue ?? "").trim();
  if (!voice) return lib;
  if (!lib) return voice;
  if (lib.toLowerCase().includes(voice.toLowerCase())) return lib;
  const libClean = /[.!?]$/.test(lib) ? lib : `${lib}.`;
  return `${libClean} ${voice}`;
}

/* ---------------- Quote location ---------------- */

function locateQuote(transcript: string, quote: string | null | undefined): FieldSource | null {
  if (!quote) return null;
  const q = quote.trim();
  if (!q) return null;
  const lower = transcript.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx >= 0) {
    return { quote: transcript.slice(idx, idx + q.length), start: idx, end: idx + q.length };
  }
  const tCollapsed = transcript.replace(/\s+/g, " ");
  const qCollapsed = q.replace(/\s+/g, " ");
  const cIdx = tCollapsed.toLowerCase().indexOf(qCollapsed.toLowerCase());
  if (cIdx >= 0) {
    return { quote: q, start: cIdx, end: cIdx + qCollapsed.length };
  }
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

export async function buildDraft(ctx: ParseContext): Promise<VoicePlanDraft> {
  let slotted;
  try {
    slotted = await slotTranscript(ctx);
  } catch (e) {
    const err = e as { statusCode?: number; message?: string };
    console.error(
      "[voice] slot failed",
      JSON.stringify({
        transcriptLen: ctx.transcript.length,
        statusCode: err.statusCode,
        message: err.message,
      }),
    );
    if (err.statusCode === 429) throw new Error("AI is busy — try again in a moment");
    if (err.statusCode === 402)
      throw new Error("AI credits exhausted — add credits in workspace settings");
    // Schema/parse failures are common on long dictations — retry once before
    // giving up, and never return a silent empty draft.
    try {
      // Short pause first — an immediate identical-timing retry tends to hit
      // the same bad generation. Then the reduced shape (no per-field source
      // quotes), so a long dictation gets a genuinely easier second chance.
      await new Promise((r) => setTimeout(r, 750));
      slotted = await slotTranscript(ctx, "simple");
    } catch (e2) {
      const err2 = e2 as { statusCode?: number; message?: string };
      console.error(
        "[voice] slot failed (retry)",
        JSON.stringify({ transcriptLen: ctx.transcript.length, message: err2.message }),
      );
      if (err2.statusCode === 429) throw new Error("AI is busy — try again in a moment");
      if (err2.statusCode === 402)
        throw new Error("AI credits exhausted — add credits in workspace settings");
      try {
        // Last chance on a different model before the coach loses the draft.
        await new Promise((r) => setTimeout(r, 750));
        slotted = await slotTranscript(ctx, "simple", "google/gemini-2.5-flash");
      } catch (e3) {
        const err3 = e3 as { statusCode?: number; message?: string };
        console.error(
          "[voice] slot failed (fallback model)",
          JSON.stringify({ transcriptLen: ctx.transcript.length, message: err3.message }),
        );
        if (err3.statusCode === 429) throw new Error("AI is busy — try again in a moment");
        if (err3.statusCode === 402)
          throw new Error("AI credits exhausted — add credits in workspace settings");
        // Do NOT throw here: throwing skips applyDraft, and with it the
        // `voice_transcript` write that keeps the coach's words on the plan.
        // Return the empty fallback flagged aiFailed so the transcript is
        // saved and the client can show an honest error instead of a success.
        return { moves: [], aiFailed: true };
      }
    }
  }

  const { id: athleteId, unresolved } = resolveAthlete(slotted.athleteName, ctx.athletes);
  const resolvedAthlete = athleteId ? (ctx.athletes.find((a) => a.id === athleteId) ?? null) : null;
  const athleteFirstName = resolvedAthlete ? (resolvedAthlete.name.split(" ")[0] ?? null) : null;

  const cleanedNotes = await cleanupNotes({
    leftover: slotted.leftover ?? "",
    existingNotes: ctx.currentPlan?.notes ?? "",
    mode: ctx.mode,
    athleteFirstName,
  });

  // Only trust an existing-move id that really is one of this plan's moves —
  // models sometimes invent slug-like ids ("double_axel").
  const currentMoveIds = new Set((ctx.currentPlan?.moves ?? []).map((m) => m.id));
  const rawMoves = (slotted.moves ?? []).map((m) => ({
    ...m,
    matchExistingMoveId:
      m.matchExistingMoveId && currentMoveIds.has(m.matchExistingMoveId)
        ? m.matchExistingMoveId
        : null,
  }));
  const keptMoves = rawMoves.filter((m) => m && (m.name?.trim() || m.matchExistingMoveId));
  const droppedCount = rawMoves.length - keptMoves.length;
  if (droppedCount > 0) {
    console.warn(
      "[voice] moves dropped (no name & no matchExistingMoveId)",
      JSON.stringify({ droppedCount, kept: keptMoves.length }),
    );
  }
  const moves = keptMoves.map((m) => {
    const targetFromVoice = typeof m.targetValue === "number" || Boolean(m.targetQuote?.trim());
    const lib = m.matchExistingMoveId ? null : resolveLibraryMove(m.name, ctx.library);

    return {
      matchExistingMoveId: m.matchExistingMoveId ?? undefined,
      libraryMoveId: lib?.id,
      name: (lib?.name ?? m.name ?? "").trim(),
      description: (m.description ?? "").trim(),
      cue: (m.cue ?? "").trim(),
      why: (m.why ?? "").trim(),
      targetKind: (m.targetKind ?? lib?.defaultTargetKind ?? "reps") as "reps" | "mins",
      targetValue:
        typeof m.targetValue === "number" && m.targetValue >= 0
          ? m.targetValue
          : (lib?.defaultTargetValue ?? 10),
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

  const notesChanged = cleanedNotes !== (ctx.currentPlan?.notes ?? "");
  const notes = notesChanged ? cleanedNotes : undefined;

  return {
    title: slotted.title?.trim() || undefined,
    athleteId: athleteId ?? undefined,
    unresolvedAthleteName: unresolved,
    notes,
    moves,
    droppedMoveCount: droppedCount > 0 ? droppedCount : undefined,
    sources: {
      title: slotted.titleQuote ?? undefined,
      athleteName: slotted.athleteQuote ?? undefined,
      notes: notesChanged ? (slotted.leftover ?? undefined) : undefined,
    },
  };
}

/* ---------------- Apply draft to DB ---------------- */

export interface ApplyResult {
  planId: string;
  transcript: string;
  touched: VoiceTouched;
  unresolvedAthleteName: string | null;
  appliedMoveCount: number;
  /** Moves the AI returned that we couldn't read, and skipped. */
  droppedMoveCount: number;
  /** The AI step failed; the transcript was saved on the plan but nothing was structured. */
  aiFailed: boolean;
}

export async function applyDraft(
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
    if (draft.athleteId) {
      touched.plan.athleteId = true;
      setPlanSource("athleteId", draft.sources?.athleteName);
    }
    if (draft.notes) {
      touched.plan.notes = true;
      setPlanSource("notes", draft.sources?.notes);
    }
  } else {
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
      voice_transcript?: string;
    } = { updated_at: new Date().toISOString(), voice_transcript: transcript };
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
      const finalTargetKind =
        libRow && !m.targetFromVoice ? libRow.default_target_kind : m.targetKind;
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

  console.info(
    "[voice] applied",
    JSON.stringify({
      mode,
      planId: workingPlanId,
      appliedMoveCount,
      draftMoveCount: draft.moves.length,
      unresolvedAthleteName: draft.unresolvedAthleteName ?? null,
    }),
  );

  return {
    planId: workingPlanId,
    transcript,
    touched,
    unresolvedAthleteName: draft.unresolvedAthleteName ?? null,
    appliedMoveCount,
    droppedMoveCount: draft.droppedMoveCount ?? 0,
    aiFailed: Boolean(draft.aiFailed),
  };
}

/* ---------------- Shared entry points (voice.functions.ts and /api/v1/voice) ---------------- */

export type VoiceContext = { userId: string; supabase: Client };

export function assertAudioSize(audio: Blob): void {
  if (audio.size > MAX_AUDIO_BYTES) {
    throw new ApiError({
      code: "payload_too_large",
      status: 413,
      message: "Recording too long — please keep voice notes under 3 minutes",
    });
  }
}

/** The transcription service's own failures become 503 `voice_unavailable`, message intact. */
async function transcribeOrFail(audio: Blob, vocabularyHints?: string[]): Promise<string> {
  try {
    return await transcribeWithElevenLabs(audio, vocabularyHints);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError({
      code: "voice_unavailable",
      status: 503,
      message: err instanceof Error ? err.message : "Couldn't transcribe that — please try again",
    });
  }
}

const didntCatchThat = () =>
  new ApiError({ code: "unprocessable", status: 422, message: "Didn't catch that — try again" });

/** `voiceTranscribe`: speech to text only (PRD §7.4 voice notes and dictation). */
export async function transcribeAudio(audio: Blob): Promise<{ text: string }> {
  assertAudioSize(audio);
  const transcript = await transcribeOrFail(audio);
  if (!transcript || transcript.length < 1) throw didntCatchThat();
  return { text: transcript };
}

export interface VoiceBuildData {
  audio: Blob;
  mode: "create" | "edit";
  planId?: string;
}

/**
 * `voiceBuildPlan`: transcribe with the coach's move names as vocabulary
 * hints, parse into a plan draft (create) or edits to the open plan (edit),
 * and apply it. The transcript is kept on the plan even when the AI step
 * fails (`aiFailed`).
 */
export async function buildPlanFromVoice(
  ctx: VoiceContext,
  data: VoiceBuildData,
): Promise<ApplyResult> {
  assertAudioSize(data.audio);
  const supabase = ctx.supabase;
  const coachId = await getCoachId(supabase, ctx.userId);

  const { data: libRows } = await supabase
    .from("moves")
    .select("id, name, category, description, cue, why, default_target_kind, default_target_value")
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
    transcribeOrFail(
      data.audio,
      library.map((m) => m.name),
    ),
    supabase
      .from("coach_athletes")
      .select("athlete_id, athletes!inner(id, first_name, last_name)")
      .eq("coach_id", coachId),
  ]);
  if (!transcript || transcript.length < 2) throw didntCatchThat();

  const athletes = (rosterRows ?? []).map((row) => {
    const a = (
      row as unknown as {
        athletes: { id: string; first_name: string; last_name: string };
      }
    ).athletes;
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
    if (!plan) throw new ApiError({ code: "not_found", status: 404, message: "Plan not found" });
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
}
