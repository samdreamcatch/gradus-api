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
  /** The other end of a level range; null for a single level. */
  selectedLevelTo: z.string().nullable(),
  description: z.string().nullable(),
  /** Weeks it runs, practice sessions per week, and a Program's lessons; null when unset. */
  weeks: z.number().int().nullable(),
  sessionsPerWeek: z.number().int().nullable(),
  lessonCount: z.number().int().nullable(),
  /** Rating totals; `average` is null with no ratings. */
  rating: z.object({ average: z.number().nullable(), count: z.number() }),
  /** Cover to show: default artwork, or a signed link (an hour) to the coach's photo; null when none. */
  media: z.string().nullable(),
  /** When the coach made the plan. */
  createdAt: z.string(),
  updatedAt: z.string(),
  /** The plan's first move, a free sample of it; null when the plan has no moves. */
  sampleMove: z
    .object({
      name: z.string(),
      /** "reps" or "mins". */
      targetKind: z.string(),
      targetValue: z.number(),
      cue: z.string().nullable(),
      why: z.string().nullable(),
    })
    .nullable(),
  coach: z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    /** Finished identity verification: show the Verified badge. */
    verified: z.boolean(),
    /** A link (an hour) to their profile photo; null when they have none. */
    photoUrl: z.string().nullable(),
  }),
  /** The caller made this plan: show it, but no Buy button. */
  isOwn: z.boolean(),
});

export const marketplacePlansPageSchema = z.object({
  items: z.array(marketplacePlanSchema),
  nextCursor: z.string().nullable(),
});

/** `GET /api/v1/marketplace/coaches/{id}` (src/lib/marketplace-plans.server.ts `MarketplaceCoachDTO`). */
export const marketplaceCoachSchema = z.object({
  coach: z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    /** Finished identity verification: show the Verified badge. */
    verified: z.boolean(),
    /** A link (an hour) to their profile photo; null when they have none. */
    photoUrl: z.string().nullable(),
    /** The caller is this coach: they may change the photo. */
    isMe: z.boolean(),
    /** When they finished onboarding; null before that. */
    onboardedAt: z.string().nullable(),
    sports: z.array(z.string()),
    levels: z.array(z.object({ sport: z.string(), levelKey: z.string() })),
  }),
  /** Across all their active plans; `average` is null with no ratings. */
  rating: z.object({ average: z.number().nullable(), count: z.number() }),
  plans: z.array(marketplacePlanSchema),
});
