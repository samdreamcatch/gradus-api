import { z } from "zod";
import type { PlanRatingDTO, PlanRatingsPageDTO } from "@/lib/plan-ratings.server";

/** A plan's rating totals; `average` is null with no ratings. */
export const planRatingSummarySchema = z.object({
  average: z.number().nullable(),
  count: z.number(),
});

/** One rating (src/lib/plan-ratings.server.ts `PlanRatingDTO`). */
export const planRatingSchema = z.object({
  id: z.string(),
  rating: z.number(),
  review: z.string().nullable(),
  reviewer: z.object({
    name: z.string().describe('First name and last initial, e.g. "Greta S."'),
    role: z.enum(["athlete", "parent"]),
  }),
  coachResponse: z.string().nullable(),
  coachRespondedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<PlanRatingDTO>;

export const planRatingsPageSchema = z.object({
  summary: planRatingSummarySchema,
  myRating: planRatingSchema.nullable().describe("The caller's own rating of this plan, if any."),
  canRate: z.boolean().describe("Whether the caller may rate (or re-rate) this plan."),
  canRespond: z
    .boolean()
    .describe("Whether the caller is the plan's coach, who may reply to ratings."),
  items: z.array(planRatingSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<PlanRatingsPageDTO>;
