import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dbError } from "./db-error";

export type SavedAnswerDTO = {
  id: string;
  sport: string;
  question: string;
  answer: string;
  createdAt: string;
};

export const listSavedAnswers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SavedAnswerDTO[]> => {
    const { data, error } = await context.supabase
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
  });

export const saveAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        sport: z.string().min(1).max(64),
        question: z.string().trim().min(2).max(2000),
        answer: z.string().trim().min(1).max(20000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: row, error } = await context.supabase
      .from("parent_saved_answers")
      .insert({
        user_id: context.userId,
        sport: data.sport,
        question: data.question,
        answer: data.answer,
      })
      .select("id")
      .single();
    if (error) dbError(error);
    return { id: row!.id };
  });

export const deleteSavedAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("parent_saved_answers")
      .delete()
      .eq("id", data.id);
    if (error) dbError(error);
    return { ok: true };
  });
