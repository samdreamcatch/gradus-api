/**
 * AI drafts for a new move (PRD decision #53, §7.3 "Move library"): from the
 * move's name and sport, suggest a description, a cue and a "why" (and a
 * category when the coach has not picked one). Writes nothing; the client
 * fills only the fields the coach left empty and marks the AI-written ones.
 * Coach-only: athletes have no personal library. Single source of truth for
 * `draftMove` in moves.functions.ts and `POST /api/v1/coach/moves/draft`.
 *
 * Lookup order (Mariah, 2026-10-11):
 *   1. the Gradus library: a `seed_moves` row of this sport with the same
 *      name answers with its own text, and no AI call;
 *   2. the open exercise list: a matching exercise's facts (never its text,
 *      see exercise-list/SOURCES.md) go to the model as a reference it must
 *      confirm is the same move in this sport;
 *   3. the recognition check: Claude Haiku 5.5, which may search the web
 *      (move-draft-claude.server.ts), else Gemini without the web (below).
 *      Only a move the model recognises gets a draft. "unsure" and
 *      "unknown" come back empty with a 200, never a guess, and the coach
 *      can add a hint and try again.
 *
 * One limit per coach (`DRAFT_RATE_LIMIT`) covers both entry points, and
 * one deadline (`DRAFT_BUDGET_MS`) covers every model call in a draft, so
 * the apps' request never outlives their own timeout.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateObject } from "ai";
import type { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "./api/errors";
import { checkRateLimit, type RateLimitConfig } from "./api/rate-limit";
import { isSportKey } from "./coach-sports";
import { dbError } from "./db-error";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";
import { PROMPT_INJECTION_GUARD } from "./ai-prompt-safety";
import { exerciseIndex, type ExerciseFacts } from "./exercise-list/exercise-list.server";
import {
  DRAFT_LIMITS,
  moveBrief,
  recognitionRules,
  referenceRuling,
  writingRules,
  type MoveRecognition,
  type MoveRecognitionInput,
  type MoveRecognizer,
  type SeedMove,
} from "./move-draft-brief.server";
import { claudeFromEnv, claudeRecognizer, type ClaudeMessages } from "./move-draft-claude.server";
import { sameMoveName } from "./move-name-match";
import { requirePlansCoach } from "./plan-detail.server";

export { DRAFT_LIMITS };
export type {
  MoveRecognition,
  MoveRecognitionInput,
  MoveRecognitionResult,
  MoveRecognizer,
} from "./move-draft-brief.server";

type Client = SupabaseClient<Database>;
type Admin = typeof supabaseAdmin;

/** `admin` keeps the draft limit's count. */
export type MoveDraftContext = { userId: string; supabase: Client; admin: Admin };

/** Where a draft's text came from: decision #53's three steps. */
export type MoveDraftSource = "gradus_library" | "exercise_list" | "ai";

export interface MoveDraftDTO {
  description: string;
  cue: string;
  why: string;
  /** Only when the request carried no category. */
  category?: string;
  /** For logs and evals; the apps don't show it. */
  source?: MoveDraftSource;
  /** The library move or exercise-list entry the draft rests on. */
  sourceName?: string;
  /** "unsure" and "unknown" come with empty description, cue and why. */
  recognition?: MoveRecognition;
  /** One line: what the model took the move to be. For logs and evals. */
  understoodAs?: string;
}

const MODEL = "google/gemini-2.5-flash";
const UNAVAILABLE = "AI drafting isn't available right now.";

/**
 * Drafts per coach per hour, the API route and the web function together:
 * a draft may be a paid AI call. Gradus library answers count too.
 */
export const DRAFT_RATE_LIMIT: RateLimitConfig = { windowSeconds: 3600, max: 30 };
const RATE_LIMIT_ROUTE = "coach-moves-draft";

/**
 * The whole draft's time, from the request to the last model call: well
 * inside the iOS app's 60 s request timeout. Claude gets two thirds of
 * what's left when step 3 starts, Gemini the rest.
 */
export const DRAFT_BUDGET_MS = 28_000;

// Empty strings and unknown sports pass here so they are the handler's 422, not a 400.
export const moveDraftInput = z.object({
  name: z.string().max(160),
  sport: z.string().max(64),
  category: z.string().max(64).optional(),
  /** The coach's few words about the move, after an "unsure" or "unknown". */
  hint: z.string().max(200).optional(),
  existing: z
    .object({
      description: z.string().max(2000).optional(),
      cue: z.string().max(1000).optional(),
      why: z.string().max(1000).optional(),
    })
    .optional(),
});

