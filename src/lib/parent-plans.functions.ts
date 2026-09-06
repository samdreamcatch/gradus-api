import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { rethrowPlain } from "./api/errors";
import { withServerErrorLogging } from "./server-error-middleware";
import * as shared from "./parent-plans.server";

/*
 * Thin wrappers over src/lib/parent-plans.server.ts, shared with
 * `GET /api/v1/parent/plans` and the role-aware `GET /api/v1/plans/{id}`.
 * Behavior and error messages are unchanged.
 */

export type {
  ParentAthleteOptionDTO,
  ParentPlanDetailDTO,
  ParentPlanMoveDTO,
  ParentPlanStatus,
  ParentPlanSummaryDTO,
  TargetKind,
} from "./parent-plans.server";

type Client = SupabaseClient<Database>;

async function ctxOf(context: {
  userId: string;
  supabase: unknown;
}): Promise<shared.ParentPlansContext> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, supabase: context.supabase as Client, admin: supabaseAdmin };
}

/* ---------------- list ---------------- */

export const listParentPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, withServerErrorLogging])
  .handler(async ({ context }) => {
    try {
      return await shared.listParentPlans(await ctxOf(context));
    } catch (err) {
      rethrowPlain(err);
    }
  });

/* ---------------- detail ---------------- */

export const getParentPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, withServerErrorLogging])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return { plan: await shared.getParentPlan(await ctxOf(context), data.id) };
    } catch (err) {
      rethrowPlain(err);
    }
  });
