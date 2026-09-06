import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getCoachAthleteAiSummary as getCoachAthleteAiSummaryShared,
  getCoachAthleteDetail as getCoachAthleteDetailShared,
  getOtherCoachPlanForMessage as getOtherCoachPlanForMessageShared,
} from "./coach-athlete-detail.server";

export type {
  AthleteActivityCountsDTO,
  AthleteGoalDTO,
  AthletePlanSummaryDTO,
  AthletePracticeTargetDTO,
  CoachAthleteAiSummaryDTO,
  CoachAthleteDetailDTO,
  CoachedSportDTO,
  OtherCoachDTO,
  OtherCoachMoveDTO,
  OtherCoachPlanDTO,
  OtherCoachPlanForMessageDTO,
  PlanStatus,
  Verdict,
} from "./coach-athlete-detail.server";

/*
 * Thin wrappers over src/lib/coach-athlete-detail.server.ts, shared with
 * `GET /api/v1/coach/athletes/{id}`, `.../ai-summary`, and
 * `GET /api/v1/coach/other-plans/{planId}`. Behavior is unchanged.
 */

async function detailContext(context: { userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId: context.userId, admin: supabaseAdmin };
}

export const getCoachAthleteDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ athleteId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) =>
    getCoachAthleteDetailShared(await detailContext(context), data.athleteId),
  );

export const getCoachAthleteAiSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ athleteId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) =>
    getCoachAthleteAiSummaryShared(await detailContext(context), data.athleteId),
  );

export const getOtherCoachPlanForMessage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) =>
    getOtherCoachPlanForMessageShared(await detailContext(context), data.planId),
  );