export type MoveDraftInput = z.infer<typeof moveDraftInput>;

export type MoveDraftGenerate = (args: {
  model: unknown;
  schema: z.ZodTypeAny;
  prompt: string;
  abortSignal?: AbortSignal;
}) => Promise<{ object: unknown }>;

async function defaultGenerate(args: {
  model: unknown;
  schema: z.ZodTypeAny;
  prompt: string;
  abortSignal?: AbortSignal;
}): Promise<{ object: unknown }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { object } = await generateObject(args as any);
  return { object };
}

export type MoveDraftDeps = {
  /** The Gemini call. */
  generate?: MoveDraftGenerate;
  /** Defaults to `process.env.LOVABLE_API_KEY`. */
  apiKey?: string | null;
  /** Defaults to a client from `process.env.ANTHROPIC_API_KEY`; null skips Claude. */
  claude?: ClaudeMessages | null;
  /** Replaces step 3 outright. */
  recognize?: MoveRecognizer;
  /** Defaults to `DRAFT_BUDGET_MS`; tests shorten it. */
  budgetMs?: number;
};

const unprocessable = (message: string) =>
  new ApiError({ code: "unprocessable", status: 422, message });
const aiUnavailable = () =>
  new ApiError({ code: "ai_unavailable", status: 503, message: UNAVAILABLE });
// Code and Retry-After as the route limiter's 429; the web shows the message.
const tooManyDrafts = (retryAfterSeconds: number) =>
  new ApiError({
    code: "rate_limited",
    status: 429,
    message: "Too many drafts for now. Try again later.",
    details: { retryAfterSeconds },
  });

/**
 * A failed AI call as it is logged: name, message and status only. The
 * error itself can carry the request body, with the coach's words in it.
 */
function failure(err: unknown): { name: string; message: string; status?: number } {
  const e = (err ?? {}) as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const status = [e.statusCode, e.status].find((v): v is number => typeof v === "number");
  return {
    name: typeof e.name === "string" ? e.name : typeof err,
    message: typeof e.message === "string" ? e.message.slice(0, 200) : "",
    ...(status === undefined ? {} : { status }),
  };
}

// No length caps: a long reply is clipped below rather than failing the call.
const recognitionSchema = z.object({
  recognition: z.enum(["known", "unsure", "unknown"]),
  understoodAs: z.string(),
  description: z.string(),
  cue: z.string(),
  why: z.string(),
  category: z.string(),
});

// With exercise-list references, the same call rules on them first.
const referenceSchema = recognitionSchema.extend({
  referenceMatches: z.boolean(),
  referenceName: z.string(),
});

/** Trims each line, drops blank ones, and collapses runs of spaces. */
function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Fits `s` in `max` characters: whole sentences when one ends past the
 * halfway mark, otherwise whole words with an ellipsis.
 */
export function clipText(input: string, max: number): string {
  const s = tidy(input);
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const ends = [...head.matchAll(/[.!?](?=\s|$)/g)].map((m) => (m.index ?? 0) + 1);
  const lastEnd = ends.at(-1);
  if (lastEnd && lastEnd >= max / 2) return head.slice(0, lastEnd).trim();
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trim()}…`;
}

/** A cue is one line, without the quotation marks models like to add. */
function oneLine(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .trim();
}

async function requireCoachProfile(ctx: MoveDraftContext): Promise<void> {
  // 403 for parents and athletes, like every coach move route.
  await requirePlansCoach(ctx);
  // A role-less user passes that check; a paid AI call needs a real coach.
  const { data, error } = await ctx.supabase
    .from("coach_profiles")
    .select("id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) dbError(error);
  if (!data) throw unprocessable("Coach profile not found");
}

/**
 * The seeded curriculum for this sport: step 1's lookup, and the model's
 * guide to tone, length and category names. Best effort: a failed read
 * goes straight to the AI steps.
 */
async function loadCurriculum(supabase: Client, sport: string): Promise<SeedMove[]> {
  try {
    const { data, error } = await supabase
      .from("seed_moves")
      .select("name, category, description, cue, why")
      .eq("sport", sport)
      .limit(500);
    if (error) {
      console.error("[move-draft] seed_moves read failed", error.message);
      return [];
    }
    return (data ?? []) as SeedMove[];
  } catch (err) {
    console.error("[move-draft] seed_moves read failed", err);
    return [];
  }
}

/* ------------------------------------- step 3 without the web: Gemini */

export function buildMoveDraftPrompt(args: MoveRecognitionInput): string {
  const brief = moveBrief(args);
  const first = brief.hasReferences
    ? `${referenceRuling(
        brief.sportLabel,
        "referenceName",
        "- referenceMatches: true only when it is the same move; otherwise false.",
      )}\n\nThen, whether you recognise the move:`
    : `First, whether you recognise the move:`;

  return `${PROMPT_INJECTION_GUARD}

