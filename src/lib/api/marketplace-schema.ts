import { z } from "zod";

/** One listing (src/lib/marketplace-plans.server.ts `MarketplacePlanDTO`). */
export const marketplacePlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["plan", "template"]),
  moveCount: z.number(),
  /** USD; 0 is free. */
  price: z.number(),
  /** "plan" or "program"; null on plans made before it existed. */
  productType: z.enum(["plan", "program"]).nullable(),
  /** The level the plan is for; null on older plans. */
  selectedLevel: z.string().nullable(),
  description: z.string().nullable(),
  /** Rating totals; `average` is null with no ratings. */
  rating: z.object({ average: z.number().nullable(), count: z.number() }),
  updatedAt: z.string(),
  coach: z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
  }),
});

export const marketplacePlansPageSchema = z.object({
  items: z.array(marketplacePlanSchema),
  nextCursor: z.string().nullable(),
});
