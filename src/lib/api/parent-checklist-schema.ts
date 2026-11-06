/**
 * Zod schema for `GET /api/v1/parent/checklist`, mirroring `ParentChecklist`
 * in `parent-checklist.functions.ts` field for field (`satisfies` keeps them
 * honest) so the OpenAPI document and the generated Swift client carry the
 * real shape.
 */
import { z } from "zod";
import type { ParentChecklist } from "@/lib/parent-checklist.functions";

export const parentChecklistSchema = z.object({
  parentId: z.string().nullable(),
  verifyApplies: z
    .boolean()
    .describe(
      "The adult-verification step is part of this parent's setup: the switch is on or KWS is configured.",
    ),
  verifyDone: z.boolean().describe("The parent is a verified adult (KWS, admin, or legacy)."),
  coachDone: z.boolean().describe("At least one coach is linked to one of the parent's athletes."),
  athleteCount: z.number().int().describe("How many athletes the parent has added."),
  goalsDone: z
    .boolean()
    .describe("At least one of the parent's athletes has a level and season goal on file."),
}) satisfies z.ZodType<ParentChecklist>;