You are an experienced coach helping another coach write up one move (a drill, skill or exercise) in ${brief.sportLabel} for their move library. Their athletes read it on a phone before and during practice.

${brief.details}
${first}
${recognitionRules(brief.sportLabel)}

Only when "known", write:
${brief.fieldTasks}

Rules:
${writingRules(brief.sportLabel)}`;
}

/**
 * Step 3 on the Lovable AI Gateway (Gemini, no web): one call that rules on
 * any references and then on the move itself. Claude's fallback, and the
 * whole step when ANTHROPIC_API_KEY is unset. 503 `ai_unavailable` when the
 * key is missing, the draft's deadline has passed or passes mid-call, or the
 * call fails or answers the wrong shape.
 */
export function gatewayRecognizer(
  deps: Pick<MoveDraftDeps, "generate" | "apiKey"> = {},
): MoveRecognizer {
  return async (input) => {
    const apiKey = deps.apiKey === undefined ? process.env.LOVABLE_API_KEY : deps.apiKey;
    if (!apiKey) {
      console.error("[move-draft] LOVABLE_API_KEY not set");
      throw aiUnavailable();
    }
    const left = input.deadline === undefined ? undefined : input.deadline - Date.now();
    if (left !== undefined && left <= 0) {
      console.warn("[move-draft] no time left for Gemini");
      throw aiUnavailable();
    }
    const references = input.references ?? [];
    const schema = references.length ? referenceSchema : recognitionSchema;
    const generate = deps.generate ?? defaultGenerate;
    const gateway = createLovableAiGatewayProvider(apiKey);
    let raw: z.infer<typeof referenceSchema>;
    try {
      const { object } = await generate({
        model: gateway(MODEL),
        schema,
        prompt: buildMoveDraftPrompt(input),
        abortSignal: left === undefined ? undefined : AbortSignal.timeout(left),
      });
      raw = references.length
        ? referenceSchema.parse(object)
        : { ...recognitionSchema.parse(object), referenceMatches: false, referenceName: "" };
    } catch (err) {
      console.error("[move-draft] generate failed", failure(err));
      throw aiUnavailable();
    }
    const named = raw.referenceName.trim();
    const reference = raw.referenceMatches
      ? (references.find(
          (r) => named && [r.name, ...(r.aliases ?? [])].some((n) => sameMoveName(n, named)),
        ) ?? (references.length === 1 ? references[0] : undefined))
      : undefined;
    return {
      recognition: raw.recognition,
      understoodAs: raw.understoodAs,
      matchedReference: reference?.name,
      fields: { description: raw.description, cue: raw.cue, why: raw.why, category: raw.category },
    };
  };
}

/** Claude with web search when its key is set, falling back to Gemini; else Gemini. */
function defaultRecognizer(deps: MoveDraftDeps): MoveRecognizer {
  const gemini = gatewayRecognizer(deps);
  const claude = deps.claude === undefined ? claudeFromEnv() : deps.claude;
  return claude ? claudeRecognizer({ client: claude, fallback: gemini }) : gemini;
}

/* ------------------------------------------------------ the pipeline */

/** Step 1: a library move of this sport with the same name and words of its own. */
function libraryMove(curriculum: SeedMove[], name: string): SeedMove | null {
  return (
    curriculum.find(
      (s) =>
        (s.description?.trim() || s.cue?.trim() || s.why?.trim()) && sameMoveName(s.name, name),
    ) ?? null
  );
}

/** Step 2: the exercise with this name, else up to three close ones for the model to rule on. */
function exerciseReferences(name: string): ExerciseFacts[] {
  const { exact, candidates } = exerciseIndex().match(name);
  return exact ? [exact] : candidates;
}

/**
 * `draftMove`: nothing written. 403 for parents and athletes, 422 for an
 * empty name, or a sport that is empty or not a sport key, 429
 * `rate_limited` past `DRAFT_RATE_LIMIT`, 503 `ai_unavailable` when step 3
 * is needed and no model can answer in time (no keys, both providers down,
 * the deadline passed) or a recognised move comes back empty. A library
 * match never calls the AI.
 */
export async function draftMove(
  ctx: MoveDraftContext,
  input: MoveDraftInput,
  deps: MoveDraftDeps = {},
): Promise<MoveDraftDTO> {
  const deadline = Date.now() + (deps.budgetMs ?? DRAFT_BUDGET_MS);
  await requireCoachProfile(ctx);

  const name = input.name.trim();
  const typedSport = input.sport.trim();
  if (!name) throw unprocessable("Name the move first.");
  if (!typedSport) throw unprocessable("Pick a sport first.");
  // Older library rows can hold a sport's label ("Figure Skating"), read as its key.
  const sport = isSportKey(typedSport) ? typedSport : typedSport.toLowerCase().replace(/\s+/g, "_");
  // The sport reaches the prompt: only a built-in key or a custom one's shape.
  if (!isSportKey(sport)) throw unprocessable("Pick one of your sports first.");
  const category = (input.category ?? "").trim();

  // Per coach, never per IP: the web function and the API share this count.
  const limit = await checkRateLimit(ctx.admin, DRAFT_RATE_LIMIT, {
    route: RATE_LIMIT_ROUTE,
    ip: null,
    userId: ctx.userId,
  });
  if (!limit.allowed) throw tooManyDrafts(limit.retryAfterSeconds);

  const curriculum = await loadCurriculum(ctx.supabase, sport);

  // 1. The Gradus library answers in its own words.
  const seed = libraryMove(curriculum, name);
  if (seed) {
    const fromLibrary: MoveDraftDTO = {
      description: tidy(seed.description ?? ""),
      cue: tidy(seed.cue ?? ""),
      why: tidy(seed.why ?? ""),
      source: "gradus_library",
      sourceName: seed.name,
      recognition: "known",
    };
    if (!category && seed.category?.trim()) fromLibrary.category = seed.category.trim();
    return fromLibrary;
  }

  // 2 and 3. The exercise list's facts, when any might fit, then the recognition check.
  const references = exerciseReferences(name);
  const recognize = deps.recognize ?? defaultRecognizer(deps);
  // `result.sources` stays here: the recogniser logs it, the response never carries it.
  const result = await recognize({
    name,
    sport,
    category,
    hint: input.hint?.trim() || undefined,
    existing: input.existing,
    references,
    curriculum,
    deadline,
  });

  const matched = result.matchedReference;
  const reference = matched ? references.find((r) => sameMoveName(r.name, matched)) : undefined;
  const understoodAs = clipText(oneLine(result.understoodAs ?? ""), DRAFT_LIMITS.understoodAs);
  if (result.recognition !== "known") {
    // Never a guess, even with a reference it named: empty fields, and the
    // coach can add a hint and try again.
    const unrecognised: MoveDraftDTO = {
      description: "",
      cue: "",
      why: "",
      source: "ai",
      recognition: result.recognition,
    };
    if (understoodAs) unrecognised.understoodAs = understoodAs;
    return unrecognised;
  }

  const draft: MoveDraftDTO = {
    description: clipText(result.fields.description, DRAFT_LIMITS.description),
    cue: clipText(oneLine(result.fields.cue), DRAFT_LIMITS.cue),
    why: clipText(oneLine(result.fields.why), DRAFT_LIMITS.why),
    source: reference ? "exercise_list" : "ai",
    recognition: "known",
  };
  if (!draft.description && !draft.cue && !draft.why) {
    console.error("[move-draft] empty reply");
    throw aiUnavailable();
  }
  if (reference) draft.sourceName = reference.name;
  if (understoodAs) draft.understoodAs = understoodAs;
  const suggested = oneLine(result.fields.category).slice(0, DRAFT_LIMITS.category).trim();
  if (!category && suggested) draft.category = suggested;
  return draft;
}
