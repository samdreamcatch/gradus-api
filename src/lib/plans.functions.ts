import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { ApiError, rethrowPlain } from "./api/errors";
import * as shared from "./plans.server";
import { skillReasonSchema } from "./skill-events.server";
import {
  addLibraryMovesInput,
  createPlanInput,
  listPlansInput,
  planMovePatch,
  reorderPlanMovesInput,
  savePlanInput,
  setPlanStatusInput,
  updatePlanPatch,
} from "./plans.server";

/*
 * Thin wrappers over src/lib/plans.server.ts, shared with the
 * `/api/v1/coach/plans` and `/api/v1/plans/{id}` routes. Behavior and error
 * messages are unchanged.
 */

export type {
  ActivationConflict,
  AthleteOptionDTO,
  LibraryMoveSnapshotDTO,
  PlanDetailDTO,
  PlanKind,
  PlanMoveDTO,
  PlanStatus,
  PlanSummaryDTO,
  TargetKind,
} from "./plans.server";
export { MAX_ACTIVE_PLANS_PER_ATHLETE } from "./plans.server";

type Client = SupabaseClient<Database>;

const ctxOf = (context: { userId: string; supabase: unknown }): shared.PlansContext => ({
  userId: context.userId,
  supabase: context.supabase as Client,
});

/** The plan status UI matches on this exact message. */
function rethrow(err: unknown): never {
  if (err instanceof ApiError && err.code === "bench_choice_required") {
    throw new Error("BENCH_CHOICE_REQUIRED");
  }
  rethrowPlain(err);
}

/* ---------------- roster ---------------- */

export const listCoachAthletes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return { athletes: await shared.listCoachAthletes(ctxOf(context)) };
    } catch (err) {
      rethrow(err);
    }
  });

/* ---------------- coach sports ---------------- */

export const listCoachSports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return { sports: await shared.listCoachSports(ctxOf(context)) };
    } catch (err) {
      rethrow(err);
    }
  });

/* ---------------- list plans ---------------- */

export const listPlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => listPlansInput.parse(input ?? {}))
  .handler(async ({ context, data }) => {
    try {
      return { plans: await shared.listPlans(ctxOf(context), data) };
    } catch (err) {
      rethrow(err);
    }
  });

/* ---------------- get plan ---------------- */

export const getPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return { plan: await shared.getPlan(ctxOf(context), data.id) };
    } catch (err) {
      rethrow(err);
    }
  });

/* ---------------- save plan ---------------- */

export const savePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => savePlanInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await shared.savePlan(ctxOf(context), data);
    } catch (err) {
      rethrow(err);
    }
  });

/* ---------------- status / delete / duplicate ---------------- */

export const getAthleteActivePlans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        athleteId: z.string().uuid(),
        excludePlanId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      return {
        plans: await shared.getAthleteActivePlans(
          ctxOf(context),
          data.athleteId,
          data.excludePlanId,
        ),
      };
    } catch (err) {
      rethrow(err);
    }
  });

export const setPlanStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid() }).merge(setPlanStatusInput).parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      const { id, ...rest } = data;
      return await shared.setPlanStatus(ctxOf(context), id, rest);
    } catch (err) {
      rethrow(err);
    }
  });

export const deletePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await shared.deletePlan(ctxOf(context), data.id);
    } catch (err) {
      rethrow(err);
    }
  });

export const createPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createPlanInput.parse(input ?? {}))
  .handler(async ({ context, data }) => {
    try {
      return await shared.createPlan(ctxOf(context), data);
    } catch (err) {
      rethrow(err);
    }
  });

/* ---------------- add move to plan ---------------- */

export const addMoveToPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ planId: z.string().uuid(), moveId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      return await shared.addMoveToPlan(ctxOf(context), data.planId, data.moveId);
    } catch (err) {
      rethrow(err);
    }
  });

/* ---------------- per-field plan updates ---------------- */

export const updatePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid() }).merge(updatePlanPatch).parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      const { id, ...patch } = data;
      return await shared.updatePlan(ctxOf(context), id, patch);
    } catch (err) {
      rethrow(err);
    }
  });

/* ---------------- per-move plan updates ---------------- */

export const updatePlanMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), patch: planMovePatch }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await shared.updatePlanMove(ctxOf(context), data.id, data.patch);
    } catch (err) {
      rethrow(err);
    }
  });

export const removePlanMove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), reason: skillReasonSchema.optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      return await shared.removePlanMove(
        ctxOf(context),
        data.id,
        undefined,
        new Date(),
        data.reason,
      );
    } catch (err) {
      rethrow(err);
    }
  });

export const reorderPlanMoves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ planId: z.string().uuid() }).merge(reorderPlanMovesInput).parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      return await shared.reorderPlanMoves(ctxOf(context), data.planId, data.orderedIds);
    } catch (err) {
      rethrow(err);
    }
  });

export const addLibraryMovesToPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ planId: z.string().uuid() }).merge(addLibraryMovesInput).parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      return await shared.addLibraryMovesToPlan(ctxOf(context), data.planId, data.moveIds);
    } catch (err) {
      rethrow(err);
    }
  });
