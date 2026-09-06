/**
 * Zod schemas for the coach sign-up / onboarding DTOs, mirroring the
 * TypeScript types in `coach-profile-types.ts`, `invites.server.ts`,
 * `promo.server.ts`, and `orgs.server.ts` field for field. `satisfies
 * z.ZodType<…>` makes the compiler fail if the types and these schemas
 * drift, so the OpenAPI document (and the generated Swift client) carry
 * the real shapes.
 */
import { z } from "zod";
import type { CoachLevelDTO, CoachProfileDTO } from "@/lib/coach-profile-types";
import type {
  AdultAthleteInvitePreview,
  InviteResolution,
  ParentInvitePreview,
} from "@/lib/invites.server";
import type { PromoValidation } from "@/lib/promo.server";
import type {
  JoinOrganizationResult,
  OrgCodeVerification,
  OrgLookup,
  OrganizationSummary,
} from "@/lib/orgs.server";

export const coachEntitlementSchema = z.enum(["pending", "club_covered", "paid", "promo_free"]);
export const coachEffectiveTierSchema = z.enum(["coach", "coach_pro", "club"]);

export const coachProfileSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  onboardedAt: z.string().nullable(),
  entitlement: coachEntitlementSchema,
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
  subscriptionTier: z.enum(["coach", "coach_pro"]).nullable(),
  subscriptionStatus: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  hasStripeCustomer: z.boolean(),
  promoCode: z.string().nullable(),
  promoLabel: z.string().nullable(),
  promoPercentOff: z.number(),
  effectiveTier: coachEffectiveTierSchema,
  athleteLimit: z.number().nullable(),
  athleteCount: z.number(),
  foundingCoach: z.boolean(),
  foundingProTrialUsed: z.boolean(),
  freeAccessUntil: z.string().nullable(),
  trialNeedsCard: z.boolean(),
  subscriptionEnvironment: z.enum(["sandbox", "live"]).nullable(),
  billingPastDue: z.boolean(),
}) satisfies z.ZodType<CoachProfileDTO>;

export const coachLevelSchema = z.object({
  sport: z.string(),
  levelKey: z.string(),
  hoursPerWeek: z.number(),
}) satisfies z.ZodType<CoachLevelDTO>;

export const coachProfileResponseSchema = z.object({
  profile: coachProfileSchema,
  levels: z.array(coachLevelSchema),
});

export const okSchema = z.object({ ok: z.literal(true) });

export const inviteResolutionSchema = z.union([
  z.object({ kind: z.literal("coach"), valid: z.literal(true), promoCode: z.null() }),
  z.object({ kind: z.literal("parent"), valid: z.literal(true), promoCode: z.string().nullable() }),
  z.object({
    kind: z.literal("adult-athlete"),
    valid: z.literal(true),
    promoCode: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("athlete"),
    valid: z.boolean(),
    used: z.boolean(),
    expired: z.boolean(),
    promoCode: z.null(),
  }),
  z.object({
    kind: z.literal("guardian"),
    valid: z.boolean(),
    used: z.boolean(),
    guardianToken: z.string().nullable(),
    promoCode: z.null(),
  }),
  z.object({ kind: z.null(), valid: z.literal(false), promoCode: z.null() }),
]) satisfies z.ZodType<InviteResolution>;

export const parentInvitePreviewSchema = z.object({
  parentId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  athleteCount: z.number(),
}) satisfies z.ZodType<ParentInvitePreview>;

export const adultAthleteInvitePreviewSchema = z.object({
  athleteId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
}) satisfies z.ZodType<AdultAthleteInvitePreview>;

export const parentClaimResultSchema = z.object({
  ok: z.literal(true),
  athletes: z.number(),
  sports: z.number(),
});

export const adultAthleteClaimResultSchema = z.object({ ok: z.literal(true), sports: z.number() });

export const inviteCodeResponseSchema = z.object({ code: z.string() });

export const promoValidationSchema = z.union([
  z.object({
    valid: z.literal(false),
    label: z.null(),
    percentOff: z.literal(0),
    duration: z.literal("forever"),
    durationInMonths: z.null(),
  }),
  z.object({
    valid: z.literal(true),
    label: z.string(),
    percentOff: z.number(),
    duration: z.enum(["forever", "repeating"]),
    durationInMonths: z.number().nullable(),
  }),
]) satisfies z.ZodType<PromoValidation>;

export const promoAppliedSchema = z.object({ applied: z.boolean() });

export const organizationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  logoUrl: z.string().nullable(),
}) satisfies z.ZodType<OrganizationSummary>;

export const organizationSearchSchema = z.object({
  organizations: z.array(organizationSummarySchema),
});

export const popularOrganizationsSchema = z.object({
  organizations: z.array(organizationSummarySchema.extend({ count: z.number() })),
});

export const orgLookupSchema = z.union([
  z.object({ found: z.literal(false) }),
  z.object({ found: z.literal(true), organizationId: z.string(), name: z.string() }),
]) satisfies z.ZodType<OrgLookup>;

export const orgCodeVerificationSchema = z.union([
  z.object({ ok: z.literal(false), reason: z.enum(["unknown", "inactive", "mismatch"]) }),
  z.object({ ok: z.literal(true), name: z.string() }),
]) satisfies z.ZodType<OrgCodeVerification>;

export const claimOrganizationResultSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
});

export const subscriptionOutcomeSchema = z.union([
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("already_joined") }),
  z.object({
    kind: z.literal("canceled_immediately"),
    refundedCents: z.number(),
    currency: z.string(),
  }),
  z.object({ kind: z.literal("canceled_at_period_end"), periodEnd: z.string().nullable() }),
  z.object({ kind: z.literal("trial_canceled") }),
]);

export const joinOrganizationResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    organizationId: z.string(),
    name: z.string(),
    subscriptionOutcome: subscriptionOutcomeSchema,
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]) satisfies z.ZodType<JoinOrganizationResult>;

export const clearOrganizationResultSchema = z.object({
  ok: z.literal(true),
  welcomeBackGranted: z.boolean(),
});
