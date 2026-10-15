import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import * as shared from "./plan-sessions.server";
import { submitSessionFields, withSessionChecks } from "./plan-sessions.server";

/*
 * Thin wrappers over src/lib/plan-sessions.server.ts, shared with the
 * `/api/v1/plans/{id}/sessions` routes. Behavior and error messages are
 * unchanged.
 */

export type {
  PlanSessionEntry,
  PlanSessionLogDTO,
  PlanSessionsSummaryDTO,
} from "./plan-sessions.server";
export { emptySessionsByState, loadSessionsByPlanIds } from "./plan-sessions.server";

type Client = SupabaseClient<Database>;

async function ctxOf(context: {
  userId: string;
  supabase: unknown;
}): Promise<shared.SessionsContext> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, supabase: context.supabase as Client, admin: supabaseAdmin };
}

const planIdInput = (input: unknown) => z.object({ planId: z.string().uuid() }).parse(input);

/** Coach + parent detail: counts for a single plan. */
export const getPlanSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(planIdInput)
  .handler(async ({ context, data }) => {
    try {
      return await shared.getPlanSessionCounts(context.supabase as Client, data.planId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/**
 * Coach + parent + athlete detail: the individual logged sessions for one
 * plan, with who logged each one. RLS scopes what each role can read.
 */
export const listPlanSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(planIdInput)
  .handler(async ({ context, data }) => {
    try {
      return await shared.listPlanSessions(await ctxOf(context), data.planId);
    } catch (err) {
      rethrowPlain(err);
    }
  });

const submitInput = (input: unknown) =>
  withSessionChecks(z.object({ planId: z.string().uuid() }).merge(submitSessionFields)).parse(
    input,
  );

/** Parent-only: submit a session from the feedback modal. */
export const submitPlanSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(submitInput)
  .handler(async ({ context, data }) => {
    try {
      const { planId, ...rest } = data;
      return await shared.submitPlanSessionAsParent(await ctxOf(context), planId, rest);
    } catch (err) {
      rethrowPlain(err);
    }
  });

/** Athlete-only: submit a session for one of the signed-in athlete's plans. */
export const submitAthletePlanSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(submitInput)
  .handler(async ({ context, data }) => {
    try {
      const { planId, ...rest } = data;
      return await shared.submitPlanSessionAsAthlete(await ctxOf(context), planId, rest);
    } catch (err) {
      rethrowPlain(err);
    }
  });

// --- AI summary of logged sessions for a single plan ---

export const getPlanSessionsSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(planIdInput)
  .handler(async ({ context, data }) => {
    try {
      return await shared.getPlanSessionsSummary(await ctxOf(context), data.planId);
    } catch (err) {
      rethrowPlain(err);
    }
  });
