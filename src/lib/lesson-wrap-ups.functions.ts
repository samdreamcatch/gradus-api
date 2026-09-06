import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getPendingLessonWrapUps as getPendingLessonWrapUpsShared,
  pendingWrapUpsInput,
  recordLessonWrapUp as recordLessonWrapUpShared,
  recordWrapUpInput,
  type WrapUpClient as Client,
} from "./lesson-wrap-ups.server";

export type { PendingWrapUp, WrapUpAction } from "./lesson-wrap-ups.server";

/*
 * Thin wrappers over src/lib/lesson-wrap-ups.server.ts, shared with
 * `GET /api/v1/coach/wrap-ups/pending` and `POST /api/v1/coach/wrap-ups`.
 * Behavior is unchanged.
 */

export const getPendingLessonWrapUps = createServerFn({ method: "POST" })
  .validator((input) => pendingWrapUpsInput.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) =>
    getPendingLessonWrapUpsShared(
      { userId: context.userId, supabase: context.supabase as Client },
      data,
    ),
  );

export const recordLessonWrapUp = createServerFn({ method: "POST" })
  .validator((input) => recordWrapUpInput.parse(input))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) =>
    recordLessonWrapUpShared(
      { userId: context.userId, supabase: context.supabase as Client },
      data,
    ),
  );
