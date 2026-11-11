import { z } from "zod";
import type { CoachRatingsPageDTO } from "@/lib/coach-ratings.server";
import { planRatingSchema, planRatingSummarySchema } from "./plan-ratings-schema";

/** A coach's rating totals; `average` is null with no ratings. Same shape as a plan's. */
export const coachRatingSummarySchema = planRatingSummarySchema;

/** One rating of a coach (src/lib/coach-ratings.server.ts): the same shape as a plan rating. */
export const coachRatingSchema = planRatingSchema;

export const coachRatingsPageSchema = z.object({
  summary: coachRatingSummarySchema,
  myRating: coachRatingSchema.nullable().describe("The caller's own rating of this coach, if any."),
  canRate: z
    .boolean()
    .describe("Whether the caller may rate (or re-rate) this coach: they have worked with them."),
  canRespond: z.boolean().describe("Whether the caller is this coach, who may reply to ratings."),
  items: z.array(coachRatingSchema),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<CoachRatingsPageDTO>;
