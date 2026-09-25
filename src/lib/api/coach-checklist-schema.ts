/**
 * Zod schema for `GET /api/v1/coach/checklist`, mirroring `CoachChecklist`
 * in `coach-checklist.functions.ts` field for field (`satisfies` keeps them
 * honest) so the OpenAPI document and the generated Swift client carry the
 * real shape.
 */
import { z } from "zod";
import type { CoachChecklist } from "@/lib/coach-checklist.functions";

export const coachChecklistSchema = z.object({
  coachId: z.string().nullable(),
  scheduleDone: z.boolean().describe("Any lesson slot attached to this coach, whoever entered it."),
  scheduleFromFamilies: z
    .boolean()
    .describe("The schedule exists only because a connected family entered it."),
  inviteDone: z
    .boolean()
    .describe("At least one rostered athlete has been invited or already has an account."),
  planDone: z.boolean().describe("The coach has created at least one practice plan."),
}) satisfies z.ZodType<CoachChecklist>;
