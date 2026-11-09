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
    /** Their Stripe payouts are set up; until then nobody can buy their plans. */
    canSell: z.boolean(),
  }),
  /** The caller made this plan: show it, but no Buy button. */
  isOwn: z.boolean(),
  /** The caller's purchases of this listing (an athlete's own, or a parent's per child); `planId` is the copy. */
  purchases: z.array(z.object({ athleteId: z.string(), planId: z.string().nullable() })),
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

/** A plan purchase (src/lib/plan-purchases.server.ts `PlanPurchaseDTO`). */
export const planPurchaseSchema = z.object({
  id: z.string(),
  /** pending: checkout open; fulfilling: paid, being delivered; fulfilled: done; canceled: abandoned. */
  status: z.enum(["pending", "fulfilling", "fulfilled", "canceled"]),
  planId: z.string().nullable(),
  athleteId: z.string().nullable(),
  /** The athlete's own copy, once fulfilled. */
  copiedPlanId: z.string().nullable(),
  amountCents: z.number(),
});
