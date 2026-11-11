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
  purchases: z.array(
    z.object({
      athleteId: z.string(),
      planId: z.string().nullable(),
      /** Whether this purchase is paid, waiting on the coach, or due (show "Complete payment"). */
      paymentStatus: z.enum(["awaiting_coach_setup", "payment_due", "processing", "paid"]),
      purchaseId: z.string(),
    }),
  ),
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
  /** Ratings of the coach themselves (`GET /api/v1/marketplace/coaches/{id}/ratings`); `average` is null with none. */
  coachRating: z.object({ average: z.number().nullable(), count: z.number() }),
  plans: z.array(marketplacePlanSchema),
});

/** A plan purchase (src/lib/plan-purchases.server.ts `PlanPurchaseDTO`). */
export const planPurchaseSchema = z.object({
  id: z.string(),
  /**
   * Delivery. pending: at checkout; fulfilling: being delivered; fulfilled: the
   * athlete has the plan; canceled: checkout abandoned; restricted: the coach
   * removed an unpaid buyer's access.
   */
  status: z.enum(["pending", "fulfilling", "fulfilled", "canceled", "restricted"]),
  /**
   * Money. awaiting_coach_setup: the coach isn't on Stripe yet, nothing owed yet;
   * payment_due: the buyer owes it (since paymentDueAt); processing; paid.
   */
  paymentStatus: z.enum(["awaiting_coach_setup", "payment_due", "processing", "paid"]),
  planId: z.string().nullable(),
  athleteId: z.string().nullable(),
  /** The athlete's own copy, once delivered. */
  copiedPlanId: z.string().nullable(),
  amountCents: z.number(),
  /** Since when payment is owed; null while nothing is owed. */
  paymentDueAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  /** Unpaid 3 days after it became due: the coach may restrict the buyer. */
  overdue: z.boolean(),
});

/** `GET /api/v1/marketplace/purchases`: the caller's purchases. */
export const myPlanPurchasesSchema = z.object({
  items: z.array(
    planPurchaseSchema.extend({
      planTitle: z.string().nullable(),
      coachName: z.string().nullable(),
      /** Who it's for, first name and last initial. */
      athleteName: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

/** `GET /api/v1/coach/sales`: the coach's plan sales, received and pending. */
export const coachSalesSchema = z.object({
  items: z.array(
    planPurchaseSchema.extend({
      planTitle: z.string().nullable(),
      /** The athlete it's for, first name and last initial. */
      athleteName: z.string().nullable(),
      platformFeeCents: z.number().nullable(),
      stripeFeeCents: z.number().nullable(),
      /** What reached the coach's Stripe account; null until paid. */
      coachPayoutCents: z.number().nullable(),
      /** Overdue: the coach may restrict this buyer. */
      canRestrict: z.boolean(),
      createdAt: z.string(),
    }),
  ),
  totals: z.object({
    /** The coach's share of paid sales. */
    receivedCents: z.number(),
    /** Owed by buyers and not paid yet (full prices). */
    pendingCents: z.number(),
    overdueCount: z.number(),
  }),
});

/** `GET /api/v1/coach/marketplace/dashboard` (src/lib/coach-dashboard.server.ts `CoachDashboardDTO`). */
export const coachDashboardSchema = z.object({
  /** Stripe payouts are set up (balance and payouts are from Stripe). */
  connected: z.boolean(),
  totals: z.object({
    salesCount: z.number(),
    /** The coach's share of paid sales. */
    earnedCents: z.number(),
    /** Owed by buyers and not paid yet. */
    pendingCents: z.number(),
    /** "On the way": plans delivered before the coach was on Stripe and not paid yet (full price). */
    onTheWayCents: z.number(),
    /** In the coach's Stripe balance, not in their bank yet; null when not connected. */
    stripeBalanceCents: z.number().nullable(),
    /** "Paid out": everything the coach has received (their share of paid sales). */
    paidOutCents: z.number(),
    views: z.number(),
    /** Sales per view (0–1); null with no views. */
    conversion: z.number().nullable(),
    ratingAverage: z.number().nullable(),
    ratingCount: z.number(),
    overdueCount: z.number(),
  }),
  /** The coach's share of paid sales per month (YYYY-MM), oldest first: 24 months, or back to the first paid sale. */
  monthlyEarnings: z.array(z.object({ month: z.string(), cents: z.number() })),
  sales: coachSalesSchema.shape.items,
  plans: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      priceCents: z.number(),
      /** draft | active | benched */
      status: z.string(),
      soldCount: z.number(),
      views: z.number(),
    }),
  ),
  /** Views and sales per week (Monday to Sunday), newest first. */
  weekly: z.array(
    z.object({ weekStart: z.string(), weekEnd: z.string(), views: z.number(), sales: z.number() }),
  ),
  /** Payouts to the coach's bank, newest first. */
  payouts: z.array(
    z.object({
      id: z.string(),
      arrivalDate: z.string(),
      amountCents: z.number(),
      status: z.string(),
      bankLast4: z.string().nullable(),
    }),
  ),
});
