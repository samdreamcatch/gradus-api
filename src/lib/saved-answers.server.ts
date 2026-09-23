/**
 * A parent's saved Ask Gradus answers (PRD §7.9 "Resources and Ask
 * Gradus"): list, save, and delete rows in `parent_saved_answers`. Single
 * source of truth for saved-answers.functions.ts and the
 * `/api/v1/saved-answers*` routes. Extracted without behavior changes.
 *
 * `deleteSavedAnswer` has no explicit `.eq("user_id", ...)` filter — it
 * relies entirely on RLS to scope the delete to the caller's own rows, as
 * the pre-extraction code did. Kept as-is: adding an explicit filter here
 * would be a behavior change beyond a straight extraction.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dbError } from "./db-error";

type Client = SupabaseClient<Database>;

export type SavedAnswersContext = { userId: string; supabase: Client };

export type SavedAnswerSource = z.infer<typeof savedSourceSchema>;

export type SavedAnswerDTO = {
  id: string;
  sport: string;
  question: string;
  answer: string;
  createdAt: string;
  /** The answer's cited sources (L5); empty for answers saved before L5 or from the web. */
  sources: SavedAnswerSource[];
  /** Null when unknown (saved before L5 or from the web). */
  grounded: boolean | null;
  safety: boolean;
};

/** One cited source, as `POST /ask` returns it (PRD §6.7 item 6). */
export const savedSourceSchema = z.object({
  index: z.number().int().min(1).max(99),
  title: z.string().max(300),
  publisher: z.string().max(200),
  edition: z.string().max(120),
  section: z.string().max(300),
  page: z.number().int().nullable(),
  resourceId: z.string().uuid().nullable(),
  externalUrl: z.string().max(2000).nullable(),
});

/**
 * The migration adding `sources`/`grounded`/`safety` (20260922200000) is
 * applied after the code publishes, so both paths fall back to the old
 * columns when the new ones don't exist yet (Postgres 42703 undefined
 * column, PostgREST PGRST204/PGRST200 not in the schema cache).
 */
function missingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column .* does not exist|schema cache/i.test(error.message ?? "")
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = { from: (table: string) => any };

export async function listSavedAnswers(ctx: SavedAnswersContext): Promise<SavedAnswerDTO[]> {
  const loose = ctx.supabase as unknown as Loose;
  let res = await loose
    .from("parent_saved_answers")
    .select("id, sport, question, answer, created_at, sources, grounded, safety")
    .order("created_at", { ascending: false });
  if (missingColumn(res.error)) {
    res = await loose
      .from("parent_saved_answers")
      .select("id, sport, question, answer, created_at")
      .order("created_at", { ascending: false });
  }
  if (res.error) dbError(res.error);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((res.data ?? []) as any[]).map((r) => {
    const parsed = z.array(savedSourceSchema).safeParse(r.sources ?? []);
    return {
      id: r.id,
      sport: r.sport,
      question: r.question,
      answer: r.answer,
      createdAt: r.created_at,
      sources: parsed.success ? parsed.data : [],
      grounded: typeof r.grounded === "boolean" ? r.grounded : null,
      safety: r.safety === true,
    };
  });
}

export const saveAnswerInput = z.object({
  sport: z.string().min(1).max(64),
  question: z.string().trim().min(2).max(2000),
  answer: z.string().trim().min(1).max(20000),
  /** The answer's sources, grounded and safety flags from `POST /ask` (L5); optional, the web sends none. */
  sources: z.array(savedSourceSchema).max(12).optional(),
  grounded: z.boolean().optional(),
  safety: z.boolean().optional(),
});

export async function saveAnswer(
  ctx: SavedAnswersContext,
  data: z.infer<typeof saveAnswerInput>,
): Promise<{ id: string }> {
  const base = {
    user_id: ctx.userId,
    sport: data.sport,
    question: data.question,
    answer: data.answer,
  };
  const extra =
    data.sources !== undefined || data.grounded !== undefined || data.safety !== undefined
      ? {
          sources: data.sources ?? [],
          grounded: data.grounded ?? null,
          safety: data.safety ?? false,
        }
      : null;
  const loose = ctx.supabase as unknown as Loose;
  const insert = (row: Record<string, unknown>) =>
    loose.from("parent_saved_answers").insert(row).select("id").single();
  let res = await insert(extra ? { ...base, ...extra } : base);
  if (extra && missingColumn(res.error)) res = await insert(base);
  if (res.error) dbError(res.error);
  return { id: res.data!.id as string };
}

export async function deleteSavedAnswer(
  ctx: SavedAnswersContext,
  id: string,
): Promise<{ ok: true }> {
  const { error } = await ctx.supabase.from("parent_saved_answers").delete().eq("id", id);
  if (error) dbError(error);
  return { ok: true };
}
