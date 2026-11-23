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
  /** The sport the plan is for ("figure_skating"); null when unset. Filter with `?sport=`. */
  sport: z.string().nullable(),
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
    /** On Coach Pro: show the Verified badge. */
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
    /** On Coach Pro: show the Verified badge. */
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
  /** What's charged, after any promo code. */
  amountCents: z.number(),
  /** The plan's price before any promo code. */
  originalAmountCents: z.number(),
  /** The coach's promo code applied, as it was applied; null when none. */
  promoCode: z.string().nullable(),
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
      /** Cover image (signed link for an upload); null without one. */
      coverUrl: z.string().nullable(),
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
  /** The coach's promo codes: usable now (the "N active" card), of all they have. */
  promoCodes: z.object({ active: z.number().int(), total: z.number().int() }),
});

/** `POST /api/v1/marketplace/plans/{id}/promo-code` (src/lib/plan-purchases.server.ts `PlanPromoPreviewDTO`). */
export const planPromoPreviewSchema = z.object({
  /**
   * valid, or why not: invalid (no such code, or disabled), expired,
   * exhausted (no uses left), wrong_plan (another plan, or this plan is
   * free), already_used (by this buyer: once each), below_minimum (would
   * leave less than $0.50 to pay).
   */
  state: z.enum([
    "valid",
    "invalid",
    "expired",
    "exhausted",
    "wrong_plan",
    "already_used",
    "below_minimum",
  ]),
  /** Why not, to show the buyer; null when valid. */
  message: z.string().nullable(),
  /** The plan's price. */
  originalAmountCents: z.number(),
  /** The rest is null unless valid. The code as the coach saved it. */
  code: z.string().nullable(),
  discountType: z.enum(["percent", "fixed", "free"]).nullable(),
  /** percent: 1–100; fixed: USD; free: null. */
  discountValue: z.number().nullable(),
  discountCents: z.number().nullable(),
  /** What the buyer would pay; 0 is free (delivered with no checkout). */
  amountCents: z.number().nullable(),
});

/** One of the coach's promo codes (src/lib/coach-promo-codes.server.ts `CoachPromoCodeDTO`). */
export const coachPromoCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  /** percent: % off; fixed: $ off; free: the plan costs nothing. */
  discountType: z.enum(["percent", "fixed", "free"]),
  /** percent: 1–100; fixed: USD; free: null. */
  discountValue: z.number().nullable(),
  /** The one plan it applies to; null is all of the coach's plans. */
  plan: z.object({ id: z.string(), title: z.string() }).nullable(),
  /** Total uses allowed (1–999). Each buyer may use a code once. */
  maxRedemptions: z.number().int(),
  /** Purchases delivered with it ("14 of 50 uses"). */
  redemptionCount: z.number().int(),
  /** What buyers paid with it, on paid purchases. */
  revenueCents: z.number().int(),
  expiresAt: z.string().nullable(),
  /** false: the coach disabled it. */
  active: z.boolean(),
  /** Usable now: the Active tab; everything else is Ended. */
  isActive: z.boolean(),
  /** active; disabled (turned off); expired (past its end date); used_up (no uses left). */
  state: z.enum(["active", "disabled", "expired", "used_up"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const coachPromoCodesSchema = z.object({ items: z.array(coachPromoCodeSchema) });
