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

export type SavedAnswerDTO = {
  id: string;
  sport: string;
  question: string;
  answer: string;
  createdAt: string;
};

export async function listSavedAnswers(ctx: SavedAnswersContext): Promise<SavedAnswerDTO[]> {
  const { data, error } = await ctx.supabase
    .from("parent_saved_answers")
    .select("id, sport, question, answer, created_at")
    .order("created_at", { ascending: false });
  if (error) dbError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    sport: r.sport,
    question: r.question,
    answer: r.answer,
    createdAt: r.created_at,
  }));
}

export const saveAnswerInput = z.object({
  sport: z.string().min(1).max(64),
  question: z.string().trim().min(2).max(2000),
  answer: z.string().trim().min(1).max(20000),
});

export async function saveAnswer(
  ctx: SavedAnswersContext,
  data: z.infer<typeof saveAnswerInput>,
): Promise<{ id: string }> {
  const { data: row, error } = await ctx.supabase
    .from("parent_saved_answers")
    .insert({
      user_id: ctx.userId,
      sport: data.sport,
      question: data.question,
      answer: data.answer,
    })
    .select("id")
    .single();
  if (error) dbError(error);
  return { id: row!.id };
}

export async function deleteSavedAnswer(
  ctx: SavedAnswersContext,
  id: string,
): Promise<{ ok: true }> {
  const { error } = await ctx.supabase.from("parent_saved_answers").delete().eq("id", id);
  if (error) dbError(error);
  return { ok: true };
}
