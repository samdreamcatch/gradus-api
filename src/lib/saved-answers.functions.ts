import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rethrowPlain } from "./api/errors";
import {
  deleteSavedAnswer as deleteSavedAnswerImpl,
  listSavedAnswers as listSavedAnswersImpl,
  saveAnswer as saveAnswerImpl,
  saveAnswerInput,
} from "./saved-answers.server";

// Re-export types so existing web imports keep working.
export type { SavedAnswerDTO } from "./saved-answers.server";

/*
 * Thin wrappers over the shared entry points in
 * src/lib/saved-answers.server.ts, shared with the `/api/v1/saved-answers*`
 * routes. Behavior and error messages are unchanged.
 */

export const listSavedAnswers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return await listSavedAnswersImpl({ userId: context.userId, supabase: context.supabase });
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const saveAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => saveAnswerInput.parse(data))
  .handler(async ({ data, context }) => {
    try {
      return await saveAnswerImpl({ userId: context.userId, supabase: context.supabase }, data);
    } catch (err) {
      rethrowPlain(err);
    }
  });

export const deleteSavedAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    try {
      return await deleteSavedAnswerImpl(
        { userId: context.userId, supabase: context.supabase },
        data.id,
      );
    } catch (err) {
      rethrowPlain(err);
    }
  });
